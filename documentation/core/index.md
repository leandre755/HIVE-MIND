# Domaine 1 : Noyau d'Orchestration & Coordination (`core/`)

Le domaine **Core** rassemble les neuf sous-systèmes fondamentaux (de **SS-01** à **SS-09**) constituant le moteur d'exécution, d'ordonnancement, de sécurité et d'orchestration agentique de HIVE-MIND.

---

## 🧭 Cartographie des Sous-Systèmes Core (SS-01 à SS-09)

| Sous-Système | Responsabilité Principale | Fichiers Sources Majeurs |
| :--- | :--- | :--- |
| **SS-01 : ServiceContainer** | Conteneur IoC, cycle de vie Lazy/Singleton, résolution des dépendances circulaires. | `src/core/ServiceContainer.ts`, `src/core/container.ts` |
| **SS-02 : FairnessQueue** | Ordonnanceur équitable multi-tenants (Round-Robin) avec voie prioritaire VIP FastLane. | `src/core/FairnessQueue.ts`, `src/core/orchestrator.ts` |
| **SS-03 : SwarmDispatcher** | Régulateur de concurrence par verrous de conversation (JID) et limitation adaptative CPU/RAM. | `src/core/concurrency/SwarmDispatcher.ts` |
| **SS-04 : AgentBlueprint** | Schémas Zod, validation de profils d'agents et registre RAM pour sous-agents éphémères. | `src/core/blueprint/AgentBlueprint.ts`, `src/config/blueprints/` |
| **SS-05 : EventBus** | Bus d'événements Pub/Sub asynchrone typé à 23 événements du cycle de vie (`BotEvents`). | `src/core/events.ts` |
| **SS-06 : ExplicitPlanner** | Moteur de planification hiérarchique en DAG, interpolation de variables et replanning. | `src/services/agentic/Planner.ts` |
| **SS-07 : SubAgentEngine** | Délégation en essaim (*Swarm*), forking de contexte et boucles ReAct isolées. | `src/services/agentic/SubAgentEngine.ts`, `SpawnSubAgentTool.ts` |
| **SS-08 : PTC Engine & WakeSystem** | Machine virtuelle JavaScript sandboxée (`node:vm`), économie FinOps de jetons et réveil asynchrone. | `src/services/ptc/` |
| **SS-09 : PermissionManager** | Sanctuarisation double disque (`Sandbox1/`, `storage_hm/`) et approbation HITL à 3 voies. | `src/core/security/PermissionManager.ts` |

---

## 📚 Documentation Modulaire par Sous-Système (Triplets Diátaxis)

### 1. SS-01 — ServiceContainer
- 🧠 **Explication :** [Architecture & Principes du Conteneur IoC](./service-container-explanation.md)
- 📜 **Référence :** [Interfaces, Classes & Registre ServiceRegistry](./service-container-reference.md)
- 🛠️ **Guide Pratique :** [Comment Enregistrer et Résoudre un Nouveau Service](./service-container-howto.md)

### 2. SS-02 — FairnessQueue
- 🧠 **Explication :** [Architecture & Équité Multi-Tenants Round-Robin](./fairness-queue-explanation.md)
- 📜 **Référence :** [Interfaces, Algorithmes & Méthodes de File](./fairness-queue-reference.md)
- 🛠️ **Guide Pratique :** [Comment Ordonnancer Équitablement des Messages Multi-Canaux](./fairness-queue-howto.md)

### 3. SS-03 — SwarmDispatcher
- 🧠 **Explication :** [Architecture, Mutex par JID & Régulation de Charge](./swarm-dispatcher-explanation.md)
- 📜 **Référence :** [Signatures, Métriques & Plafonds Matériels](./swarm-dispatcher-reference.md)
- 🛠️ **Guide Pratique :** [Comment Réguler la Concurrence et Sérialiser les Messages](./swarm-dispatcher-howto.md)

### 4. SS-04 — AgentBlueprint
- 🧠 **Explication :** [Architecture, Schémas Zod & Registre Éphémère](./agent-blueprint-explanation.md)
- 📜 **Référence :** [Schéma AgenticFormatSchema & API BlueprintManager](./agent-blueprint-reference.md)
- 🛠️ **Guide Pratique :** [Comment Créer et Enregistrer un Profil d'Agent](./agent-blueprint-howto.md)

### 5. SS-05 — EventBus (BotEvents)
- 🧠 **Explication :** [Architecture & Découplage Pub/Sub Réactif](./event-bus-explanation.md)
- 📜 **Référence :** [Dictionnaire BotEvents & Signatures EventBus](./event-bus-reference.md)
- 🛠️ **Guide Pratique :** [Comment Écouter et Émettre des Événements](./event-bus-howto.md)

### 6. SS-06 — ExplicitPlanner
- 🧠 **Explication :** [Architecture, Graphes DAG & Replanification Dynamique](./explicit-planner-explanation.md)
- 📜 **Référence :** [Structures PlanStep, Plan & API ExplicitPlanner](./explicit-planner-reference.md)
- 🛠️ **Guide Pratique :** [Comment Planifier et Exécuter une Tâche Complexe](./explicit-planner-howto.md)

### 7. SS-07 — SubAgentEngine
- 🧠 **Explication :** [Architecture, Délégation Swarm & Cloisonnement ReAct](./sub-agent-engine-explanation.md)
- 📜 **Référence :** [Contrats SubAgentConfig, Résultats & Outil Système](./sub-agent-engine-reference.md)
- 🛠️ **Guide Pratique :** [Comment Instancier et Déléguer une Sous-Tâche](./sub-agent-engine-howto.md)

### 8. SS-08 — PTC Engine & HiveWakeSystem
- 🧠 **Explication :** [Architecture Sandbox VM, FinOps & Réveil Asynchrone](./ptc-engine-explanation.md)
- 📜 **Référence :** [Types PTCExecutionResult, Helpers Défensifs & API](./ptc-engine-reference.md)
- 🛠️ **Guide Pratique :** [Comment Exécuter des Outils en Mode Programmatique](./ptc-engine-howto.md)

### 9. SS-09 — PermissionManager
- 🧠 **Explication :** [Architecture Double Disque, Sécurité & Approbation HITL](./permission-manager-explanation.md)
- 📜 **Référence :** [Listes de Sécurité, Commandes & API PermissionManager](./permission-manager-reference.md)
- 🛠️ **Guide Pratique :** [Comment Valider des Actions Sensibles et Gérer l'Approbation HITL](./permission-manager-howto.md)

---

## 🔗 Navigation Inter-Domaines

- **Index Central de la Documentation :** [`../00_index.md`](../00_index.md)
- **Domaine 2 — Fournisseurs d'IA & Routage (SS-10 à SS-14) :** [`../providers/index.md`](../providers/index.md)
- **Domaine 3 — Transports & Passerelles (SS-15 à SS-17) :** [`../transport/index.md`](../transport/index.md)
- **Domaine 4 — Mémoire & Cognition (SS-18 à SS-20) :** [`../memory/index.md`](../memory/index.md)
- **Domaine 5 — Runtime, Sécurité & Contexte (SS-21 à SS-22) :** [`../runtime/index.md`](../runtime/index.md)
- **Domaine 6 — Outils, Dev Tools & Hardening (SS-23 à SS-26) :** [`../plugins/index.md`](../plugins/index.md)
