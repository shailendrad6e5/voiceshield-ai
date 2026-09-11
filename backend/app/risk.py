"""Transparent, bounded heuristic and risk-fusion functions."""

from __future__ import annotations

import math
from typing import Mapping


def _unit(value: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return min(1.0, max(0.0, number)) if math.isfinite(number) else 0.0


def derive_heuristics(features: Mapping[str, float]) -> dict[str, float]:
    """Return bounded demo evidence scores; none is identity or liveness proof."""
    pitch = max(0.0, float(features.get("pitch_proxy", 0.0)))
    pitch_variation = max(0.0, float(features.get("pitch_variation", 0.0)))
    dynamic_range = max(0.0, float(features.get("dynamic_range", 0.0)))
    flatness = max(0.0, float(features.get("spectral_flatness", 0.0)))
    high_frequency = max(0.0, float(features.get("high_freq_ratio", 0.0)))
    quality = _unit(features.get("quality_score", 0.0))

    speaker_match = _unit(0.82 - abs(pitch - 175.0) / 145.0 - max(0.0, 0.035 - pitch_variation) * 2.0)
    liveness = _unit(
        0.90
        - max(0.0, 0.060 - pitch_variation) * 7.0
        - max(0.0, 0.30 - dynamic_range)
        - 0.25 * (1.0 - quality)
    )
    replay = _unit(
        0.10
        + (0.30 if flatness < 0.08 else 0.0)
        + (0.20 if dynamic_range < 0.45 else 0.0)
        + (0.20 if pitch_variation < 0.025 else 0.0)
        + (0.15 if high_frequency < 0.005 else 0.0)
    )
    return {
        "speaker_match": speaker_match,
        "liveness": liveness,
        "replay_score": replay,
        "quality_score": quality,
    }


def score(clone_probability: float, speaker_match: float, liveness: float, replay_score: float = 0.0) -> tuple[float, str, float]:
    """Fuse normalized inputs into the handbook's 0-100 severity bands."""
    clone_probability = _unit(clone_probability)
    speaker_match = _unit(speaker_match)
    liveness = _unit(liveness)
    replay_score = _unit(replay_score)
    risk = 100 * (
        0.50 * clone_probability
        + 0.22 * (1 - speaker_match)
        + 0.20 * (1 - liveness)
        + 0.08 * replay_score
    )
    risk = round(min(100.0, max(0.0, risk)), 1)
    severity = "LOW" if risk < 35 else "MEDIUM" if risk < 65 else "HIGH" if risk < 85 else "CRITICAL"
    confidence = round(100 * max(clone_probability, 1 - speaker_match, 1 - liveness, replay_score), 1)
    return risk, severity, confidence


def prevention_action(severity: str) -> str:
    if severity in {"HIGH", "CRITICAL"}:
        return "REQUIRE STEP-UP VERIFICATION"
    if severity == "MEDIUM":
        return "REQUEST CONTEXTUAL REVIEW"
    return "CONTINUE MONITORED WORKFLOW"


def classify_threat(clone_probability: float, replay_score: float, quality_score: float, risk_score: float) -> str:
    if quality_score < 0.45 and clone_probability < 0.50 and replay_score < 0.60:
        return "LOW AUDIO QUALITY / INCONCLUSIVE"
    if clone_probability >= 0.65 and replay_score >= 0.60:
        return "MULTIPLE SUSPICIOUS SIGNALS"
    if replay_score >= 0.60:
        return "POTENTIAL REPLAY / IMPERSONATION"
    if clone_probability >= 0.65:
        return "POTENTIAL SYNTHETIC / CLONED VOICE"
    return "NEEDS REVIEW" if risk_score >= 35 else "NORMAL / NEEDS REVIEW"


def evidence(features: Mapping[str, float], clone_probability: float, heuristics: Mapping[str, float]) -> list[dict[str, object]]:
    """Produce concise, feature-grounded explanations for the current prototype."""
    reasons: list[dict[str, object]] = []
    if clone_probability >= 0.65:
        reasons.append({"feature": "clone_probability", "observed": round(clone_probability, 3), "baseline": "< 0.50", "reason": "The Demonstration ML Baseline marked this feature pattern as synthetic-like."})
    if features.get("spectral_flatness", 1.0) < 0.08:
        reasons.append({"feature": "spectral_flatness", "observed": round(features["spectral_flatness"], 4), "baseline": ">= 0.08 in this demo", "reason": "The segment has an unusually smooth spectral distribution."})
    if features.get("pitch_variation", 1.0) < 0.025:
        reasons.append({"feature": "pitch_variation", "observed": round(features["pitch_variation"], 4), "baseline": ">= 0.025 in this demo", "reason": "The pitch proxy changes very little across analysis frames."})
    if heuristics["speaker_match"] < 0.55:
        reasons.append({"feature": "speaker_match_evidence", "observed": round(heuristics["speaker_match"], 3), "baseline": ">= 0.55", "reason": "The audio deviates from the demo reference profile. This is not biometric identity proof."})
    if heuristics["liveness"] < 0.55:
        reasons.append({"feature": "passive_liveness_indicator", "observed": round(heuristics["liveness"], 3), "baseline": ">= 0.55", "reason": "The demo liveness heuristic found limited natural acoustic variation; request stronger verification."})
    if heuristics["replay_score"] >= 0.60:
        reasons.append({"feature": "replay_indicator", "observed": round(heuristics["replay_score"], 3), "baseline": "< 0.60", "reason": "Replay-oriented spectral, timing, and bandwidth indicators exceeded the demo threshold."})
    if heuristics["quality_score"] < 0.45:
        reasons.append({"feature": "quality_score", "observed": round(heuristics["quality_score"], 3), "baseline": ">= 0.45", "reason": "Audio quality is insufficient for a reliable decision. Low quality alone is not fraud evidence."})
    return reasons or [{"feature": "risk_fusion", "observed": "limited suspicious evidence", "baseline": "normal", "reason": "No configured demonstration detector exceeded its explanation threshold."}]
