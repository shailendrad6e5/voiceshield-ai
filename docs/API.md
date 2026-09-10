# API

- `GET /api/health` — system safety status.
- `POST /api/analyze` — analyze an uploaded WAV.
- `POST /api/simulate` — run NORMAL, CLONED_VOICE, REPLAY, LOW_QUALITY or MIXED_RISK.
- `GET /api/alerts` — current alerts.
- `POST /api/alerts/{alert_id}/status` — update internal alert workflow state.
- `GET /api/stats` — processed analytics.
- `GET /api/ledger` — audit chain and integrity check.
- `GET /api/report` — JSON passive threat report.
