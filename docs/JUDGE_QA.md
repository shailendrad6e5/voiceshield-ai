# Judge Q&A

**Can VoiceShield detect every deepfake?**  
No. This is an explainable demonstration prototype. Production validation with representative held-out data is future work.

**Is a Random Forest running on Netlify?**  
No. The final JavaScript-only runtime uses a deterministic feature-based Demonstration ML Baseline. The handbook's Random Forest concept informed the prototype scope, but this function does not claim to run that model.

**Does speaker match verify identity?**  
No. It is a risk signal. The prototype never makes a biometric identity verdict.

**Why is low quality not automatically fraud?**  
Poor audio makes the evidence unreliable. It should prompt better input or contextual review, not a fraud claim on its own.

**What happens at high risk?**  
The application recommends step-up verification and creates an analyst alert. It does not transfer money, block accounts, or take irreversible action.

**Is it real-time?**  
The current prototype is request/response. Streaming WebRTC or WebSocket analysis is a future architecture.

**Is this blockchain?**  
The prototype uses a SHA-256 tamper-evident hash chain. It has no decentralized consensus or network, so it is not described as blockchain.

**How is privacy addressed?**  
For supported WAV analysis, the browser derives numeric features locally and sends those values rather than raw audio to the API. Production still needs consent, secure storage, encryption, retention and access-control policies.

**How would it support Indian languages and accents?**  
That is a production-validation requirement, not a current claim. The roadmap includes Hindi, English, Hinglish, regional accents, diverse speakers and multilingual evaluation datasets.
