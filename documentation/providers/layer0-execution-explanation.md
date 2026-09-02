# Layer 0 ExecutionLayer & ModelRegistry — Architecture & Principes de Fonctionnement

Le sous-système **SS-10 (Layer 0 ExecutionLayer & ModelRegistry)** constitue le moteur physique d'exécution réseau et de registre de métadonnées de bas niveau pour toutes les requêtes LLM de HIVE-MIND, fonctionnant de manière purement déterministe, sans état et sous contrôle strict de délais d'abandon.

## 1. Contexte & Problématique d'Ingénierie

Dans une architecture d'agent autonome multi-canal manipulant des dizaines de modèles de langage hétérogènes (OpenAI, Anthropic, Gemini, Cohere, Groq, DeepSeek, etc.), plusieurs écueils majeurs menacent la stabilité du système :
- **Prolifération des SDKs propriétaires** : Importer les SDKs officiels de chaque fournisseur alourdit inutilement le graphe de dépendances de Node.js, introduit des conflits de versions et dissimule la tuyauterie réseau (gestion des sockets, pools HTTP, gestion des flux).
- **Fragilité du parsing d'erreurs par regex** : Analyser les corps de messages d'erreur textuels pour deviner si une requête a échoué par dépassement de quota (429) ou erreur interne (500) est sujet aux dérives constantes des messages des fournisseurs.
- **Fuites de ressources sur les flux SSE (Server-Sent Events)** : En mode streaming, un arrêt non géré d'une connexion montante ou un timeout mal intercepté peut laisser des sockets orphelines et bloquer la boucle d'événements.
- **Couplage indésirable entre logique de repli et transport** : Si le moteur d'exécution réseau tente lui-même de décider quel modèle alternatif appeler en cas d'erreur, le système perd sa modularité et devient impossible à tester unitairement de manière déterministe.

SS-10 résout ces problèmes en instaurant une couche physique **strictement stateless** ($C_e = 0$ vers la logique métier) qui prend en charge la sérialisation HTTP, la signature d'en-têtes, la gestion unifiée des signaux `AbortSignal`, la consommation des flux SSE et la classification typée des erreurs HTTP.

## 2. Modèle Mental & Architecture Conceptuelle

Layer 0 fonctionne comme une passerelle d'exécution universelle point-à-point :

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Consommateur (Layer 1)                           │
│           (Émet une ExecutionRequest avec un modelId et des options)         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ModelRegistry (models_config.json)                    │
│   - Résout modelId -> (Provider, ProtocolFamily, HeaderFamily, Capabilities)│
│   - Validation statique des schémas & détection des collisions d'ID         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ExecutionLayer (Stateless)                         │
│                                                                             │
│  1. Résolution de clé (resolveApiKey)                                       │
│  2. Construction Contexte Protocolaire (ProtocolContext)                    │
│  3. Forger URL & Corps JSON (ProtocolFamily.buildUrl, buildBody)            │
│  4. Forger En-têtes HTTP (HeaderFamily.buildHeaders + extras)               │
│  5. Armer Contrôleur d'Annulation (setupAbortController: signal + timeout)  │
│  6. Appel Réseau fetch() [POST]                                             │
│                                                                             │
│         ┌────────────────────────────┴───────────────────────────┐          │
│         │ Mode Synchrone (execute)     Mode Streaming (executeStream)│       │
│         ▼                            ▼                           │          │
│   Lecture JSON                    Décodeur SSE (readSseStream)   │          │
│   protocol.parseResponse()        parseStreamSseLine -> Chunks   │          │
└─────────┬────────────────────────────┬───────────────────────────┴──────────┘
          │                            │
          ▼                            ▼
  [AdapterChatResult]          AsyncIterable<StreamChunk>
          │                            │
          └───────────┬────────────────┘
                      │ (En cas d'échec HTTP >= 400 ou réseau)
                      ▼
        ┌───────────────────────────┐
        │       classifyError       │
        │  Traduction déterministe  │
        │    vers Layer0Error       │
        └───────────────────────────┘
```

### Décomposition des Flux d'Information

1. **Résolution des Métadonnées** : `ModelRegistry.getModelConfig(modelId)` extrait la configuration déclarative (ex. `protocol_family: 'openai-compatible'`, `header_family: 'standard-bearer'`).
2. **Construction de la Requête** :
   - `ProtocolFamily` forge l'URL exacte (`buildUrl`) et la structure du corps JSON (`buildBody`).
   - `HeaderFamily` génère les en-têtes d'authentification (`Bearer <token>`, `x-api-key`, `Authorization: Token ...`).
   - `setupAbortController` combine le signal d'annulation externe éventuel avec la minuterie de garde (par défaut 60 000 ms).
3. **Pipeline de Réponse** :
   - **Synchrone** : Désérialisation du JSON et conversion en `AdapterChatResult` conforme au contrat HIVE-MIND.
   - **Streaming** : Lecture incrémentale du flux `ReadableStream<Uint8Array>`, découpage des lignes `data: {...}` et émission de `StreamChunk` (`content`, `thought`, `toolCalls`, `done`).
4. **Classification Déterministe d'Erreurs** :
   Si le code de statut est $\ge 400$ ou si une interruption intervient, `classifyError` transforme la réponse brute en exception typée (`InvalidRequestError`, `AuthError`, `RateLimitError`, `ServerError`, `NetworkError`, `ContentFilterError`).

## 3. Choix de Conception & Raisons d'Ingénierie

- **Stateless Absolu & Découplage de Transport** : `ExecutionLayer` ne stocke aucun état en mémoire. Deux requêtes successives avec les mêmes paramètres sont strictement indépendantes. Cela permet d'exécuter des tests unitaires rapides et reproductibles en mockant uniquement `fetch`.
- **Fusion AbortController à Double Source** : La fonction `setupAbortController` synchronise l'annulation déclenchée par l'utilisateur (ex. message d'arrêt dans le chat WhatsApp) et le timeout réseau. Le minuteur est systématiquement nettoyé dans un bloc `finally` pour prévenir toute fuite mémoire dans le runtime Node.js.
- **Fail-Closed sur l'Authentification** : Si aucune clé API n'est disponible pour un fournisseur, `resolveApiKey` lève immédiatement une `AuthError` (401) sans émettre de requête fantôme sur le réseau.
- **Classification d'Erreur sans Regex** : Les erreurs HTTP sont mappées directement depuis le code de statut (`status`), l'en-tête standard `Retry-After` et les codes d'erreur structurés retournés par les APIs (`error.code`, `error.type`), éliminant la fragilité des correspondances textuelles.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **SDKs Officiels par Fournisseur** (`@openai/sdk`, `@anthropic-ai/sdk`, etc.) | Méthodes typées fournies par les éditeurs. | Poids excessif des dépendances, disparité des interfaces, gestion opaque des signaux d'annulation et impossibilité de normaliser les erreurs de manière uniforme. |
| **Parsing d'Erreurs par Expressions Régulières** | Facile à mettre en place sur des logs textuels. | Très fragile : les éditeurs modifient régulièrement le libellé de leurs messages d'erreur sans préavis, causant des erreurs de classification. |
| **Boucle de Repli Intégrée dans Layer 0** | Réduit le nombre de couches logicielles. | Viole le principe de responsabilité unique (SRP) : Layer 0 doit être un exécuteur passif, laissant la politique de décision et d'escalade à Layer 1. |
| **Client HTTP Axios / Got** | Fonctionnalités riches prêtes à l'emploi (interceptors). | Dépendances externes lourdes. `fetch` natif Node.js $\ge 22$ offre des performances supérieures avec zéro surcoût de bundle. |

## 5. Frontières Architecturales & Invariants

### Ce qui est DANS le périmètre de Layer 0 :
- Chargement et indexation de `models_config.json` via `ModelRegistry`.
- Sérialisation et validation des requêtes HTTP/SSE via `fetch`.
- Signature des en-têtes d'authentification via `HeaderFamily`.
- Parsing universel des flux SSE via `readSseStream`.
- Typage strict et classification des erreurs dans la hiérarchie `Layer0Error`.

### Ce qui est EXCLU de Layer 0 (délégué aux autres couches) :
- La décision de basculer vers un modèle de repli en cas d'erreur (déléguée à Layer 1 — SS-12).
- Le circuit breaker et le suivi de santé des fournisseurs (délégués à `ModelHealthRegistry` — SS-12).
- La normalisation dialectale fine des messages et des tool calls (déléguée à `GenerationParams` & `messageConverter` — SS-11).
- La persistance des tokens OAuth et le rafraîchissement d'accès (délégués aux adaptateurs dédiés — SS-13).

## 6. Liens & Navigation

- **Référence Technique :** [`layer0-execution-reference.md`](./layer0-execution-reference.md)
- **Guide Pratique d'Intégration :** [`layer0-execution-howto.md`](./layer0-execution-howto.md)
- **Index du Domaine Fournisseurs :** [`index.md`](./index.md)
