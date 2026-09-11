# Security Architecture

```text
Authorized Voice Source
        |
        v
READ-ONLY AUDIO CAPTURE
        |
        v
Streaming Chunk Processor (Future) / Request Processor (Prototype)
        |
        v
Acoustic Feature Extraction
        |
        +--> Demonstration ML Baseline (Clone Classifier)
        +--> Speaker-Match Evidence
        +--> Passive Liveness Indicator
        +--> Replay Indicator
        |
        v
Transparent Risk Fusion (0-100)
        |
        +--> LOW/MEDIUM: monitored workflow
        +--> HIGH/CRITICAL: step-up verification + alert
        |
        v
SOC Dashboard + Tamper-Evident Audit Ledger
```

## Trust Boundaries
1. **Audio is treated as untrusted input.** The pipeline validates the RIFF/WAVE header and caps size before feature extraction.
2. **Feature Extraction is isolated locally.** Deriving safe numeric features locally prevents exposing internal systems to arbitrary audio code execution.
3. **No outbound destructive actions.** The prototype has no telephony integration and no outbound network action.
4. **Prevention is workflow-based.** Prevention means gating a sensitive workflow pending stronger verification; it is not an automated transaction.
5. **Audit records are cryptographic.** Audit records are hash chained (SHA-256) so modifications are detectable immediately.

## Data Minimization & Privacy
The architecture specifically supports discarding raw audio once acoustic features are computed. The API does not persist raw WAVs, but only the numeric summaries (`duration_s`, `rms`, `spectral_centroid`, etc.) used to evaluate risk.

## Production vs. Prototype
- The prototype uses a static ML baseline trained on demonstration metrics and is request/response based.
- Production systems require deep-learning based speaker embeddings (e.g. ECAPA-TDNN), extensive ASVspoof-style anti-spoofing models, and true continuous streaming architecture over WebSockets or WebRTC.
- The prototype persists its tamper-evident ledger via a JSON file. Production systems would require a durable, highly available database.
