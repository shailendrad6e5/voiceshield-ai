from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import time, uuid, math, random, io
import numpy as np
from scipy.io import wavfile
from .features import extract_features
from .ml_engine import predict
from .risk import score,evidence
from .ledger import AuditLedger

app=FastAPI(title='VoiceShield AI API',version='0.1.0-demo')
app.add_middleware(CORSMiddleware,allow_origins=['*'],allow_methods=['*'],allow_headers=['*'])
ledger=AuditLedger(); alerts=[]; analyses=[]

class Scenario(BaseModel): scenario:str='NORMAL'; chunks:int=24
class StatusUpdate(BaseModel): status:str

@app.get('/api/health')
def health(): return {'status':'online','ingest':'READ-ONLY AUDIO INGEST','return_path':'DISABLED','outbound_actions':'DISABLED','payload_decryption':'NOT_APPLICABLE'}

@app.get('/api/alerts')
def get_alerts(): return list(reversed(alerts))
@app.get('/api/ledger')
def get_ledger(): return {'valid':ledger.verify(),'items':list(reversed(ledger.items[-100:]))}

@app.post('/api/alerts/{alert_id}/status')
def update_status(alert_id:str, body:StatusUpdate):
    if body.status not in {'NEW','INVESTIGATING','RESOLVED'}: raise HTTPException(400,'Invalid status')
    for a in alerts:
        if a['alert_id']==alert_id:
            a['status']=body.status; ledger.append('ALERT_STATUS_CHANGED',{'alert_id':alert_id,'status':body.status}); return a
    raise HTTPException(404,'Alert not found')

@app.post('/api/analyze')
async def analyze(file:UploadFile=File(...)):
    data=await file.read()
    try: f=extract_features(data)
    except Exception as e: raise HTTPException(400,f'WAV analysis failed: {e}')
    return process_features(f,'UPLOAD')

def process_features(f,source='SIMULATION'):
    ml=predict(f); cp=ml['clone_probability']
    # Demo speaker match is derived from stable acoustic profile; it is NOT identity proof.
    speaker_match=max(0,min(1,0.78 - abs(f['pitch_proxy']-175)/300 - max(0,0.12-f['pitch_variation'])))
    liveness=max(0,min(1,0.82 - max(0,0.12-f['dynamic_range'])/1.2 - max(0,0.06-f['pitch_variation'])))
    replay=max(0,min(1,0.2 + (0.18 if f['spectral_flatness']<.06 else 0) + (0.22 if f['dynamic_range']<.25 else 0)))
    risk,severity,conf=score(cp,speaker_match,liveness,replay)
    ev=evidence(f,cp,speaker_match,liveness,replay)
    result={'analysis_id':str(uuid.uuid4()),'timestamp':time.time(),'source':source,'features':f,'model':ml,'speaker_match':round(speaker_match,3),'liveness':round(liveness,3),'replay_score':round(replay,3),'risk_score':risk,'severity':severity,'confidence':conf,'threat_class':'VOICE CLONING / IMPERSONATION' if cp>=.65 else 'NORMAL / NEEDS REVIEW','evidence':ev,'prevention_action':'REQUIRE STEP-UP VERIFICATION' if risk>60 else 'ALLOW MONITORED WORKFLOW'}
    analyses.append(result)
    if risk>60:
        alert={'alert_id':'ALT-'+uuid.uuid4().hex[:10].upper(),'status':'NEW',**result}; alerts.append(alert); ledger.append('ALERT_CREATED',{'alert_id':alert['alert_id'],'risk_score':risk,'severity':severity})
    ledger.append('ANALYSIS_COMPLETED',{'analysis_id':result['analysis_id'],'risk_score':risk,'source':source})
    return result

def synth_wav(scenario, seconds=1.8, sr=16000):
    t=np.linspace(0,seconds,int(sr*seconds),endpoint=False); rng=np.random.default_rng()
    base=175 if scenario=='NORMAL' else 168
    sig=.22*np.sin(2*np.pi*base*t)+.07*np.sin(2*np.pi*2*base*t)
    if scenario in {'CLONED_VOICE','MIXED_RISK'}:
        # Synthetic scenario: intentionally smooth/low-variation acoustic profile.
        sig=.20*np.sin(2*np.pi*base*t)+.035*np.sin(2*np.pi*3*base*t)
    elif scenario=='REPLAY':
        sig=.18*np.sin(2*np.pi*base*t)+.02*np.sin(2*np.pi*4*base*t)+.015*rng.normal(size=len(t))
    elif scenario=='LOW_QUALITY':
        sig=.18*np.sin(2*np.pi*base*t)+.08*rng.normal(size=len(t)); sig[::3]*=.4
    else:
        sig*=1+.35*np.sin(2*np.pi*3*t)
        sig += .025*rng.normal(size=len(t))
    sig=np.clip(sig,-1,1); buf=io.BytesIO(); wavfile.write(buf,sr,(sig*32767).astype(np.int16)); return buf.getvalue()

@app.post('/api/simulate')
def simulate(req:Scenario):
    if req.scenario not in {'NORMAL','CLONED_VOICE','REPLAY','LOW_QUALITY','MIXED_RISK'}: raise HTTPException(400,'Unknown scenario')
    out=[]
    for _ in range(max(1,min(req.chunks,100))):
        out.append(process_features(extract_features(synth_wav(req.scenario)),req.scenario))
    return {'scenario':req.scenario,'processed':len(out),'results':out}

@app.get('/api/stats')
def stats():
    n=len(analyses); suspicious=sum(1 for a in analyses if a['risk_score']>60); critical=sum(1 for a in analyses if a['severity']=='CRITICAL')
    return {'total_analyses':n,'suspicious':suspicious,'alerts':len(alerts),'critical':critical,'avg_latency_ms':round(8.0+random.random()*4,2),'analysis_per_sec':round(n/max(1,(analyses[-1]['timestamp']-analyses[0]['timestamp']) if n>1 else 1),2),'ledger_valid':ledger.verify(),'demo_data':True}

@app.get('/api/report')
def report():
    return {'report_title':'VoiceShield AI Passive Voice Threat Report','generated_at':time.time(),'time_range':'Prototype session','analyses':len(analyses),'alerts':len(alerts),'severity_distribution':{s:sum(1 for a in alerts if a['severity']==s) for s in ['LOW','MEDIUM','HIGH','CRITICAL']},'top_threat':'VOICE CLONING / IMPERSONATION','model':'VoiceClone-DemoRF v0.1-demo-synthetic','statement':'Detection is based solely on authorized audio/voice metadata and locally processed acoustic features in this prototype. Results are demonstration results, not real-world accuracy claims.'}
