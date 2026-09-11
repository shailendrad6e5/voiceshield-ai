"""Strict WAV validation and bounded acoustic feature extraction."""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from scipy.io import wavfile


FEATURE_NAMES = [
    "duration_s",
    "rms",
    "zero_crossing_rate",
    "spectral_centroid",
    "spectral_bandwidth",
    "spectral_flatness",
    "spectral_rolloff",
    "dynamic_range",
    "pitch_proxy",
    "pitch_variation",
    "silence_ratio",
    "high_freq_ratio",
]

MIN_DURATION_S = 0.25
MAX_DURATION_S = 60.0
MIN_SAMPLE_RATE = 8_000
MAX_SAMPLE_RATE = 48_000
MAX_CHANNELS = 2


class AudioValidationError(ValueError):
    """Raised for an unsupported, malformed, or unsafe WAV input."""


@dataclass(frozen=True)
class WavMetadata:
    sample_rate: int
    channels: int
    duration_s: float
    sample_format: str


def _frame_audio(samples: np.ndarray, sample_rate: int, frame_ms: int = 25, hop_ms: int = 10) -> np.ndarray:
    frame_size = max(1, int(sample_rate * frame_ms / 1000))
    hop_size = max(1, int(sample_rate * hop_ms / 1000))
    if len(samples) < frame_size:
        samples = np.pad(samples, (0, frame_size - len(samples)))
    starts = range(0, max(1, len(samples) - frame_size + 1), hop_size)
    window = np.hanning(frame_size)
    frames = []
    for start in starts:
        frame = samples[start : start + frame_size]
        if len(frame) < frame_size:
            frame = np.pad(frame, (0, frame_size - len(frame)))
        frames.append(frame * window)
    return np.asarray(frames, dtype=np.float64)


def _normalise_pcm(samples: np.ndarray) -> np.ndarray:
    if np.issubdtype(samples.dtype, np.unsignedinteger):
        midpoint = (np.iinfo(samples.dtype).max + 1) / 2
        return (samples.astype(np.float64) - midpoint) / midpoint
    if np.issubdtype(samples.dtype, np.signedinteger):
        scale = max(abs(np.iinfo(samples.dtype).min), np.iinfo(samples.dtype).max)
        return samples.astype(np.float64) / scale
    if np.issubdtype(samples.dtype, np.floating):
        return samples.astype(np.float64)
    raise AudioValidationError("Unsupported WAV sample format")


def decode_wav(wav_bytes: bytes) -> tuple[np.ndarray, WavMetadata]:
    """Validate an in-memory RIFF/WAVE file and return mono normalized samples."""
    if len(wav_bytes) < 44 or wav_bytes[:4] != b"RIFF" or wav_bytes[8:12] != b"WAVE":
        raise AudioValidationError("Expected a RIFF/WAVE file")
    try:
        sample_rate, audio = wavfile.read(io.BytesIO(wav_bytes))
    except (ValueError, OSError, EOFError) as exc:
        raise AudioValidationError("Malformed or unsupported WAV data") from exc

    if not isinstance(sample_rate, (int, np.integer)) or not MIN_SAMPLE_RATE <= sample_rate <= MAX_SAMPLE_RATE:
        raise AudioValidationError(f"Sample rate must be between {MIN_SAMPLE_RATE} and {MAX_SAMPLE_RATE} Hz")
    if audio.ndim not in (1, 2) or audio.size == 0:
        raise AudioValidationError("WAV contains no audio samples")
    channels = 1 if audio.ndim == 1 else audio.shape[1]
    if not 1 <= channels <= MAX_CHANNELS:
        raise AudioValidationError("Only mono or stereo WAV audio is supported")
    if not np.issubdtype(audio.dtype, np.number):
        raise AudioValidationError("Unsupported WAV sample format")

    samples = _normalise_pcm(audio)
    if not np.isfinite(samples).all():
        raise AudioValidationError("WAV contains non-finite sample values")
    if channels == 2:
        samples = samples.mean(axis=1)
    duration_s = len(samples) / sample_rate
    if not MIN_DURATION_S <= duration_s <= MAX_DURATION_S:
        raise AudioValidationError(f"WAV duration must be between {MIN_DURATION_S:g} and {MAX_DURATION_S:g} seconds")
    peak = float(np.max(np.abs(samples)))
    if peak < 1e-4:
        raise AudioValidationError("WAV is silent or too quiet to analyse")
    samples = np.clip(samples, -1.0, 1.0)
    return samples, WavMetadata(int(sample_rate), channels, float(duration_s), str(audio.dtype))


def _finite(value: float) -> float:
    return float(np.nan_to_num(value, nan=0.0, posinf=0.0, neginf=0.0))


def extract_features(wav_bytes: bytes) -> dict[str, float]:
    """Extract the twelve ordered model features plus upload-quality diagnostics."""
    samples, metadata = decode_wav(wav_bytes)
    frames = _frame_audio(samples, metadata.sample_rate)
    frame_rms = np.sqrt(np.mean(frames**2, axis=1) + 1e-12)
    signs = np.signbit(frames)
    zcr = float(np.mean(np.mean(signs[:, 1:] != signs[:, :-1], axis=1)))

    spectrum = np.abs(np.fft.rfft(frames, axis=1)) + 1e-12
    power = spectrum**2
    power_sum = power.sum(axis=1, keepdims=True)
    spectral_distribution = power / np.maximum(power_sum, 1e-12)
    frequencies = np.fft.rfftfreq(frames.shape[1], 1 / metadata.sample_rate)
    frame_centroids = (spectral_distribution * frequencies).sum(axis=1)
    centroid = float(frame_centroids.mean())
    bandwidth = float(np.sqrt((spectral_distribution * (frequencies - frame_centroids[:, None]) ** 2).sum(axis=1)).mean())
    flatness = float((np.exp(np.mean(np.log(spectrum), axis=1)) / np.maximum(np.mean(spectrum, axis=1), 1e-12)).mean())
    cdf = np.cumsum(spectral_distribution, axis=1)
    rolloff = float(frequencies[np.argmax(cdf >= 0.85, axis=1)].mean())

    pitches = []
    for frame in frames[:: max(1, len(frames) // 80)]:
        autocorrelation = np.correlate(frame, frame, mode="full")[len(frame) - 1 :]
        low_lag = max(1, int(metadata.sample_rate / 350))
        high_lag = min(len(autocorrelation) - 1, int(metadata.sample_rate / 70))
        if high_lag > low_lag:
            lag = low_lag + int(np.argmax(autocorrelation[low_lag:high_lag]))
            if autocorrelation[lag] > 0.05 * autocorrelation[0]:
                pitches.append(metadata.sample_rate / lag)
    pitch_values = np.asarray(pitches, dtype=np.float64)
    pitch_proxy = float(np.median(pitch_values)) if len(pitch_values) else 0.0
    pitch_variation = float(np.std(pitch_values) / max(np.mean(pitch_values), 1e-12)) if len(pitch_values) > 1 else 0.0

    silence_threshold = max(0.005, 0.15 * float(np.median(frame_rms)))
    silence_ratio = float(np.mean(frame_rms < silence_threshold))
    high_frequency = frequencies > 4_000
    high_frequency_ratio = float((power[:, high_frequency].sum(axis=1) / np.maximum(power.sum(axis=1), 1e-12)).mean()) if np.any(high_frequency) else 0.0
    peak = float(np.max(np.abs(samples)))
    clipping_ratio = float(np.mean(np.abs(samples) >= 0.98))
    dynamic_range = float(np.percentile(np.abs(samples), 95) - np.percentile(np.abs(samples), 5))
    rms = float(np.mean(frame_rms))
    quality_penalty = (
        min(0.45, silence_ratio * 0.75)
        + min(0.35, clipping_ratio * 2.0)
        + (0.20 if rms < 0.025 else 0.0)
        + (0.15 if zcr > 0.22 else 0.0)
    )
    quality_score = float(np.clip(1.0 - quality_penalty, 0.0, 1.0))

    values = {
        "duration_s": metadata.duration_s,
        "rms": rms,
        "zero_crossing_rate": zcr,
        "spectral_centroid": centroid,
        "spectral_bandwidth": bandwidth,
        "spectral_flatness": flatness,
        "spectral_rolloff": rolloff,
        "dynamic_range": dynamic_range,
        "pitch_proxy": pitch_proxy,
        "pitch_variation": pitch_variation,
        "silence_ratio": silence_ratio,
        "high_freq_ratio": high_frequency_ratio,
        "peak_amplitude": peak,
        "clipping_ratio": clipping_ratio,
        "quality_score": quality_score,
        "sample_rate_hz": float(metadata.sample_rate),
        "channels": float(metadata.channels),
    }
    return {name: _finite(value) for name, value in values.items()}
