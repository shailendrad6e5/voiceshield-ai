from __future__ import annotations
import io, math
import numpy as np
from scipy.io import wavfile

FEATURE_NAMES = [
    'duration_s','rms','zero_crossing_rate','spectral_centroid','spectral_bandwidth',
    'spectral_flatness','spectral_rolloff','dynamic_range','pitch_proxy','pitch_variation',
    'silence_ratio','high_freq_ratio'
]

def _frame_audio(x: np.ndarray, sr: int, frame_ms=25, hop_ms=10):
    n = max(1, int(sr*frame_ms/1000)); h=max(1,int(sr*hop_ms/1000))
    if len(x)<n: x=np.pad(x,(0,n-len(x)))
    frames=[]
    for i in range(0,max(1,len(x)-n+1),h):
        f=x[i:i+n]
        if len(f)<n: f=np.pad(f,(0,n-len(f)))
        frames.append(f*np.hanning(n))
    return np.asarray(frames)

def extract_features(wav_bytes: bytes) -> dict:
    sr, x = wavfile.read(io.BytesIO(wav_bytes))
    if x.ndim>1: x=x.mean(axis=1)
    if np.issubdtype(x.dtype, np.integer):
        x=x.astype(np.float32)/(np.iinfo(x.dtype).max or 1)
    else: x=x.astype(np.float32)
    x=np.nan_to_num(x); x=x/(max(np.max(np.abs(x)),1e-8))
    frames=_frame_audio(x,sr)
    rms=np.sqrt(np.mean(frames**2,axis=1)+1e-10)
    zcr=np.mean(np.mean(np.abs(np.diff(np.sign(frames))),axis=1)/2)
    spec=np.abs(np.fft.rfft(frames,axis=1))+1e-10
    freqs=np.fft.rfftfreq(frames.shape[1],1/sr)
    power=spec**2; ps=power/power.sum(axis=1,keepdims=True)
    centroid=np.mean((ps*freqs).sum(axis=1))
    bw=np.mean(np.sqrt((ps*(freqs[None,:]-centroid)**2).sum(axis=1)))
    flat=np.mean(np.exp(np.mean(np.log(spec),axis=1))/(np.mean(spec,axis=1)+1e-10))
    cdf=np.cumsum(ps,axis=1); roll_idx=np.argmax(cdf>=0.85,axis=1); roll=np.mean(freqs[roll_idx])
    dyn=float(np.percentile(np.abs(x),95)-np.percentile(np.abs(x),5))
    # Lightweight pitch proxy: autocorrelation peak in speech-like range.
    pitches=[]
    for f in frames[::max(1,len(frames)//80)]:
        ac=np.correlate(f,f,mode='full')[len(f)-1:]
        lo=max(1,int(sr/350)); hi=min(len(ac)-1,int(sr/70))
        if hi>lo:
            lag=lo+int(np.argmax(ac[lo:hi])); pitches.append(sr/lag if ac[lag]>0.05*ac[0] else 0)
    pitches=np.asarray([p for p in pitches if p>0])
    pitch_proxy=float(np.median(pitches)) if len(pitches) else 0.0
    pitch_var=float(np.std(pitches)/(np.mean(pitches)+1e-6)) if len(pitches)>1 else 0.0
    silence=float(np.mean(rms<np.percentile(rms,25)*0.35))
    hf=float(np.mean(power[:,freqs>4000].sum(axis=1)/(power.sum(axis=1)+1e-10))) if np.any(freqs>4000) else 0.0
    return dict(zip(FEATURE_NAMES,[len(x)/sr,float(np.mean(rms)),float(zcr),centroid,bw,float(flat),roll,dyn,pitch_proxy,pitch_var,silence,hf]))
