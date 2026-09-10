# Security Architecture

```text
Authorized Voice Source
        |
        v
READ-ONLY AUDIO CAPTURE
        |
        v
Streaming Chunk Processor
        |
        v
Acoustic Feature Extraction
        |
        +--> Demo ML Clone Classifier
        +--> Speaker-Match Indicator
        +--> Passive Liveness Indicator
        +--> Replay Indicator
        |
        v
Transparent Risk Fusion
        |
        +--> LOW/MEDIUM: monitored workflow
        +--> HIGH/CRITICAL: step-up verification + alert
        |
        v
SOC Dashboard + Tamper-Evident Audit Ledger
```

## Trust boundaries
1. Audio is treated as untrusted input.
2. File upload is validated and decoded locally.
3. The prototype has no telephony integration and no outbound network action.
4. Prevention means gating a sensitive workflow pending stronger verification; it is not an automated transaction.
5. Audit records are hash chained so modifications are detectable.
