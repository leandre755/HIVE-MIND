# Domaine 2 : Fournisseurs d'IA & Routage Intelligent (`providers/`)

Le domaine **Providers** rassemble les cinq sous-systèmes fondamentaux (de **SS-10** à **SS-14**) formant l'infrastructure d'intelligence, d'exécution des modèles de fondation (*Foundation Models*), de normalisation dialectale, de routage adaptatif résilient, d'authentification OAuth avancée et de synthèse vocale multimodale de HIVE-MIND.

---

## 🧭 Cartographie des Sous-Systèmes Providers (SS-10 à SS-14)

| Sous-Système | Responsabilité Principale | Fichiers Sources Majeurs |
| :--- | :--- | :--- |
| **SS-10 : Layer 0 ExecutionLayer & ModelRegistry** | Moteur d'exécution réseau stateless, indexation des modèles, signature d'en-têtes et classification déterministe d'erreurs. | `src/providers/layer0/ExecutionLayer.ts`, `ModelRegistry.ts`, `classifyError.ts`, `src/providers/families/` |
| **SS-11 : GenerationParams & MessageConverter** | Normalisation universelle des paramètres d'inférence, injection de Prompt Caching et conversion pivot $\longleftrightarrow$ wire (OpenAI, Anthropic, Gemini, Cohere). | `src/providers/GenerationParams.ts`, `src/providers/families/protocols/messageConverter.ts`, `src/providers/toolIds.ts` |
| **SS-12 : Layer 1 SmartLayer & ModelHealthRegistry** | Routage résilient avec cascade séquentielle plate (zéro récursion), disjoncteur 3-états à 6 compartiments temporels, escalade de famille et verrou de flux SSE. | `src/providers/layer1/SmartLayer.ts`, `ModelHealthRegistry.ts`, `ServiceRegistry.ts`, `CredentialProvider.ts` |
| **SS-13 : Advanced OAuth Adapters (Codex & Antigravity)** | Ponts d'authentification OAuth 2.0 pour modèles SOTA (OpenAI ChatGPT Plus/Pro via Responses API, Google Cloud Code Assist), rafraîchissement proactif et impersonation TLS JA3. | `src/providers/adapters/codex.ts`, `antigravity.ts`, `codexProtocol.ts`, `src/utils/TlsImpersonator.ts` |
| **SS-14 : Multimodal Voice Synthesis & Real-Time Streaming** | Synthèse vocale TTS (Minimax Speech-01, Gemini Flash avec Director's Notes, GTTS), transcodage OGG Opus WhatsApp via FFmpeg et sessions WebSocket bidirectionnelles Gemini Live. | `src/providers/geminiLive.ts`, `src/providers/adapters/geminiTTS.ts`, `minimaxTTS.ts`, `gttsTTS.ts`, `ttsTypes.ts` |

---

## 📚 Documentation Modulaire par Sous-Système (Triplets Diátaxis)

### 1. SS-10 — Layer 0 ExecutionLayer & ModelRegistry
- 🧠 **Explication :** [Architecture & Principes du Moteur d'Exécution Stateless](./layer0-execution-explanation.md)
- 📜 **Référence :** [Interfaces, Classes ExecutionLayer, ModelRegistry & Erreurs Typées](./layer0-execution-reference.md)
- 🛠️ **Guide Pratique :** [Comment Exécuter et Tester des Inférences LLM via Layer 0](./layer0-execution-howto.md)

### 2. SS-11 — GenerationParams & MessageConverter
- 🧠 **Explication :** [Architecture & Normalisation Paramètres / Dialectes Wire](./generation-params-converter-explanation.md)
- 📜 **Référence :** [Types GenerationParams, Fonctions de Conversion & ToolIds](./generation-params-converter-reference.md)
- 🛠️ **Guide Pratique :** [Comment Normaliser les Paramètres et Convertir les Messages vers les Dialectes Wire](./generation-params-converter-howto.md)

### 3. SS-12 — Layer 1 SmartLayer & ModelHealthRegistry
- 🧠 **Explication :** [Architecture du Routage Résilient, Disjoncteur 6-Buckets & Escalade](./layer1-smart-layer-explanation.md)
- 📜 **Référence :** [Interfaces SmartLayer, Machine à États & ServiceRegistry](./layer1-smart-layer-reference.md)
- 🛠️ **Guide Pratique :** [Comment Configurer le Routage Intelligent et le Circuit Breaker de Layer 1](./layer1-smart-layer-howto.md)

### 4. SS-13 — Advanced OAuth Adapters (Codex & Antigravity)
- 🧠 **Explication :** [Architecture des Ponts OAuth Développeurs & Impersonation TLS](./oauth-adapters-explanation.md)
- 📜 **Référence :** [Contrats CodexAdapter, AntigravityAdapter & Schéma d'Authentification](./oauth-adapters-reference.md)
- 🛠️ **Guide Pratique :** [Comment Intégrer et Authentifier les Modèles Avancés via Codex et Antigravity](./oauth-adapters-howto.md)

### 5. SS-14 — Multimodal Voice Synthesis & Real-Time Streaming
- 🧠 **Explication :** [Architecture Vocale, Cascade TTS & Streaming Bidirectionnel Live](./multimodal-voice-explanation.md)
- 📜 **Référence :** [Interfaces TTSOptions, Adaptateurs Vocaux & GeminiLiveProvider](./multimodal-voice-reference.md)
- 🛠️ **Guide Pratique :** [Comment Synthétiser des Notes Vocales et Gérer des Sessions Audio en Direct](./multimodal-voice-howto.md)

---

## 🔗 Navigation Inter-Domaines

- **Index Central de la Documentation :** [`../00_index.md`](../00_index.md)
- **Domaine 1 — Cœur d'Orchestration (SS-01 à SS-09) :** [`../core/index.md`](../core/index.md)
- **Domaine 3 — Transports & Passerelles (SS-15 à SS-17) :** [`../transport/index.md`](../transport/index.md)
- **Domaine 4 — Mémoire & Cognition (SS-18 à SS-20) :** [`../memory/index.md`](../memory/index.md)
- **Domaine 5 — Runtime, Sécurité & Contexte (SS-21 à SS-22) :** [`../runtime/index.md`](../runtime/index.md)
- **Domaine 6 — Outils, Dev Tools & Hardening (SS-23 à SS-26) :** [`../plugins/index.md`](../plugins/index.md)
