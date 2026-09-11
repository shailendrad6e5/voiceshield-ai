# API contract

All responses are JSON. The Netlify redirect exposes these function routes under `/api`.

## Read endpoints

| Endpoint | Result |
| --- | --- |
| `GET /api/health` | `status: "online"` only when the Netlify Function responds |
| `GET /api/stats` | Counts, average risk, measured processing latency, risk/severity distribution, threat distribution and ledger validity |
| `GET /api/analyses` | Newest-first analysis records for the current function instance |
| `GET /api/alerts` | Newest-first HIGH/CRITICAL alerts |
| `GET /api/ledger` | Chain entries, SHA-256/canonical-JSON metadata and a `valid` integrity result |

## `POST /api/simulate`

Request one deterministic, controlled feature preset:

```json
{ "scenario": "REPLAY" }
```

Allowed scenarios are `NORMAL`, `CLONED_VOICE`, `REPLAY`, `LOW_QUALITY`, and `MIXED_RISK`. The response has a `description` and one `result`. The preset represents pipeline-test feature data, not a real voice recording.

## `POST /api/analyze`

The browser supplies this complete numeric feature vector after validating a WAV file:

```json
{
  "features": {
    "duration_s": 2.5,
    "rms": 0.15,
    "peak": 0.61,
    "clipping_ratio": 0.001,
    "zero_crossing_rate": 0.1,
    "spectral_centroid": 1200,
    "spectral_bandwidth": 1500,
    "spectral_flatness": 0.15,
    "spectral_rolloff": 2500,
    "dynamic_range": 0.7,
    "pitch_proxy": 150,
    "pitch_variation": 0.05,
    "silence_ratio": 0.1,
    "high_freq_ratio": 0.05,
    "quality_score": 0.95
  }
}
```

All fields are required, finite, and range-checked. Unknown fields, missing fields, malformed JSON, oversized API bodies and invalid numeric values receive a `400` response. The function returns an analysis ID, model disclosure, five signal values, risk score, severity, human-readable evidence, recommendation, measured processing latency and alert linkage when applicable.

## `POST /api/alerts/{id}/status`

```json
{ "status": "INVESTIGATING" }
```

Permitted statuses are `NEW`, `INVESTIGATING`, and `RESOLVED`. A valid transition updates current function-memory state and appends `ALERT_STATUS_CHANGED` to the audit chain. An unknown alert returns `404`; an invalid status returns `400`.

## `POST /api/analyses/{id}/verification`

Requests the handbook-supported step-up verification workflow for a HIGH or CRITICAL analysis. The prototype records `STEP_UP_VERIFICATION_REQUESTED` in the SHA-256 ledger and returns a safe workflow state. It never performs financial, account, biometric, or other irreversible actions. LOW and MEDIUM analyses return `409` because verification is not required by their current prototype response policy.

## Error shape

```json
{ "detail": "Human-readable validation message." }
```
