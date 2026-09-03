# Architecture Générale de HIVE-MIND — Comment les couches s'articulent

## Raisonnement de classification Diátaxis

Le lecteur cherche à **comprendre** l'organisation globale du système avant de plonger dans les détails d'implémentation de chaque module. Il ne s'agit pas d'exécuter une tâche précise ni de consulter une référence d'API. Le type applicable est donc une **Explanation** : elle répond à « comment est structuré ce système et pourquoi cette structure a-t-elle été choisie ? »

---

## Context

HIVE-MIND est un agent autonome multi-canal capable d'exécuter des tâches d'ingénierie complexes (écriture de code, interaction avec des bases de données, navigation web, transcription audio) tout en communiquant avec des utilisateurs sur des réseaux de messagerie variés (WhatsApp via Baileys, Discord, Telegram, CLI/Terminal).

Face à cette diversité de cas d'usage, deux tentations architecturales naïves existent :

1. **Monolithe couplé** : tout est dans un seul fichier ou module, simple à démarrer mais impossible à tester et à faire évoluer.
2. **Micro-services distribués** : chaque fonctionnalité est un service réseau indépendant, puissant mais coûteux en infrastructure et en latence pour un seul processus Node.js.

HIVE-MIND choisit une **architecture en couches avec injection de dépendances** : un processus unique, des modules fortement découplés par des interfaces et un conteneur IoC central.

---

## How it works

L'architecture se décompose en cinq couches à flux unidirectionnel descendant.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TRANSPORT LAYER                              │
│   WhatsApp (Baileys)  ·  Discord  ·  Telegram  ·  CLI (Ink TUI)    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ NormalizedMessage + sourceChannel
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       ORCHESTRATION CORE                            │
│  FairnessQueue (Round-Robin)  ·  BotCore (Boucle ReAct)            │
│  ServiceContainer (IoC)  ·  BlueprintManager  ·  PermissionManager  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Tool calls + LLM requests
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     RUNTIME INFRASTRUCTURE                          │
│  Sentinel VIGIL (évaluation d'actions)  ·  Ralph (anti-paresse)    │
│  FinOps / KKT Throttling  ·  ContextWindowService                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Décisions d'exécution ou de blocage
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         COGNITIVE LAYER                             │
│  Mémoire de Travail (Redis L1)  ·  Mémoire Sémantique (Supabase L2)│
│  LearningEngine (MAPLE)  ·  PTC Sandbox  ·  Browser Agent  ·  Voice│
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Queries DB, APIs externes
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     INFRASTRUCTURE LAYER                            │
│     Supabase (PostgreSQL + pgvector)  ·  Redis (Upstash Cloud)      │
│     AI Providers (Gemini, Groq, Anthropic, OpenRouter...)           │
└─────────────────────────────────────────────────────────────────────┘
```

### Couche 1 — Transport

Chaque transport (WhatsApp/Baileys, Discord, Telegram, CLI Ink) implémente le contrat `TransportInterface` défini dans `src/core/transport/interface.ts`. Ce contrat expose des méthodes uniformes : `onMessage()`, `sendText()`, `sendMedia()`, `sendUniversalResponse()`, etc.

Le `TransportManager` est le chef d'orchestre de cette couche : il enregistre dynamiquement les adaptateurs actifs selon l'environnement, injecte un champ `sourceChannel` dans chaque message entrant, et route les réponses sortantes vers le bon transport.

### Couche 2 — Orchestration Core

Dès qu'un message est normalisé, il entre dans la `FairnessQueue` (`src/core/FairnessQueue.ts`) via un algorithme Round-Robin par `chatId`. L'orchestrateur (`src/core/orchestrator.ts`) dépile les événements (max 3 en parallèle) et les transmet au moteur principal `BotCore` dans `src/core/index.ts`.

Le `ServiceContainer` (`src/core/ServiceContainer.ts`) réalise l'injection de dépendances : chaque service est enregistré une seule fois et résolu à la demande.

### Couche 3 — Runtime Infrastructure

Avant et après chaque action d'outil, le plan de contrôle du runtime intervient :

- **Sentinel VIGIL** filtre et évalue les actions selon le blueprint de l'agent.
- **Ralph** vérifie en fin de boucle que la réponse est complète.
- **KKT FinOps** surveille le budget de jetons et réduit `max_tokens` à l'approche du plafond.

### Couche 4 — Cognitive Layer

C'est ici que réside l'intelligence persistante de l'agent :

- La mémoire de travail (Redis, cache chaud L1) stocke les 15 derniers messages, le scratchpad et la trace des actions récentes.
- La mémoire sémantique (Supabase + pgvector, persistance L2) conserve les souvenirs à long terme, les faits utilisateurs (MAPLE) et les artefacts de l'espace de travail.
- Le `LearningEngine` extrait en arrière-plan des faits structurés sur l'utilisateur.
- Le PTC Sandbox (`src/services/ptc/`) exécute les scripts générés par le LLM dans un bac à sable `node:vm` isolé.

### Couche 5 — Infrastructure Layer

Les clients bas niveau pour Redis Cloud (`redisClient.ts`), Supabase (`supabase.ts`) et les fournisseurs d'IA (`providers/`) constituent la fondation sur laquelle toutes les autres couches s'appuient.

---

## Why it is this way

- **Un seul processus Node.js** : évite la latence réseau inter-services et la complexité opérationnelle d'un déploiement multi-conteneurs sur une machine aux ressources limitées (i5-4300U, 8 Go RAM).
- **Interfaces + IoC** : le `ServiceContainer` découple la construction des services de leur utilisation, ce qui permet de remplacer n'importe quel composant (par exemple, passer de Redis Cloud à un mock en mémoire lors des tests) sans modifier le code appelant.
- **Flux unidirectionnel** : les couches supérieures ne connaissent jamais les détails d'implémentation des couches inférieures. Cela garantit que l'ajout d'un nouveau transport (ex. : SMS) ne nécessite aucune modification dans l'orchestrateur ou les services cognitifs.

---

## Alternatives and tradeoffs

| Approche                             | Forces                                       | Compromis                                                                |
| :----------------------------------- | :------------------------------------------- | :----------------------------------------------------------------------- |
| **Architecture en couches (choisi)** | Découplage net, testabilité, évolutivité     | Courbe d'apprentissage initiale plus élevée                              |
| **Monolithe couplé**                 | Démarrage rapide, pas d'interfaces à définir | Difficulté à tester unitairement, modifications risquées                 |
| **Micro-services**                   | Scalabilité horizontale indépendante         | Latence réseau, infrastructure coûteuse, synchronisation d'état complexe |
| **Event-Driven Architecture (Bus)**  | Découplage temporel extrême                  | Difficile à tracer et déboguer causalement                               |

L'architecture en couches représente un équilibre entre la simplicité opérationnelle (un seul processus) et la rigueur structurelle (interfaces, IoC, flux unidirectionnel).

---

## Further reading

- [02 — Orchestrateur Central & Boucle ReAct](./02_orchestrateur_react.md)
- [03 — Couche Transport & Smart Router](./03_transport_smart_router.md)
- [04 — Sécurité, PTC & Supervision Runtime](./04_securite_runtime.md)
- [05 — Mémoire Cognitive & Bases de Données](./05_memoire_cognitive.md)
- [06 — TUI & Système de Plugins](./06_tui_plugins.md)
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — Contrats d'interface et layout du code
