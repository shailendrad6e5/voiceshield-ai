# Model Card - Demonstration ML Baseline

## Summary

**Name:** Deterministic Feature-Based Demonstration Classifier

**Version:** `1.1.0-js-demo`

**Runtime:** JavaScript Netlify Function
**Type:** Transparent deterministic rules plus acoustic heuristics

The classifier maps a limited set of browser-derived audio descriptors to a clone-probability risk signal. Risk Fusion combines this with heuristic speaker-match, liveness and replay signals. It is designed to make the prototype's decision path reproducible and explainable.

## Intended use

Controlled SIH demonstration of a defensive pipeline: input validation, numeric feature ingestion, risk calculation, evidence, alert generation, step-up recommendation and tamper-evident logging.

## Not intended for

- Real-world or universal deepfake detection
- Voice-biometric identity confirmation
- Production authentication or automatic account decisions
- Accuracy, fairness or prevalence claims

## Data and evaluation

The classifier has no production training dataset or held-out evaluation. The simulation cards use controlled preset feature profiles and are not real human or cloned-human recordings. No accuracy percentage is claimed.

## Limitations and risk controls

The features are lightweight and basic. Speaker match is not a speaker embedding. Liveness and replay are demonstration indicators, not production anti-replay defenses. Low quality reduces confidence and is not treated as fraud by itself. HIGH and CRITICAL outcomes recommend step-up verification rather than irreversible action.

Production work needs representative multilingual data, including Hindi, English, Hinglish, Indian regional accents and diverse speakers; speaker-disjoint evaluation; calibrated thresholds; false-positive/false-negative assessment; privacy review; monitoring; and secure authenticated deployment.
