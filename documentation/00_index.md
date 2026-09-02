# Hub Central de la Documentation Technique — HIVE-MIND

Bienvenue dans le centre de documentation officiel de **HIVE-MIND**, un harnais agentique omni-source haute performance, modulaire et résilient pour modèles de fondation (*Foundation Models*).

L'ensemble de ce corpus documentaire est structuré selon la méthodologie **Diátaxis** et couvre de manière exhaustive les **26 sous-systèmes autonomes (SS-01 à SS-26)** répartis à travers **6 domaines d'ingénierie majeurs**.

---

## 🧭 Le Cadre Méthodologique Diátaxis

Le corpus documentaire HIVE-MIND adopte rigoureusement le standard **Diátaxis**, séparant la documentation technique en quatre quadrants distincts selon les besoins de l'ingénieur :

```
                        THÉORIE / CONNAISSANCE
                                  │
         🧠 EXPLICATIONS          │          📜 RÉFÉRENCES
    (Compréhension & Architecture) │      (Contrats d'API & Spécifications)
    • Modèles conceptuels          │      • Interfaces TypeScript réelles
    • Décisions d'ingénierie       │      • Signatures, types et schémas Zod
    • Invariants et compromis      │      • Codes d'erreur et constantes
──────────────────────────────────┼──────────────────────────────────
         🎓 TUTORIELS             │         🛠️ GUIDES PRATIQUES
     (Apprentissage & Découverte)  │        (Tâches & Recettes Métier)
    • Parcours pas-à-pas guidé     │      • Résolution de problèmes réels
    • Prise en main initiale       │      • Procédures d'extension / ajout
    • Scénarios de découverte      │      • Scripts et commandes de tests
                                  │
                          PRATIQUE / ACTION
```

### 1. 🧠 Explications (*Explanations* — `*-explanation.md`)
Orientées vers la **compréhension globale et l'architecture**. Elles explicitent le « *pourquoi* » : motivations de conception, compromis algorithmiques, flux de données synoptiques et interactions inter-domaines.

### 2. 📜 Références (*References* — `*-reference.md`)
Orientées vers l'**exactitude technique et l'information pure**. Elles explicitent le « *quoi* » : interfaces TypeScript exhaustives, signatures de classes, contrats d'entrée/sortie, options de configuration et taxonomies d'erreurs.

### 3. 🛠️ Guides Pratiques (*How-To Guides* — `*-howto.md`)
Orientés vers la **résolution de tâches concrètes et l'action**. Ils explicitent le « *comment faire* » : guides d'intégration étape par étape, adjonction de nouveaux modules, exécution des suites de validation Jest et dépannage opérationnel.

### 4. 🎓 Tutoriels (*Tutorials*)
Orientés vers l'**apprentissage guidé et l'onboarding**. Ils accompagnent le développeur pas-à-pas depuis le premier démarrage jusqu'à l'exécution d'un essaim d'agents autonomes.

---

## 🏛️ Cartographie des 6 Domaines Architecturaux

HIVE-MIND est décomposé en 6 domaines hautement cohésifs et faiblement couplés :

| Domaine | Répertoire | Sous-Systèmes | Périmètre & Responsabilité Technique | Index de Domaine |
| :--- | :--- | :--- | :--- | :--- |
| **Domaine 1 : Orchestration Core** | [`core/`](./core/index.md) | **SS-01 à SS-09** | Conteneur IoC, ordonnancement équitable multi-tenants, concurrence adaptative, blueprints, bus d'événements typé, planificateur DAG, délégation d'essaim, machine virtuelle PTC et sécurité HITL double disque. | [Consulter l'Index Core](./core/index.md) |
| **Domaine 2 : Fournisseurs d'IA & Routage** | [`providers/`](./providers/index.md) | **SS-10 à SS-14** | Moteur réseau stateless Layer 0, normalisation universelle des paramètres, disjoncteur résilient 6 compartiments Layer 1, ponts OAuth avancés (Codex / Antigravity) et synthèse vocale multimodale en streaming. | [Consulter l'Index Providers](./providers/index.md) |
| **Domaine 3 : Transports & Passerelles** | [`transport/`](./transport/index.md) | **SS-15 à SS-17** | Abstraction universelle de transport (WhatsApp, Discord, Telegram), serveur WebSocket local pour le terminal autonome (`HIVE-MIND-TUI`) et assistant d'authentification CLI interactif. | [Consulter l'Index Transport](./transport/index.md) |
| **Domaine 4 : Mémoire & Cognition** | [`memory/`](./memory/index.md) | **SS-18 à SS-20** | Cache chaud L1 (Redis/RAM), mémoire d'actions suspendues, mémoire sémantique L2 (Supabase pgvector), moteur d'apprentissage MAPLE, auto-réflexion nocturne et base vectorielle locale in-process HNSW (3072d). | [Consulter l'Index Memory](./memory/index.md) |
| **Domaine 5 : Runtime & Plan de Contrôle** | [`runtime/`](./runtime/index.md) | **SS-21 à SS-22** | Plan de contrôle sécuritaire Sentinel (VIGIL), audit anti-dérive cognitive Ralph, régulateur de coûts FinOps par multiplicateur de Lagrange et chargeur de contexte stratifié en 5 strates (<50ms). | [Consulter l'Index Runtime](./runtime/index.md) |
| **Domaine 6 : Outils, Dev Tools & Hardening** | [`plugins/`](./plugins/index.md) | **SS-23 à SS-26** | Éditeur par ancres de hachage FNV-1a Uint32, analyse syntaxique WebTreeSitter WASM & LSP embarqué, pipeline dynamique de plugins validés Ajv/Zod et fondations de durcissement système (SafeFs, Redlock, TLS JA3). | [Consulter l'Index Plugins](./plugins/index.md) |

---

## 📊 Matrice Maîtresse des 26 Sous-Systèmes (SS-01 à SS-26)

Le tableau ci-dessous référence l'ensemble exhaustif des 26 sous-systèmes de HIVE-MIND avec leurs liens directs vers leurs triplets documentaires Diátaxis :

| ID | Sous-Système | Domaine | Responsabilité Clé | 🧠 Explication | 📜 Référence | 🛠️ Guide Pratique |
| :---: | :--- | :--- | :--- | :---: | :---: | :---: |
| **SS-01** | **ServiceContainer** | [Core](./core/index.md) | Conteneur IoC, cycle de vie Lazy/Singleton, résolution des dépendances circulaires | [Explanation](./core/service-container-explanation.md) | [Reference](./core/service-container-reference.md) | [How-To](./core/service-container-howto.md) |
| **SS-02** | **FairnessQueue** | [Core](./core/index.md) | Ordonnanceur équitable multi-tenants (Round-Robin), voie prioritaire FastLane | [Explanation](./core/fairness-queue-explanation.md) | [Reference](./core/fairness-queue-reference.md) | [How-To](./core/fairness-queue-howto.md) |
| **SS-03** | **SwarmDispatcher** | [Core](./core/index.md) | Mutex par identifiant de session (JID), régulation dynamique de concurrence CPU/RAM | [Explanation](./core/swarm-dispatcher-explanation.md) | [Reference](./core/swarm-dispatcher-reference.md) | [How-To](./core/swarm-dispatcher-howto.md) |
| **SS-04** | **AgentBlueprint** | [Core](./core/index.md) | Schémas Zod déclaratifs, topologies d'agents, registre mémoire pour sous-agents | [Explanation](./core/agent-blueprint-explanation.md) | [Reference](./core/agent-blueprint-reference.md) | [How-To](./core/agent-blueprint-howto.md) |
| **SS-05** | **EventBus** | [Core](./core/index.md) | Bus Pub/Sub asynchrone découplé, 23 événements typés du cycle de vie (`BotEvents`) | [Explanation](./core/event-bus-explanation.md) | [Reference](./core/event-bus-reference.md) | [How-To](./core/event-bus-howto.md) |
| **SS-06** | **ExplicitPlanner** | [Core](./core/index.md) | Planification hiérarchique en DAG, interpolation de variables, replanning dynamique | [Explanation](./core/explicit-planner-explanation.md) | [Reference](./core/explicit-planner-reference.md) | [How-To](./core/explicit-planner-howto.md) |
| **SS-07** | **SubAgentEngine** | [Core](./core/index.md) | Délégation en essaim (*Swarm*), forking de contexte isolé, boucles ReAct bornées | [Explanation](./core/sub-agent-engine-explanation.md) | [Reference](./core/sub-agent-engine-reference.md) | [How-To](./core/sub-agent-engine-howto.md) |
| **SS-08** | **PTC Engine & Wake** | [Core](./core/index.md) | Machine virtuelle VM sandboxée, compression FinOps d'appels et réveil asynchrone | [Explanation](./core/ptc-engine-explanation.md) | [Reference](./core/ptc-engine-reference.md) | [How-To](./core/ptc-engine-howto.md) |
| **SS-09** | **PermissionManager** | [Core](./core/index.md) | Sanctuarisation double disque (`Sandbox1/` vs `storage_hm/`), validation 3-tier HITL | [Explanation](./core/permission-manager-explanation.md) | [Reference](./core/permission-manager-reference.md) | [How-To](./core/permission-manager-howto.md) |
| **SS-10** | **Layer 0 Execution** | [Providers](./providers/index.md) | Moteur d'exécution HTTP/SSE stateless, catalogue de modèles, classification d'erreurs | [Explanation](./providers/layer0-execution-explanation.md) | [Reference](./providers/layer0-execution-reference.md) | [How-To](./providers/layer0-execution-howto.md) |
| **SS-11** | **GenerationParams** | [Providers](./providers/index.md) | Normalisation universelle des paramètres, Prompt Caching, conversion multi-dialectes | [Explanation](./providers/generation-params-converter-explanation.md) | [Reference](./providers/generation-params-converter-reference.md) | [How-To](./providers/generation-params-converter-howto.md) |
| **SS-12** | **Layer 1 SmartLayer** | [Providers](./providers/index.md) | Routage résilient, cascade séquentielle plate, disjoncteur 3-états à 6 compartiments | [Explanation](./providers/layer1-smart-layer-explanation.md) | [Reference](./providers/layer1-smart-layer-reference.md) | [How-To](./providers/layer1-smart-layer-howto.md) |
| **SS-13** | **OAuth Adapters** | [Providers](./providers/index.md) | Ponts OAuth 2.0 (OpenAI Codex / Google Antigravity), rafraîchissement, TLS JA3 | [Explanation](./providers/oauth-adapters-explanation.md) | [Reference](./providers/oauth-adapters-reference.md) | [How-To](./providers/oauth-adapters-howto.md) |
| **SS-14** | **Multimodal Voice** | [Providers](./providers/index.md) | Cascade TTS (Minimax, Gemini, GTTS), transcodage WhatsApp OGG Opus, Gemini Live | [Explanation](./providers/multimodal-voice-explanation.md) | [Reference](./providers/multimodal-voice-reference.md) | [How-To](./providers/multimodal-voice-howto.md) |
| **SS-15** | **Universal Transport** | [Transport](./transport/index.md) | Contrat `ITransport`, routeur `TransportManager`, connecteurs WhatsApp, Discord, Telegram | [Explanation](./transport/universal-transport-explanation.md) | [Reference](./transport/universal-transport-reference.md) | [How-To](./transport/universal-transport-howto.md) |
| **SS-16** | **TuiServerTransport** | [Transport](./transport/index.md) | Serveur WebSocket local `127.0.0.1`, pont IPC avec `HIVE-MIND-TUI`, proxy RPC HITL | [Explanation](./transport/tui-server-transport-explanation.md) | [Reference](./transport/tui-server-transport-reference.md) | [How-To](./transport/tui-server-transport-howto.md) |
| **SS-17** | **CLI Auth Wizard** | [Transport](./transport/index.md) | Assistant interactif TTY, validation réseau des jetons, appairage WhatsApp Noise | [Explanation](./transport/cli-auth-wizard-explanation.md) | [Reference](./transport/cli-auth-wizard-reference.md) | [How-To](./transport/cli-auth-wizard-howto.md) |
| **SS-18** | **Hybrid Memory** | [Memory](./memory/index.md) | Cache chaud L1 Redis/RAM, `ActionMemory`, mémoire L2 Supabase pgvector, Gists | [Explanation](./memory/hybrid-memory-explanation.md) | [Reference](./memory/hybrid-memory-reference.md) | [How-To](./memory/hybrid-memory-howto.md) |
| **SS-19** | **MAPLE & Dream** | [Memory](./memory/index.md) | Extraction non-supervisée MAPLE, réflexion nocturne (`DreamService`), graphe de savoir | [Explanation](./memory/maple-dream-reflection-explanation.md) | [Reference](./memory/maple-dream-reflection-reference.md) | [How-To](./memory/maple-dream-reflection-howto.md) |
| **SS-20** | **Local VectorDB** | [Memory](./memory/index.md) | Index HNSW in-process (3072d, `gemini-embedding-2`), persistance duale `mediaDB/` | [Explanation](./memory/local-vectordb-explanation.md) | [Reference](./memory/local-vectordb-reference.md) | [How-To](./memory/local-vectordb-howto.md) |
| **SS-21** | **Runtime Control Plane** | [Runtime](./runtime/index.md) | Invariants Sentinel (VIGIL), audit anti-dérive Ralph, gouvernance FinOps ($\lambda$) | [Explanation](./runtime/runtime-control-plane-explanation.md) | [Reference](./runtime/runtime-control-plane-reference.md) | [How-To](./runtime/runtime-control-plane-howto.md) |
| **SS-22** | **TieredContextLoader** | [Runtime](./runtime/index.md) | Assemblage du Workspace Prompt V3 en 5 strates thermiques (<50ms), GC à 80% | [Explanation](./runtime/tiered-context-loader-explanation.md) | [Reference](./runtime/tiered-context-loader-reference.md) | [How-To](./runtime/tiered-context-loader-howto.md) |
| **SS-23** | **Hash-Line Editor** | [Plugins](./plugins/index.md) | Édition de fichiers robuste via empreintes FNV-1a Uint32, Myers diff, écritures atomiques | [Explanation](./plugins/hash-line-editor-explanation.md) | [Reference](./plugins/hash-line-editor-reference.md) | [How-To](./plugins/hash-line-editor-howto.md) |
| **SS-24** | **AST Code Intel & LSP** | [Plugins](./plugins/index.md) | WebTreeSitter WASM, génération de squelettes (-90% tokens), serveur LSP embarqué | [Explanation](./plugins/ast-code-intel-explanation.md) | [Reference](./plugins/ast-code-intel-reference.md) | [How-To](./plugins/ast-code-intel-howto.md) |
| **SS-25** | **Plugin Pipeline** | [Plugins](./plugins/index.md) | Découverte dynamique, validation stricte Ajv/Zod avec auto-correction, pont client MCP | [Explanation](./plugins/plugin-pipeline-explanation.md) | [Reference](./plugins/plugin-pipeline-reference.md) | [How-To](./plugins/plugin-pipeline-howto.md) |
| **SS-26** | **System Hardening** | [Plugins](./plugins/index.md) | Wrappers `safeFs.ts`, verrous Redlock Lua atomiques, TLS JA3, shell persistant | [Explanation](./plugins/system-hardening-explanation.md) | [Reference](./plugins/system-hardening-reference.md) | [How-To](./plugins/system-hardening-howto.md) |

---

## 📚 Guides Transverses & Architecture Globale

En complément des 26 sous-systèmes, HIVE-MIND dispose d'un corpus de guides généraux organisés par quadrants Diátaxis :

### 🧠 1. Explications Globales & Synthèses d'Architecture
- **Architecture Globale du Système :** [`explanations/01_architecture_generale.md`](./explanations/01_architecture_generale.md)
- **Orchestrateur Central & Boucle ReAct :** [`explanations/02_orchestrateur_react.md`](./explanations/02_orchestrateur_react.md)
- **Transports & Routage Intelligent :** [`explanations/03_transport_smart_router.md`](./explanations/03_transport_smart_router.md)
- **Sécurité, PTC & Supervision Runtime :** [`explanations/04_securite_runtime.md`](./explanations/04_securite_runtime.md)
- **Mémoire Cognitive & Indexation Vectorielle :** [`explanations/05_memoire_cognitive.md`](./explanations/05_memoire_cognitive.md)
- **Interface Terminale & Écosystème Plugins :** [`explanations/06_tui_plugins.md`](./explanations/06_tui_plugins.md)
- **Distribution & Déploiement :** [`explanations/distribution_hive_mind.md`](./explanations/distribution_hive_mind.md)

### 🛠️ 2. Guides Pratiques & Recettes d'Intégration
- **Ajouter et Configurer un Modèle IA :** [`how-to/ajouter_modele_ia.md`](./how-to/ajouter_modele_ia.md)
- **Personnaliser la Persona & le Comportement de l'Agent :** [`how-to/personnaliser_persona.md`](./how-to/personnaliser_persona.md)
- **Guide Stratégique du Choix des LLM :** [`how-to/guide-choisir-llm-harnais-agentique.docx`](./how-to/guide-choisir-llm-harnais-agentique.docx)

### 📜 3. Références Techniques Globales
- **Inventaire des Commandes & Capacités :** [`reference/commandes_capacites.md`](./reference/commandes_capacites.md)
- **Guide de la CLI d'Administration :** [`reference/admin_cli.md`](./reference/admin_cli.md)
- **Gestion des Mises à Jour & Plugins :** [`reference/mises_a_jour_plugins.md`](./reference/mises_a_jour_plugins.md)
- **Rapport des Spécifications & Besoins :** [`reference/rapport-besoins-hive-mind.docx`](./reference/rapport-besoins-hive-mind.docx)

### 🎓 4. Tutoriels & Prise en Main
Pour démarrer avec HIVE-MIND :
1. **Initialisation des Identifiants :** Suivre le guide de l'Assistant CLI ([`transport/cli-auth-wizard-howto.md`](./transport/cli-auth-wizard-howto.md)).
2. **Démarrage du Démon Headless :** Lancer `npm run dev` pour instancier le `ServiceContainer` ([`core/service-container-howto.md`](./core/service-container-howto.md)).
3. **Connexion de l'Interface TUI :** Lancer le client TUI standalone via le pont IPC WebSocket ([`transport/tui-server-transport-howto.md`](./transport/tui-server-transport-howto.md)).
4. **Création d'un Premier Sous-Agent :** Déclarer un blueprint personnalisé ([`core/agent-blueprint-howto.md`](./core/agent-blueprint-howto.md)) et déléguer une tâche via `SubAgentEngine` ([`core/sub-agent-engine-howto.md`](./core/sub-agent-engine-howto.md)).

---

## 🗂️ Correspondance Code Source $\longleftrightarrow$ Sous-Systèmes

```
src/
├── core/
│   ├── ServiceContainer.ts           ──> SS-01 : ServiceContainer
│   ├── FairnessQueue.ts              ──> SS-02 : FairnessQueue
│   ├── concurrency/SwarmDispatcher.ts──> SS-03 : SwarmDispatcher
│   ├── blueprint/AgentBlueprint.ts   ──> SS-04 : AgentBlueprint
│   ├── events.ts                     ──> SS-05 : EventBus
│   ├── security/PermissionManager.ts ──> SS-09 : PermissionManager
│   ├── transport/
│   │   ├── TransportManager.ts       ──> SS-15 : Universal Transport
│   │   └── TuiServerTransport.ts     ──> SS-16 : TuiServerTransport
│   └── context/TieredContextLoader.ts──> SS-22 : TieredContextLoader
│
├── providers/
│   ├── layer0/ExecutionLayer.ts      ──> SS-10 : Layer 0 ExecutionLayer
│   ├── GenerationParams.ts           ──> SS-11 : GenerationParams & Converter
│   ├── layer1/SmartLayer.ts          ──> SS-12 : Layer 1 SmartLayer
│   ├── adapters/                     ──> SS-13 : Advanced OAuth Adapters
│   └── geminiLive.ts, ttsTypes.ts    ──> SS-14 : Multimodal Voice
│
├── services/
│   ├── agentic/Planner.ts            ──> SS-06 : ExplicitPlanner
│   ├── agentic/SubAgentEngine.ts     ──> SS-07 : SubAgentEngine
│   ├── ptc/                          ──> SS-08 : PTC Engine & WakeSystem
│   ├── memory/ (Redis, Supabase)     ──> SS-18 : Multi-Tier Hybrid Memory
│   ├── learning/ (MAPLE, Dream)      ──> SS-19 : Cognitive Learning Engine
│   ├── ai/MultimodalEmbeddingService ──> SS-20 : Local Multimodal VectorDB
│   ├── runtime/ (Sentinel, Ralph)    ──> SS-21 : AI Runtime Control Plane
│   ├── anchor/ (AnchorStateManager)  ──> SS-23 : Hash-Anchored Line Editor
│   └── ast/ (TreeSitter, LSP)        ──> SS-24 : AST Code Intelligence
│
├── plugins/
│   └── loader.ts, MCPClient.ts       ──> SS-25 : Dynamic Plugin Pipeline
│
├── utils/
│   └── safeFs.ts, lockManager.ts     ──> SS-26 : Hardening Foundations
│
└── cli/
    └── index.ts, authSession.ts      ──> SS-17 : CLI Auth Wizard
```
