# Model Card

**Model:** VoiceClone-DemoRF v0.1-demo-synthetic

**Algorithm:** Random Forest

**Training:** Generated synthetic acoustic feature distributions representing normal and synthetic-like speech.

**Validation:** Synthetic hold-out only.

**Metrics:** Deliberately not presented as real-world performance. A real SIH deployment should train and validate on speaker-disjoint real datasets and report precision, recall, F1, ROC-AUC, EER and calibration across languages, microphones, codecs, TTS/VC families and replay conditions.

**Limitations:** Acoustic heuristics can produce false positives/negatives. Speaker matching is not identity proof. Liveness is passive and should be combined with a controlled challenge-response mechanism where appropriate.
