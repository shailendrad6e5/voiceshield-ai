"""Reproducible demonstration Random Forest model.

The model learns only from generated waveform profiles. It is a demonstration
baseline, never a validated production anti-spoofing model.
"""

from __future__ import annotations

import os
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier

from .features import FEATURE_NAMES, extract_features
from .scenarios import generate_scenario_wav


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_PATH = ROOT / "models" / "voice_clone_demo.joblib"
MODEL_VERSION = "0.2-demo-synthetic"
MODEL_SEED = 42


def model_path() -> Path:
    override = os.getenv("VOICESHIELD_MODEL_PATH")
    return Path(override) if override else DEFAULT_MODEL_PATH


def _row(scenario: str, seed: int) -> list[float]:
    features = extract_features(generate_scenario_wav(scenario, seconds=1.4 + (seed % 8) * 0.1, seed=seed))
    return [features[name] for name in FEATURE_NAMES]


def train_demo_model(output_path: Path | None = None) -> RandomForestClassifier:
    """Train deterministic, synthetic-only demo profiles and persist metadata."""
    rng = np.random.default_rng(MODEL_SEED)
    rows: list[list[float]] = []
    labels: list[int] = []
    for _ in range(180):
        rows.append(_row("NORMAL", int(rng.integers(1, 2**31 - 1))))
        labels.append(0)
    for scenario in ("CLONED_VOICE", "REPLAY", "MIXED_RISK"):
        for _ in range(60):
            rows.append(_row(scenario, int(rng.integers(1, 2**31 - 1))))
            labels.append(1)

    classifier = RandomForestClassifier(
        n_estimators=160,
        random_state=MODEL_SEED,
        class_weight="balanced",
        n_jobs=1,
    ).fit(np.asarray(rows), np.asarray(labels))
    destination = output_path or model_path()
    destination.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "model": classifier,
            "metadata": {
                "model_version": MODEL_VERSION,
                "feature_names": FEATURE_NAMES,
                "training_source": "generated waveform profiles only",
                "training_samples": len(rows),
                "labels": {"0": "normal synthetic demo profile", "1": "suspicious synthetic demo profile"},
                "random_seed": MODEL_SEED,
                "holdout_policy": "No production metric is reported; real evaluation is future work.",
            },
        },
        destination,
    )
    return classifier


def get_model() -> RandomForestClassifier:
    path = model_path()
    if path.exists():
        try:
            saved = joblib.load(path)
            if isinstance(saved, dict) and saved.get("metadata", {}).get("model_version") == MODEL_VERSION:
                model = saved.get("model")
                if list(saved["metadata"].get("feature_names", [])) == FEATURE_NAMES and isinstance(model, RandomForestClassifier):
                    return model
        except (OSError, ValueError, TypeError):
            pass
    return train_demo_model(path)


def predict(features: dict[str, float]) -> dict[str, object]:
    model = get_model()
    row = np.asarray([[features[name] for name in FEATURE_NAMES]], dtype=np.float64)
    probability = float(model.predict_proba(row)[0, 1])
    return {
        "clone_probability": round(probability, 4),
        "model": "Demonstration ML Baseline",
        "model_version": MODEL_VERSION,
        "feature_order": FEATURE_NAMES,
    }
