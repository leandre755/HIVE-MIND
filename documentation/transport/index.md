# Domaine 3 : Transports, Passerelles & Interfaces Utilisateur (SS-15 à SS-17)

Bienvenue dans l'index du **Domaine 3 : Transports, Passerelles & Interfaces Utilisateur** de HIVE-MIND. Ce domaine regroupe l'ensemble des composants assurant l'indépendance protocolaire du noyau cognitif, le multiplexage des canaux de messagerie instantanée, la passerelle IPC avec l'interface terminale détachée et les assistants d'authentification pré-boot.

---

## 🧭 Cartographie & Responsabilités du Domaine

La couche de transport garantit que l'orchestrateur central (`BotCore`), la file d'équité (`FairnessQueue`) et les moteurs de mémoire ne manipulent jamais de sockets réseau brutes ni de structures d'événements propriétaires. Elle convertit tous les flux entrants en objets normalisés `MessageData` et achemine les réponses de l'agent vers les canaux physiques appropriés.

```
                                 ┌────────────────────────────────┐
                                 │     CŒUR COGNITIF & ReAct      │
                                 │       (BotCore / Fairness)     │
                                 └───────────────┬────────────────┘
                                                 │
                                                 ▼
                                 ┌────────────────────────────────┐
                                 │   SS-15 : Universal Transport  │
                                 │        (TransportManager)      │
                                 └───────┬───────┬───────┬────────┘
                                         │       │       │
              ┌──────────────────────────┘       │       └──────────────────────────┐
              ▼                                  ▼                                  ▼
   ┌──────────────────────┐           ┌──────────────────────┐           ┌──────────────────────┐
   │  Canaux Messagerie   │           │   SS-16 : IPC TUI    │           │  SS-17 : CLI Wizard  │
   │  WhatsApp (Baileys)  │           │ (TuiServerTransport  │           │ (authSessionManager, │
   │  Discord / Telegram  │           │   & HiveTransport)   │           │  startupMenu, Noise) │
   └──────────────────────┘           └──────────────────────┘           └──────────────────────┘
```

---

## 📚 Matrice des Sous-Systèmes & Documentation Diátaxis

Pour chaque sous-système, la documentation est rigoureusement découpée selon les 3 quadrants Diátaxis applicables :

| Sous-Système | Responsabilité & Fichiers Clés | 🧠 Architecture (*Explanation*) | 📜 Référence API (*Reference*) | 🛠️ Guide Pratique (*How-To*) |
| :--- | :--- | :--- | :--- | :--- |
| **SS-15 : Universal Multi-Channel Transport Layer** | Contrat universel `ITransport`, routeur `TransportManager`, connecteurs multi-canaux (WhatsApp, Discord, Telegram, CLI, Interne).<br>`src/core/transport/` | [universal-transport-explanation.md](./universal-transport-explanation.md) | [universal-transport-reference.md](./universal-transport-reference.md) | [universal-transport-howto.md](./universal-transport-howto.md) |
| **SS-16 : Headless Daemon TUI IPC Server Transport** | Serveur WebSocket local `127.0.0.1`, pont IPC avec le dépôt autonome `HIVE-MIND-TUI`, pont RPC pour l'approbation humaine HITL.<br>`src/core/transport/TuiServerTransport.ts`<br>`src/core/transport/tui/HiveTransport.ts` | [tui-server-transport-explanation.md](./tui-server-transport-explanation.md) | [tui-server-transport-reference.md](./tui-server-transport-reference.md) | [tui-server-transport-howto.md](./tui-server-transport-howto.md) |
| **SS-17 : CLI Interactive Auth Wizard & Session Manager** | Assistant TTY interactif, validation réseau en direct des jetons Telegram/Discord, jumelage WhatsApp par code à 8 chiffres (Noise), gestion `.env`.<br>`src/cli/` | [cli-auth-wizard-explanation.md](./cli-auth-wizard-explanation.md) | [cli-auth-wizard-reference.md](./cli-auth-wizard-reference.md) | [cli-auth-wizard-howto.md](./cli-auth-wizard-howto.md) |

---

## 🔗 Navigation Inter-Domaines

- **Index Général de la Documentation :** [`../00_index.md`](../00_index.md)
- **Domaine 1 — Cœur & Orchestration (SS-01 à SS-09) :** [`../core/index.md`](../core/index.md)
- **Domaine 2 — Fournisseurs d'IA & Routage (SS-10 à SS-14) :** [`../providers/index.md`](../providers/index.md)
- **Domaine 4 — Mémoire & Cognition (SS-18 à SS-20) :** [`../memory/index.md`](../memory/index.md)
- **Domaine 5 — Runtime, Sécurité & Contexte (SS-21 à SS-22) :** [`../runtime/index.md`](../runtime/index.md)
- **Domaine 6 — Outils, Dev Tools & Hardening (SS-23 à SS-26) :** [`../plugins/index.md`](../plugins/index.md)
