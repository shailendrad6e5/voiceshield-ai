# Netlify deployment guide

VoiceShield AI deploys as a root-published static site plus one JavaScript Netlify Function. It has no Python runtime requirement.

## Prerequisites

- Node.js 18 or later
- A Netlify account for production deployment

## Local verification

```bash
npm install
npm test
npm run build
npm start
```

`netlify dev` serves the root files and routes `/api/*` to `netlify/functions/api.js`. Open the displayed URL and confirm that the header changes from **Checking API** to **API Online** only after `/api/health` succeeds.

## Deploy

1. Create a new Netlify site from this repository or use the Netlify CLI after logging in.
2. Keep the repository root as the base directory.
3. Netlify reads `netlify.toml`: `publish = "."` and `functions = "netlify/functions"`.
4. Use `npm run build` as the build command. It validates the static-site build contract and does not create a frontend bundle.
5. Deploy, then request `/api/health`, `/api/stats`, and one `/api/simulate` scenario on the deployed site.

The first function request can start a fresh instance. Demo analyses, alerts and ledger entries are held only in that function instance's memory, so they may reset. The browser keeps a local display cache for UI fallback; it is not an audit store.

## Routes

- `/api/*` -> `/.netlify/functions/api/:splat`
- all remaining routes -> `/index.html`

The prototype uses request/response calls. Do not describe this deployment as real-time streaming.
