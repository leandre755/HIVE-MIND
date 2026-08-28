# Implementation Plan: Extraction & Découplage de la TUI dans un Dépôt Autonome

## Overview
Ce plan détaille l'extraction complète de l'interface terminal interactive (`src/tui/`, 136 fichiers, application React / Ink) hors du dépôt monolithique HIVE-MIND vers un nouveau dépôt dédié (`/home/omni/Code/HIVE-MIND-TUI`).
Le Core HIVE-MIND est conservé comme un daemon headless serveur WebSocket (`TuiServerTransport`), tandis que la TUI devient un client WebSocket indépendant et hautement réactif.

## Architecture Decisions
- **Decoupled Transport Bridge**: Le transport serveur `HiveTransport.ts` et `TuiServerTransport.ts` sont relocalisés dans `src/core/transport/tui/` au sein de HIVE-MIND. Le Core reste autonome et capable de servir n'importe quel client externe.
- **Strict Protocol Contract via JSON WebSocket**: Les deux entités communiquent exclusivement via le protocole événementiel WebSocket défini par `tui-connection.json` (host, port, token d'authentification dynamique).
- **Zero Backend Leakage in TUI Client**: Suppression de tous les imports directs de modules backend (`providerRouter`, `envResolver`, `services`) dans la TUI (`providerStatus.ts`). Le client TUI est rendu 100% agnostique.
- **Dependency Leanliness**: Retrait de toutes les dépendances React/Ink (`@jrichman/ink`, `ink-spinner`, `ink-text-input`, `react`, `@xterm/headless`, `lowlight`, `clipboardy`) du `package.json` de HIVE-MIND, accélérant drastiquement le lint, le build et les tests du core.
- **Teamwork Decomposition**: Organisation du travail en tranches verticales indépendantes avec parallélisation possible entre la préparation du dépôt TUI et le nettoyage du Core, clôturées par des revues adversariales strictes.

---

## Parallelization Opportunities & Teamwork Matrix

```
┌─────────────────────────────────────────────────────────────┐
│                    Coordinator (Primary)                    │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
    [Piste 1: Core Decoupling]     [Piste 2: Standalone TUI Setup]
               │                               │
       Worker Alpha (Core)            Worker Beta (TUI Scaffold)
               │                               │
     Critic 1 (Core Integrity)        Worker Gamma (TUI Imports)
               │                               │
  Worker Delta (Deps Pruning)          Critic 2 (TUI Build/Lint)
               │                               │
     Critic 3 (Deps Auditor)                   │
               │                               │
               └───────────────┬───────────────┘
                               │
                Worker Epsilon (E2E Integration)
                               │
               Global Critic (Final Release Gate)
```

| Rôle / Agent | Responsabilité Principale | Fichiers / Scope |
|---|---|---|
| **Worker Alpha** | Relocalisation transport Core & types | `src/core/transport/tui/`, `TuiServerTransport.ts` |
| **Critic 1** | Audit intégrité statique & tests Core | `tui_websocket.test.ts`, `tsc`, `eslint` Core |
| **Worker Beta** | Initialisation repo TUI & structure | `/home/omni/Code/HIVE-MIND-TUI/`, `package.json` |
| **Worker Gamma** | Découplage imports TUI & `providerStatus` | `HIVE-MIND-TUI/src/`, `safeFs.ts` local |
| **Critic 2** | Audit compilation & linting TUI standalone | `HIVE-MIND-TUI` `tsc`, `eslint`, build |
| **Worker Delta** | Suppression `src/tui/` & délestage deps Core | `HIVE-MIND/package.json`, `rm -rf src/tui/` |
| **Critic 3** | Audit non-régression Core post-délestage | `npm test` global (68 suites / 531 tests) |
| **Worker Epsilon** | Validation E2E runtime Core ↔ TUI | Handshake WebSocket, chat stream, HITL |
| **Global Critic** | Validation finale 100% production-grade | Dual-repo audit, zero-slop guarantee |

---

## Task List Index

### Phase 1: Core Transport Decoupling & Isolation
- [ ] **Task 1**: Relocalisation de `HiveTransport.ts` dans `src/core/transport/tui/` et mise à jour des imports Core.
- [ ] **Task 2**: Réalignement du test d'intégration `tui_websocket.test.ts` sans dépendance vers `src/tui/`.
- [ ] **Checkpoint 1**: Validation de l'intégrité du Core (`tsc --noEmit` & `tui_websocket.test.ts` PASS).

### Phase 2: Standalone TUI Repository Construction
- [ ] **Task 3**: Initialisation du dépôt `/home/omni/Code/HIVE-MIND-TUI`, copie des 136 fichiers TUI et configuration (`package.json`, `tsconfig.json`).
- [ ] **Task 4**: Injection des utilitaires autonomes `safeFs.ts` et `errors.ts` dans le dépôt TUI.
- [ ] **Task 5**: Réalignement des imports internes et élimination des imports backend directs (`providerStatus.ts`).
- [ ] **Task 6**: Validation statique complète du dépôt TUI (`npm install`, `tsc --noEmit`, `eslint`).
- [ ] **Checkpoint 2**: Dépôt TUI autonome 100% vert et compilable.

### Phase 3: Monorepo Pruning & Dependency Cleanup
- [ ] **Task 7**: Suppression physique du dossier `src/tui/` dans HIVE-MIND.
- [ ] **Task 8**: Délestage des dépendances Ink/React dans `package.json` de HIVE-MIND et mise à jour des scripts.
- [ ] **Checkpoint 3**: HIVE-MIND Core 100% allégé, build et suites Jest vertes.

### Phase 4: Cross-Repository E2E & Final Verification
- [ ] **Task 9**: Test d'intégration runtime E2E Core Daemon ↔ TUI Standalone via `tui-connection.json`.
- [ ] **Checkpoint 4**: Revue de sortie et validation globale par le critique adversarial.

---

## Risks and Mitigations

| Risque Identifié | Impact | Stratégie d'Atténuation Factuelle |
|---|---|---|
| Désynchronisation du protocole WebSocket | Moyen | Figer les contrats d'événements (`HiveTransportEvents`) et documenter les types sur le fil. |
| Dépendance cachée dans HIVE-MIND vers un fichier TUI | Élevé | Checkpoint 1 strict avec `npx tsc --noEmit` et grep global avant toute suppression. |
| Imports backend résiduels dans la TUI (`providerRouter`) | Moyen | Réécrire `providerStatus.ts` pour consommer les données diffusées par le Core ou fournir un état local mocké/découplé. |
| Conflit de package lock / version React 19 dans le nouveau dépôt | Faible | Définir un `package.json` exact dérivé des versions déjà validées et stables de HIVE-MIND. |

---

## Open Questions & User Input
1. **Validation du chemin du nouveau dépôt** : Confirmation de l'emplacement cible `/home/omni/Code/HIVE-MIND-TUI`.
2. **Gestion GWS** : Activation de la synchronisation Google Tasks si accès réseau approuvé hors sandbox.
