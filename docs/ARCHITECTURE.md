# Architecture

## Deployed flow

```text
Browser WAV/preset input
  -> client-side validation and feature extraction
  -> Netlify Function API
  -> deterministic demonstration classifier + acoustic heuristics
  -> Risk Fusion and severity
  -> explainable evidence and safe response recommendation
  -> HIGH/CRITICAL alert
  -> SHA-256 tamper-evident hash-chain entry
```

The frontend is static HTML, CSS and vanilla JavaScript. `app.js` parses supported WAV/PCM audio locally, calculates RMS, peak, clipping, zero-crossing, spectral, dynamic-range, pitch-proxy, silence, quality and related numeric descriptors, then sends only those feature values to `/api/analyze`.

`netlify/functions/api.js` validates every required feature as finite and within an allowed range. Its deterministic JavaScript classifier and explicit heuristics calculate clone probability, speaker-match signal, liveness signal, replay signal, quality and the handbook-aligned risk formula.

## State and audit integrity

The function stores analyses, alerts and ledger entries only in the current warm function instance. This is deliberate demo state, not durable storage. The browser stores the last received snapshot locally only to render a fallback when the API is offline.

Each ledger entry contains its sequence index, event ID, ISO timestamp, event type, payload, previous hash and hash. Hashing uses SHA-256 over canonical JSON with recursively sorted object keys. `GET /api/ledger` recomputes and reports chain validity. This is a SHA-256 tamper-evident hash chain, not a decentralized blockchain.

## Safety boundaries

- High risk recommends step-up verification; it never performs financial, account, or other irreversible actions.
- Speaker match is a risk signal, not an identity decision.
- Low audio quality is an uncertainty signal, not fraud evidence.
- The system does not retain raw audio in the client-to-API flow.
- Production requires access controls, durable secure storage, encryption, retention rules, rate limits and monitoring.

## Future work

Production validation should include Hindi, English, Hinglish, Indian regional accents and diverse speakers. It also requires evaluated anti-spoofing models, speaker embeddings, stronger liveness/replay defenses, real streaming transport, secure authentication, durable audit retention and deployment monitoring.
