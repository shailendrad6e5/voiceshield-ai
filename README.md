# VoiceShield AI — SIH26104 Prototype

**AI-Powered Real-Time Detection and Prevention of Voice Cloning Impersonation Attacks.**

## 1. Problem
Voice cloning and replay attacks are increasingly used in social engineering, help-desk fraud, and automated authentication bypass. A cloned voice can manipulate a human operator or bypass an unprotected voice gateway.

## 2. Threat Model
**Protected Assets:** Identity confidence, account actions, customer trust, call-center workflows.
**Adversary Goal:** Impersonate a trusted speaker or reuse a recording to influence a decision.
**Detection Boundary:** The system receives audio and extracts derived signal features locally; it does not place outbound calls.

## 3. Architecture
The system follows a strict security pipeline:
**DETECT → ANALYZE → SCORE → EXPLAIN → ALERT → VERIFY**

1. Authorized Audio Source
2. Read-only Audio Capture
3. Feature Extraction (12 acoustic signals)
4. Demonstration ML Baseline + Passive Liveness Indicators + Replay Indicators
5. 0-100 Risk Fusion Engine
6. Prevention Policy (Step-Up Verification)
7. Alert Center + Tamper-Evident SHA-256 Audit Ledger

## 4. Features
- **WAV Upload & Validation:** Accepts real WAV audio, checks boundaries, and handles numeric extraction safely.
- **Simulation Lab:** 5 reproducible demonstration scenarios (NORMAL, CLONED_VOICE, REPLAY, LOW_QUALITY, MIXED_RISK).
- **Risk Scoring:** 0-100 score classifying into LOW, MEDIUM, HIGH, and CRITICAL.
- **Explainable Evidence:** Human-readable reasoning mapping directly to derived acoustic features.
- **Tamper-Evident Audit Ledger:** Local JSON-backed SHA-256 hash chaining to prove audit trail integrity.
- **Real Latency Tracking:** Dashboard shows observed processing time, not fabricated benchmarks.

## 5. Technology Stack
- **Frontend:** React 18, Vite, TypeScript, Lucide-React.
- **Backend:** Python 3.10+, FastAPI, Uvicorn.
- **Audio & ML Processing:** NumPy, SciPy, Scikit-Learn.
- **Persistence:** Local JSON file (`data/db.json`) for demo-friendly state persistence across restarts.

## 6. Audio Pipeline
The browser (or backend in demo mode) receives the PCM samples and extracts 12 features including RMS, Zero Crossing Rate, Spectral Centroid, Bandwidth, Flatness, Rolloff, Pitch Proxy, Pitch Variation, and Silence Ratio. These features are bounded to prevent NaN/Infinity crashes.

## 7. Risk Engine
The risk engine fuses the Demonstration ML Baseline probability with heuristic penalty scores:
`Risk = 50% ML + 22% Speaker Mismatch + 20% Weak Liveness + 8% Replay Evidence`

## 8. Explainability
Every risk score comes with an explanation array detailing exactly which features breached expected thresholds (e.g., "Replay Indicator observed replay-like spectral/timing characteristics").

## 9. Security Controls
- Strict input validation (5MB max upload, RIFF/WAVE header validation).
- Safe mathematical processing of features.
- CORS restricted to the frontend application.
- Prevention policy only *recommends* verification; no automated destructive actions.

## 10. Audit Chain
Every completed analysis and alert status change is appended to the ledger. Each entry hashes the previous entry's hash combined with its own payload using SHA-256, guaranteeing tamper-evidence.

## 11. API
- `GET /api/health`
- `GET /api/stats`
- `GET /api/alerts`
- `GET /api/ledger`
- `POST /api/analyze` (multipart WAV upload)
- `POST /api/simulate` (run scenario)
- `POST /api/alerts/{id}/status` (update alert state)

## 12. Demo Instructions
1. Open the **Dashboard**. Point out the "Prototype Demonstration" and "Read-Only" trust boundaries.
2. Run the **NORMAL** simulation. Show the low risk score.
3. Run the **CLONED_VOICE** simulation. Highlight the CRITICAL severity and step-up verification recommendation.
4. Click **Alert Center**. Change the status of the new alert from NEW to INVESTIGATING.
5. Click **Audit Ledger**. Explain that the "Tamper-Evident Hash Chain" links the analysis and the status update securely.
6. (Optional) Upload a real `demo_audio/` WAV file to prove the pipeline handles live data safely.

---

## CURRENT PROTOTYPE vs FUTURE PRODUCTION SYSTEM

### 13. Current Limitations (Prototype)
- **Model:** The "Demonstration ML Baseline" is a Random Forest model trained on generated synthetic distributions. It is NOT a production-validated deepfake detector.
- **Liveness/Speaker-Match:** These are implemented as heuristic acoustic math (pitch variation, dynamic range) to demonstrate the architecture, rather than true neural embeddings (like ECAPA-TDNN).
- **Streaming:** The current prototype is request/response chunk-based.
- **Persistence:** Local JSON file is used to keep the demo stable. 

### 14. Future Roadmap (Production)
- **Phase 1 (Done):** Prototype architecture, UI, explainable risk engine, and reproducible demo.
- **Phase 2:** Train models on real labeled datasets (e.g., ASVspoof) and publish formal ROC/F1 evaluations.
- **Phase 3:** Integrate robust speaker embeddings and deep-learning anti-spoofing.
- **Phase 4:** True real-time continuous scoring via WebRTC or WebSockets.
- **Phase 5:** Durable database storage and optional permissioned blockchain if multi-party trust is required.

---

## Deployment Configuration

**Backend:**
The backend is a FastAPI server. It is recommended to deploy this to Render, Railway, or a traditional VPS.
```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**Frontend:**
The frontend is a static Vite application. It can be easily deployed to Netlify, Vercel, or GitHub Pages. 
Make sure to update the `API` constant in `src/main.tsx` to point to the deployed backend URL.
```bash
cd frontend
npm install
npm run build
# Deploy the 'dist' folder to your static host.
```
