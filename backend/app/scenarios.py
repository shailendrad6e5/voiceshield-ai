"""Deterministic synthetic audio used only by the Simulation Lab and demo-model training.

These generators are deliberately separate from the upload path. They are not recordings,
and their acoustic patterns are only controlled demonstration inputs.
"""

from __future__ import annotations

import io

import numpy as np
from scipy.io import wavfile


SCENARIOS = frozenset({"NORMAL", "CLONED_VOICE", "REPLAY", "LOW_QUALITY", "MIXED_RISK"})
_DEFAULT_SEEDS = {
    "NORMAL": 11,
    "CLONED_VOICE": 23,
    "REPLAY": 37,
    "LOW_QUALITY": 41,
    "MIXED_RISK": 53,
}


def generate_scenario_wav(
    scenario: str,
    *,
    seconds: float = 1.8,
    sample_rate: int = 16_000,
    seed: int | None = None,
) -> bytes:
    """Return a deterministic PCM16 WAV for one demonstration scenario.

    ``seed`` lets model training vary synthetic profiles without changing the
    repeatable, user-facing demonstration preset.
    """
    if scenario not in SCENARIOS:
        raise ValueError("Unknown demonstration scenario")
    if not 0.25 <= seconds <= 10 or sample_rate < 8_000:
        raise ValueError("Unsupported synthetic audio parameters")

    rng = np.random.default_rng(_DEFAULT_SEEDS[scenario] if seed is None else seed)
    sample_count = int(seconds * sample_rate)
    t = np.arange(sample_count, dtype=np.float64) / sample_rate

    def voiced(base_hz: float, variation_hz: float, noise: float) -> np.ndarray:
        modulation_rate = rng.uniform(1.1, 2.7)
        phase = 2 * np.pi * (
            base_hz * t
            + variation_hz / (2 * np.pi * modulation_rate) * np.sin(2 * np.pi * modulation_rate * t)
        )
        envelope = 0.62 + 0.25 * np.sin(2 * np.pi * rng.uniform(1.7, 3.4) * t + rng.uniform(0, np.pi))
        signal = envelope * (
            0.24 * np.sin(phase)
            + 0.075 * np.sin(2 * phase + 0.3)
            + 0.025 * np.sin(3 * phase + 0.8)
        )
        return signal + rng.normal(0, noise, sample_count)

    if scenario == "NORMAL":
        signal = voiced(rng.uniform(155, 195), rng.uniform(10, 21), 0.012)
    elif scenario == "CLONED_VOICE":
        base = rng.uniform(165, 185)
        phase = 2 * np.pi * base * t
        signal = 0.22 * np.sin(phase) + 0.045 * np.sin(2 * phase) + 0.012 * np.sin(3 * phase)
        signal += rng.normal(0, 0.0006, sample_count)
    elif scenario == "REPLAY":
        source = voiced(rng.uniform(105, 125), rng.uniform(0, 2), 0.002)
        filtered = np.convolve(source, np.ones(9) / 9, mode="same")
        delayed = np.pad(filtered[:-170], (170, 0))
        signal = 0.78 * filtered + 0.18 * delayed
    elif scenario == "LOW_QUALITY":
        signal = voiced(rng.uniform(155, 195), rng.uniform(9, 18), 0.08)

        # Strongly degraded audio: very low volume + frequent dropouts
        signal *= 0.05

        dropout_mask = rng.random(sample_count) < 0.35
        signal[dropout_mask] = 0.0

        # Quantization/distortion to simulate poor recording quality
        signal = np.round(signal * 32) / 32
    else:  # MIXED_RISK
        base = rng.uniform(100, 120)
        phase = 2 * np.pi * base * t
        steady = 0.23 * np.sin(phase) + 0.035 * np.sin(2 * phase)
        delayed = np.pad(steady[:-145], (145, 0))
        signal = 0.78 * steady + 0.16 * delayed + rng.normal(0, 0.001, sample_count)

    signal = np.clip(signal, -0.98, 0.98)
    buffer = io.BytesIO()
    wavfile.write(buffer, sample_rate, (signal * 32767).astype(np.int16))
    return buffer.getvalue()
