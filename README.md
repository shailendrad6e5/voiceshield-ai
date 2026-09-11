# VoiceShield AI - SIH26104

VoiceShield AI is a serverless cybersecurity demonstration prototype for assessing voice-cloning and replay-oriented impersonation risk. Its safe decision flow is:

`DETECT -> ANALYZE -> SCORE -> EXPLAIN -> ALERT -> VERIFY`

The prototype converts a supported WAV file into browser-derived numeric features, applies a deterministic JavaScript **Demonstration ML Baseline**, fuses risk signals, explains the result, creates HIGH/CRITICAL alerts, and records events in a SHA-256 tamper-evident hash chain.

It does not claim universal deepfake detection, biometric identity verification, real-time streaming, or a decentralized blockchain.

## Current implementation

- HTML5, CSS3, and vanilla ES6 JavaScript static frontend
- Browser-side 16-bit PCM WAV parsing and acoustic feature extraction
- JavaScript Netlify Function API; no Python service or continuously running backend
- Five deterministic controlled/preset feature profiles: `NORMAL`, `CLONED_VOICE`, `REPLAY`, `LOW_QUALITY`, and `MIXED_RISK`
- Explainable Risk Fusion, analysis monitor, alert workflow, step-up verification request, and a SHA-256 tamper-evident hash chain
- Ephemeral function-memory state plus a browser cache for graceful UI fallback; neither is durable production storage

Raw WAV bytes are not sent to the API in this client flow. Browser validation accepts only 16-bit PCM, mono/stereo WAV at 8-48 kHz, 0.25-60 seconds, up to 10 MB.

## Risk Fusion

```text
risk = 100 * (
  0.50 * clone_probability
  + 0.22 * (1 - speaker_match)
  + 0.20 * (1 - liveness)
  + 0.08 * replay_score
)
```

The function clamps risk to 0-100. Severity is LOW below 35, MEDIUM from 35-64, HIGH from 65-84, and CRITICAL from 85-100. Speaker match, liveness, replay and confidence are risk signals - not proof of identity, fraud, or model accuracy.

HIGH and CRITICAL outcomes recommend step-up verification. The prototype does not transfer money, change accounts, or take irreversible actions.

## Run and test

```bash
npm install
npm test
npm run build
npm start
```

Open the local Netlify URL printed by `netlify dev`. The UI calls `/api/health` before reporting the system as online. See [DEPLOY.md](DEPLOY.md) and the [demo script](docs/DEMO_SCRIPT.md).

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Live Netlify Function health |
| GET | `/api/stats` | Dashboard metrics and distributions |
| GET | `/api/alerts` | Current HIGH/CRITICAL alerts |
| GET | `/api/analyses` | Recent feature-analysis results |
| GET | `/api/ledger` | SHA-256 chain and verification result |
| POST | `/api/simulate` | Run a controlled scenario profile |
| POST | `/api/analyze` | Analyze validated browser-derived features |
| POST | `/api/analyses/{id}/verification` | Record a step-up verification request for a HIGH/CRITICAL analysis |
| POST | `/api/alerts/{id}/status` | Update `NEW`, `INVESTIGATING`, or `RESOLVED` |

Full request and response details are in [docs/API.md](docs/API.md).

## Transparency and limitations

The **Deterministic Feature-Based Demonstration Classifier** is not a Random Forest running on Netlify and is not a production-validated anti-spoofing model. The presets are controlled feature profiles for pipeline testing, not real speech recordings. The current design is request/response; streaming, durable secure storage, authentication, multilingual/Indian-accent validation, production liveness, production anti-replay, and real model evaluation are future work.

The ledger is a **SHA-256 tamper-evident hash chain**, not a decentralized blockchain. A permissioned ledger is only a possible future extension if multi-party trust makes it necessary.
