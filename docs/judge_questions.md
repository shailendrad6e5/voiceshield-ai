# VoiceShield AI — SIH26104 Judge Questions & Answers

**1. Does this detect every deepfake?**
No. This is a prototype system. Universal deepfake detection is an unsolved industry problem. Our goal is to demonstrate the *risk engine and response policy architecture* (scoring, explaining, alerting, and verifying) using a demonstration baseline model, not to claim 100% accuracy against unseen attacks.

**2. Is your ML model production-ready?**
No, it is a Demonstration ML Baseline. In this prototype, we use a Random Forest model. A production system requires a much larger deep learning stack trained on a diverse corpus of genuine speech, codecs, and specific spoofing attacks (like TTS and voice conversion) with strict speaker-disjoint evaluation.

**3. Why use Random Forest instead of a Deep Neural Network?**
Random Forest was chosen for the prototype because it provides a strong, interpretable baseline for tabular acoustic features, handles mixed feature scales well, and is extremely fast to run in a serverless/demo environment.

**4. What exactly are you extracting from the audio?**
We extract 12 basic acoustic features: duration, RMS (energy), Zero-Crossing Rate (ZCR), spectral centroid, bandwidth, flatness, rolloff, dynamic range, a pitch proxy, pitch variation, silence ratio, and high-frequency ratio. 

**5. How do you detect replay attacks?**
In this demonstration, our Replay Indicator relies on heuristic signal thresholds (like spectral flatness and dynamic range consistency) which often change when audio is played through a physical speaker and re-recorded. Production replay detection relies on advanced phase and frequency anomaly modeling.

**6. What is the Passive Liveness Indicator?**
It is a heuristic check looking for the natural acoustic variability (like pitch variation and dynamic range) expected in live human interaction. If these are too stable or too noisy, the liveness score drops.

**7. How do you match the speaker's identity?**
This prototype calculates a "Speaker-Match Evidence" score using a simple pitch-proxy heuristic for demonstration purposes. It does not prove identity. A production deployment must integrate a proper speaker embedding model (e.g., x-vectors or ECAPA-TDNN).

**8. How do you calculate the 0-100 Risk Score?**
We use a multi-signal transparent fusion approach:
`Risk = (50% ML Baseline) + (22% Speaker Mismatch) + (20% Weak Liveness) + (8% Replay Evidence)`
The score is clamped between 0 and 100, ensuring no single weak signal automatically triggers a block without corroborating evidence.

**9. What happens if the risk score is HIGH or CRITICAL?**
We apply the principle of *workflow gating*. The system does not automatically block accounts. Instead, it flags the interaction for "step-up verification" (e.g., requesting an SMS OTP, biometric push, or analyst review) and writes to the audit ledger.

**10. What is your "Tamper-Evident Hash Chain"? Is it Blockchain?**
It is a local SHA-256 hash chain where each audit event includes the hash of the previous event. This guarantees cryptographic tamper-evidence (if an attacker modifies a past log, all subsequent hashes break). It is *not* a decentralized blockchain, as there is no distributed consensus network, which is overkill for this scope.

**11. Where is the data stored?**
For this prototype, we use a lightweight local JSON file (`data/db.json`) so the ledger and alerts survive server restarts. We adhere strictly to data minimization: we do not permanently store the uploaded raw audio WAV files, only the derived telemetry.

**12. How do you handle scalability and latency?**
The frontend is a completely static React/Vite app hosted on a CDN. The backend is a stateless FastAPI service that can be containerized or run serverless. The observed latency shown in our dashboard is the actual measured processing time (typically <50ms for feature extraction and Random Forest inference).

**13. What if an attacker uploads a massive 1GB audio file to crash the server?**
We have implemented strict input validation. The API enforces a 5MB payload limit, validates the RIFF/WAVE header, and handles NaN/Infinity anomalies in the audio signal safely.

**14. Are you streaming audio in real-time?**
The current prototype uses a request/response chunking model for simplicity and stability. True real-time continuous streaming over WebRTC or WebSocket is documented in our future roadmap.

**15. Does low audio quality mean the audio is a deepfake?**
No. Poor audio quality reduces the reliability of our analysis, but it is not inherently malicious. Our risk engine separates quality warnings from fraud indicators.

**16. How do you avoid false positives blocking legitimate users?**
By using proportionate response boundaries. Only a CRITICAL score (>85) requires analyst review. A MEDIUM score (35-64) merely flags for contextual scrutiny. The system is defensive—it recommends step-up verification rather than destructive actions.

**17. How did you secure your API?**
We implemented strict CORS policies (only allowing requests from our frontend origin), input sanitization, safe error handling (no stack traces leaked), and strict boundaries preventing arbitrary code execution from uploads.

**18. Why not use PyTorch/TensorFlow?**
We adhered to data minimization and architectural simplicity. Heavy deep-learning frameworks would drastically slow down our deployment cold starts, and without a massively curated real-world dataset to train on, a large DNN would just be memorizing synthetic noise anyway.

**19. What are the known limitations of this prototype?**
The biggest limitation is the ML baseline, which is trained on generated distributions. The system also currently lacks multi-lingual support, true continuous streaming, and robust background noise denoising.

**20. What is the future production roadmap?**
Phase 1 (current) is this reproducible architecture. Phase 2 involves evaluating on real-world datasets like ASVspoof. Phase 3 introduces proper speaker embeddings. Phase 4 adds WebRTC streaming, and Phase 5 scales up to enterprise SIEM integration.
