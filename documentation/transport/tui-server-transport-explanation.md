# SS-16 : Headless Daemon TUI IPC Server Transport & HiveTransport — Architecture & Principes de Fonctionnement

Le sous-système **SS-16** (`Headless Daemon TUI IPC Server Transport`) constitue la passerelle de communication inter-processus (IPC) bidirectionnelle sur WebSocket reliant le démon d'agent principal HIVE-MIND à son interface utilisateur terminale détachable (`HIVE-MIND-TUI`), permettant un fonctionnement 100% autonome et sans interface graphique intégrée (*headless*).

---

## 1. Contexte & Problématique d'Ingénierie

Historiquement, les frameworks d'agents autonomes intègrent souvent leur interface utilisateur terminale (TUI) directement au sein du runtime applicatif (en embarquant React, Ink, des analyseurs de syntaxe, des terminaux virtuels et des moteurs de rendu de composants). Dans HIVE-MIND, cette approche posait des contraintes critiques :
1. **Poids et Empreinte Mémoire** : L'inclusion de React/Ink et de 136 composants graphiques consommait plus de 150 Mo de RAM supplémentaires sur un hôte aux ressources très restreintes (Dual-core i5, 8 Go RAM totale, ~1,2 Go libre).
2. **Vulnérabilités de Verrouillage de la Boucle d'Événements** : Les calculs de rendu de l'interface bloquaient la boucle d'événements Node.js, augmentant la gigue (*jitter*) lors des échanges audio temps réel (Gemini Live) ou de la réception de messages WhatsApp.
3. **Impossibilité de Déconnexion / Reconnexion à Chaud** : L'arrêt ou le redémarrage du terminal provoquait l'arrêt forcé du démon d'agent en arrière-plan.

L'objectif d'ingénierie fondamental a donc été de **découpler intégralement la TUI du Core** : extraire les composants React/Ink dans un dépôt standalone (`HIVE-MIND-TUI`) et concevoir un serveur IPC local ultra-léger et sécurisé (`TuiServerTransport`) complété par un adaptateur de transport standard (`HiveTransportImpl`).

---

## 2. Modèle Mental & Architecture Conceptuelle

Le sous-système SS-16 repose sur une architecture client-serveur locale asynchrone :
- **`TuiServerTransport` (Serveur WebSocket)** : Écoute exclusivement sur l'interface de boucle locale `127.0.0.1`. Au démarrage, il négocie dynamiquement un port libre à partir du port de base `5001` (avec 20 tentatives), génère un jeton UUID cryptographique éphémère, et écrit ces paramètres de connexion dans un fichier de liaison temporaire `tui-connection.json`.
- **`HiveTransportImpl` (Adaptateur Transport)** : Implémente le contrat universel `ITransport` (SS-15) tout en étendant `EventEmitter<HiveTransportEvents>`. Il convertit les appels du cœur décisionnel (`sendText`, `sendMedia`, `setPresence`, `requestConfirmation`) en événements typés diffusés aux clients connectés, et injecte les saisies utilisateur (`submitUserMessage`) dans le pipeline de l'agent.
- **Protocole de Validation Humaine (*HITL RPC Bridge*)** : Lorsqu'une action sensible requiert une confirmation (`PermissionManager`, SS-09), `HiveTransportImpl` génère un identifiant unique `conf-<UUID>`, enregistre une promesse en attente (`pendingConfirmations`), et émet une trame `confirmation_request` via le serveur WebSocket. Lorsque le client TUI renvoie `confirmation_response`, la promesse est résolue et débloque le flux d'exécution.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DÉMON HIVE-MIND (Headless Core)                         │
│                                                                             │
│  ┌───────────────────────┐             ┌──────────────────────────────────┐  │
│  │   PermissionManager   │             │             BotCore              │  │
│  │        (SS-09)        │             │             (SS-01)              │  │
│  └───────────┬───────────┘             └────────────────┬─────────────────┘  │
│              │ askPermission()                          │ sendText/sendMedia │
│              ▼                                          ▼                    │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                 HiveTransportImpl (extends EventEmitter)               │  │
│  │   - pendingConfirmations: Map<id, { resolve }>                         │  │
│  │   - submitUserMessage() -> route vers onMessage()                      │  │
│  └───────────────────────────────────┬────────────────────────────────────┘  │
│                                      │ emit('message', 'confirmation_request')
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │               TuiServerTransport (WebSocket Server ws://127.0.0.1)      │  │
│  │   - Allocation dynamique de port (5001 -> 5021)                        │  │
│  │   - Écrit tui-connection.json (host, port, token)                      │  │
│  │   - Timeout d'authentification strict (3000ms, code 4401)              │  │
│  │   - Broadcast typé aux clients WebSocket authentifiés                  │  │
│  └───────────────────────────────────┬────────────────────────────────────┘  │
└──────────────────────────────────────┼──────────────────────────────────────┘
                                       │
                                       │ Flux IPC WebSocket Local
                                       │ (JSON Protocol)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              CLIENT STANDALONE TUI (Dépôt HIVE-MIND-TUI)                    │
│                                                                             │
│  - Lit tui-connection.json                                                  │
│  - Envoie {"type": "auth", "token": "<UUID>"}                               │
│  - Affiche les cartes, flux ReAct, diffs et métriques en React/Ink          │
│  - Soumet les messages utilisateur et les approbations HITL                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Séquence du Protocole IPC & Cycle HITL

```
Démon (TuiServerTransport)                       Client (HIVE-MIND-TUI)
        │                                                  │
        ├─ Écrit tui-connection.json (port, token)         │
        │                                                  ├─ Lit tui-connection.json
        │<──────── Connecte WebSocket (ws://127.0.0.1:5001)─┤
        │  [Démarre timer auth 3000ms]                     │
        │<──────── {"type":"auth", "token":"<UUID>"} ───────┤
        │  [Valide le token & annule le timer]             │
        ├───────── {"type":"auth_success"} ────────────────>│
        ├───────── {"type":"connection_status", ...} ──────>│
        │                                                  │
        │  [BotCore génère une réponse]                    │
        ├───────── {"type":"message", "data":{...}} ───────>│
        │                                                  │
        │  [PermissionManager demande approbation HITL]   │
        ├───────── {"type":"confirmation_request", ...} ───>│
        │  [Enregistre conf-<UUID> en mémoire]             │
        │                                                  │  [Opérateur appuie sur 'y']
        │<──────── {"type":"confirmation_response",        │
        │          "id":"conf-...", "approved":true} ──────┤
        │  [Résout la promesse correspondante]             │
        │  [L'action sensible s'exécute]                   │
```

---

## 3. Choix de Conception & Raisons d'Ingénierie

### 3.1. Confinement Strict sur la Boucle Locale (`127.0.0.1`)
Le serveur WebSocket refuse d'écouter sur `0.0.0.0` ou sur des interfaces réseau externes. Ce choix protège l'agent contre toute attaque par rebond réseau non authentifié, garantissant que seuls les processus locaux exécutés avec les privilèges de l'utilisateur peuvent accéder à l'IPC.

### 3.2. Jeton UUID Éphémère et Fichier de Liaison (`tui-connection.json`)
À chaque démarrage, un nouveau jeton aléatoire cryptographique `randomUUID()` est généré. Le fichier `tui-connection.json` sert de point de rendez-vous (*discovery file*) entre les processus :
- Il est écrit de manière atomique et sécurisée via `safeWriteFileSync`.
- Il est immédiatement supprimé à l'arrêt du serveur via `safeUnlinkSync`.

### 3.3. Délai d'Authentification Strict (*Fail-Closed Timeout*)
Tout client WebSocket qui se connecte dispose d'un délai maximum de **3 000 ms** pour émettre une trame `auth` valide. Passé ce délai sans authentification réussie, la connexion est immédiatement close avec le code d'erreur `4401 (Unauthorized timeout)`, protégeant le démon contre les connexions fantômes ou l'épuisement de sockets.

### 3.4. Typage Fort des Événements (`EventEmitter<HiveTransportEvents>`)
Pour éviter toute désynchronisation entre les charges utiles émises et reçues, la classe `HiveTransportImpl` type l'ensemble de ses événements de manière stricte via l'interface `HiveTransportEvents` (`message`, `presence`, `confirmation_request`, `media`, `voice`, `file`, `sticker`, `visual_response`, `connection_status`, `reaction`).

---

## 4. Analyse Comparative & Alternatives Écartées

| Mécanisme IPC Évalué | Avantages Théoriques | Inconvénients & Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Mémoire Partagée (*Shared Memory / mmap*)** | Latence proche de zéro, débit maximal. | Complexité extrême de sérialisation ; support asynchrone natif complexe en TypeScript ; pas de portabilité simple vers d'autres langages. |
| **Sockets de Domaine Unix (*UDS - AF_UNIX*)** | Sécurité par permissions de fichiers, pas d'ouverture de port TCP. | Incompatibilité et comportements asymétriques sur Windows ; débogage complexe dans les tests conteneurisés. |
| **TUI Directement Embarquée dans le Démon** | Zéro protocole IPC, communication directe par fonctions. | Poids mémoire massif (+150 Mo) ; bloque la boucle d'événements Node.js ; viole l'architecture headless et empêche le détachement de la console. |
| **WebSocket Local sur `127.0.0.1` (Retenue)** | Universel, asynchrone, standard ; permet de brancher des TUI en Rust (`ratatui`), Go (`bubbletea`) ou Electron ; empreinte mémoire négligeable ($< 2$ Mo). | Nécessite un handshake d'authentification par token et la gestion de ports libres. |

---

## 5. Frontières Architecturales & Invariants

### Ce qui est DANS le périmètre de SS-16 :
- L'écoute WebSocket locale, la négociation de port libre et la gestion des clients connectés.
- L'émission et la vérification du jeton d'authentification temporaire.
- La diffusion (*broadcast*) des événements du démon vers les clients TUI.
- La sérialisation et la résolution des requêtes d'approbation humaine (HITL).
- L'injection des messages utilisateur saisis dans la TUI dans le pipeline `ITransport`.

### Ce qui est STRICTEMENT EXCLU de SS-16 :
- Le rendu graphique et l'arbre de composants Ink/React (100% déportés dans `HIVE-MIND-TUI`).
- L'évaluation des règles de sécurité des commandes shell ou de fichiers (déléguée à `SS-09`).
- La mise en file d'attente des messages reçus (déléguée à `SS-02`/`FairnessQueue`).

### Invariants et Comportements d'Arrêt :
1. **Nettoyage Garanti au Shutdown** : Lors de l'invocation de `tuiServerTransport.stop()`, toutes les sockets clientes reçoivent le code de fermeture `1001 (Server shutting down)`, le serveur WebSocket est fermé, et le fichier `tui-connection.json` est supprimé du disque.
2. **Fail-Closed sur Payload Invalide** : Toute commande client ne respectant pas la structure JSON `{ type: string, ... }` est rejetée sans traitement.

---

## 6. Liens & Navigation

- **Référence Technique :** [`tui-server-transport-reference.md`](./tui-server-transport-reference.md)
- **Guide Pratique d'Intégration :** [`tui-server-transport-howto.md`](./tui-server-transport-howto.md)
- **Index du Domaine :** [`index.md`](./index.md)
- **Index Général :** [`../00_index.md`](../00_index.md)
