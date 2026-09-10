# VoiceShield AI — SIH26104 Prototype

AI-Powered Real-Time Detection and Prevention of Voice Cloning Impersonation Attacks.

## Core principle
**CAPTURE → ANALYZE → VERIFY → RISK SCORE → ALERT/PREVENT**

The prototype is designed for authorized voice streams/call recordings. It does not place calls, impersonate people, bypass authentication, or perform actions against external systems.

### Safety / honesty
- Audio processing is local to the application in this prototype.
- No claim of production-grade deepfake detection accuracy is made.
- The included ML model is a **DEMO/SYNTHETIC** Random Forest trained on generated feature distributions.
- The blockchain component is a local **tamper-evident hash chain**, not a decentralized public blockchain.
- Prevention is workflow-level: require additional verification, hold/flag a sensitive request, and create an audit record. It does not automatically execute financial/account actions.

## Architecture
Caller / Authorized Audio Source
→ Read-only Audio Capture
→ Streaming Audio Chunk Processor
→ Voice Feature Extraction
→ Deepfake/Clone Detector + Speaker Verification + Liveness Checks
→ Risk Fusion Engine
→ Prevention Policy
→ Alert Center + Audit Ledger
→ SOC Dashboard

## Features
- WAV upload and incremental chunk analysis
- Synthetic/demo scenario generator: NORMAL, CLONED_VOICE, REPLAY, LOW_QUALITY, MIXED_RISK
- Clone probability, speaker-match score, liveness score, risk score
- Explainable evidence based on calculated features
- Challenge-response verification workflow
- Alert center with NEW / INVESTIGATING / RESOLVED
- IP/phone identifiers are treated as metadata only; no outbound calls
- Tamper-evident audit ledger with SHA-256 hash chaining
- Live dashboard via REST polling
- Analytics and model documentation pages
- JSON report export

## Run backend
Python 3.10+

```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

## Run frontend
Node 18+

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL, normally http://localhost:5173.

## Optional ML retraining
```bash
cd ml
python train_demo_model.py
```

This creates `models/voice_clone_demo.joblib`.

## Demo sequence
1. Open Dashboard and confirm `READ-ONLY AUDIO INGEST`.
2. Run NORMAL simulation.
3. Run CLONED_VOICE simulation.
4. Open the alert and inspect evidence.
5. Start challenge-response verification.
6. Run REPLAY and MIXED_RISK scenarios.
7. Inspect the audit ledger and analytics.
8. Export the passive incident report.

## Important limitation
A robust real-world anti-spoofing system normally requires a carefully curated corpus containing genuine speech, replay attacks, TTS, voice conversion, codecs, microphones, languages and adversarial conditions, with speaker-disjoint validation. This prototype deliberately labels its synthetic metrics as demonstration results.
