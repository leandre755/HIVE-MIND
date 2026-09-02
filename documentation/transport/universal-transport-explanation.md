# SS-15 : Universal Multi-Channel Transport Layer & ITransport Abstraction — Architecture & Principes de Fonctionnement

Le sous-système **SS-15** (`Universal Multi-Channel Transport Layer`) constitue la couche d'abstraction unifiée des canaux de communication de HIVE-MIND, isolant hermétiquement le cœur décisionnel ReAct et l'orchestrateur de l'agent de toute dépendance vis-à-vis des protocoles réseau, des sockets bas niveau et des formats de messages propriétaires.

---

## 1. Contexte & Problématique d'Ingénierie

Un agent autonome multi-canal moderne est confronté à une hétérogénéité protocolaire extrême :
- **WhatsApp** repose sur des WebSockets binaires et des structures Protobuf encapsulées (`@whiskeysockets/baileys`), nécessitant le maintien d'une session cryptographique multi-fichiers, la gestion des accusés de réception, le calcul de formes d'onde audio (waveforms PCM) et la protection contre le rejeu de messages archivés au démarrage (*anti-backlog*).
- **Discord** fonctionne via une API REST et une Gateway WebSocket propriétaire (`discord.js-selfbot-v13`), avec une limite dure stricte de 2 000 caractères par message et une topologie complexe de serveurs (*guilds*), canaux textuels et messages privés.
- **Telegram** exploite le protocole binaire MTProto via la bibliothèque GramJS (`telegram`), avec une sérialisation spécifique des entités (`PeerUser`, `PeerChat`, `PeerChannel`) et un plafond de 4 096 caractères par message.
- **CLI & TUI** exigent des canaux locaux asynchrones ou des flux IPC WebSocket pour le contrôle terminal et le débogage sans connectivité réseau.
- **Routines Cognitives Internes** (telles que le moteur de réflexion nocturne *Dream Reflection* ou le pouls conscient du système) génèrent des événements synthétiques qui doivent traverser la boucle d'orchestration sans émettre d'octets sur un réseau externe.

Coupler directement le moteur d'inférence (`BotCore`), la file d'attente équitable (`FairnessQueue`) ou les gestionnaires d'outils à ces bibliothèques tierces créerait un enchevêtrement critique (*spaghetti code*), empêcherait tout test unitaire déterministe et rendrait l'ajout d'un nouveau canal prohibitif.

Le sous-système SS-15 résout ce défi en introduisant le contrat d'interface polymorphique universel `ITransport` orchestré par `TransportManager`.

---

## 2. Modèle Mental & Architecture Conceptuelle

Le principe fondamental de SS-15 est la **normalisation bidirectionnelle** :
1. **Flux Entrant (Inbound)** : Les événements réseau bruts (paquets Baileys, messages Discord, updates GramJS) sont capturés par l'adaptateur de canal dédié, convertis en un objet pivot immuable `MessageData`, étiquetés avec le canal source (`sourceChannel`) par `TransportManager`, puis transmis à la file de traitement centralisée (`FairnessQueue`).
2. **Flux Sortant (Outbound)** : Lorsque le cœur décisionnel produit une réponse (`sendText`, `sendMedia`, `sendUniversalResponse`), `TransportManager` résout l'instance de transport cible à partir du `sourceChannel` d'origine (ou de l'alias `current`), applique le découpage de charge (*chunking*) et le formatage adapté au réseau cible, et délègue l'expédition à l'adaptateur sans que le cœur ne connaisse la destination physique.

```
                   ┌───────────────────────────────────────────────────────────┐
                   │       CŒUR DÉCISIONNEL & ORCHESTRATION (BotCore)          │
                   │  - Traitement ReAct agnostique des canaux                 │
                   │  - Manipule uniquement MessageData & UniversalResponse    │
                   └─────────────────────────────┬─────────────────────────────┘
                                                 │
                                                 ▼
                   ┌───────────────────────────────────────────────────────────┐
                   │             TransportManager (Routeur Central)            │
                   │  - Enregistrement dynamique (register / initialize)       │
                   │  - Injection du ServiceContainer (IoC)                    │
                   │  - Tagging automatique (sourceChannel: "whatsapp"...)     │
                   │  - Résolution de l'alias 'current' & transport par défaut │
                   │  - Sanctuarisation des chemins de fichiers (safeFs)       │
                   └───────┬─────────────┬─────────────┬─────────────┬─────────┘
                           │             │             │             │
        ┌──────────────────┴──┐   ┌──────┴──────┐   ┌──┴──────────┐  └─────────────┐
        ▼                     ▼   ▼             ▼   ▼             ▼                ▼
 ┌──────────────┐      ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
 │   WhatsApp   │      │   Discord    │  │   Telegram   │  │   Headless   │  │   Internal   │
 │   Baileys    │      │   Selfbot    │  │    GramJS    │  │   TUI IPC    │  │    System    │
 │ (WS/Protobuf)│      │  (Gateway)   │  │  (MTProto)   │  │ (WebSocket)  │  │   (Inerte)   │
 └──────────────┘      └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

### Pipeline des Flux d'Information

```
[Événement Réseau Brut] (ex. WhatsApp proto.IWebMessageInfo)
        │
        ▼
[Adaptateur Dédié] (ex. baileys.ts)
  - Extraction du texte, expéditeur, groupe, médias
  - Instanciation de l'objet pivot MessageData
        │
        ▼
[TransportManager.onMessage]
  - Injection du tag sourceChannel ("whatsapp")
  - Dispatch vers la FairnessQueue (SS-02)
        │
        ▼
[BotCore / ReAct Loop]
  - Raisonnement & sélection d'outils
  - Génération de la réponse (UniversalResponse)
        │
        ▼
[TransportManager.sendUniversalResponse]
  - Résolution du transport émetteur via sourceChannel
  - Confinement des chemins fichiers dans les racines autorisées
  - Découpage en blocs (chunking 1990 chars Discord / 4000 chars Telegram)
        │
        ▼
[Socket Physique Émettrice]
```

---

## 3. Choix de Conception & Raisons d'Ingénierie

### 3.1. Contrat Polymorphique Unique `ITransport`
L'interface `ITransport` formalise les 15 primitives indispensables à tout système de messagerie complet :
- Gestion de session : `connect()`, `disconnect()`.
- Expédition de contenus : `sendText()`, `sendMedia()`, `sendVoiceNote()`, `sendFile()`, `sendSticker()`, `sendReaction()`, `sendUniversalResponse()`.
- Gestion des groupes & droits : `getGroupMetadata()`, `isAdmin()`.
- Réception & streaming : `onMessage()`, `onGroupEvent()`, `downloadMedia()`, `setPresence()`.

Toute classe ou objet implémentant ce contrat peut être injecté à chaud dans `TransportManager` sans redémarrage de l'agent.

### 3.2. Duck-Typing et Extension `TransportCapabilities`
Certaines bibliothèques exposent des capacités spécialisées non universelles (par exemple, l'accès direct au socket Baileys `sock` requis par les plugins de gestion de participants WhatsApp, ou le téléchargement des médias cités `downloadQuotedMedia`). Plutôt que de surcharger l'interface `ITransport` au détriment des transports légers (Discord, CLI), `TransportManager` utilise le duck-typing sécurisé via `TransportCapabilities`.

### 3.3. Sanctuarisation des Sorties Fichiers (`resolveWithinRoot`)
Lors de l'envoi de fichiers sur le réseau (`sendFile`), `TransportManager` applique une validation défensive stricte : le chemin cible doit obligatoirement être confiné dans l'une des racines autorisées du projet (`storage_hm/`, `temp/`, `hm_storage/`, `Sandbox1/`). Toute tentative d'exfiltration d'un fichier système ou sensible (ex. `/etc/passwd` ou `.env`) est bloquée immédiatement par une exception explicite.

### 3.4. Découplage des Gestionnaires Spécialisés (`AntiDeleteHandler` & `AudioHandler`)
Les comportements complexes sont extraits dans des gestionnaires autonomes :
- **`AntiDeleteHandler`** : Capture les messages de groupe entrants de manière synchrone dans la mémoire vive (`_fastStoreMessage`) pour éliminer toute condition de course (*race condition*), puis détecte les révocations de messages (`StubType.REVOKE` ou payload nul) pour restaurer le contenu supprimé si l'option est activée.
- **`AudioHandler`** : Évalue la stratégie audio configurée (`prefer_native` vs cascade STT), gère l'écoute passive ou sélective dans les groupes (`mention_only`, `full`, `off`), télécharge les flux audio chiffrés et invoque le service de transcription (`transcriptionService`) via le conteneur IoC.

---

## 4. Analyse Comparative & Alternatives Écartées

| Approche Évaluée | Avantages Théoriques | Inconvénients & Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Couplage Direct aux Sockets (Monolithique)** | Latence brute légèrement réduite (zéro couche d'abstraction). | Impossibilité de tester unitairement le bot ; toute modification de Baileys casse l'orchestrateur ; support multi-canal impossible. |
| **Framework Tiers Unifié (ex. Bottender)** | Écosystème de connecteurs préexistants. | Poids excessif en mémoire (incompatible avec l'hôte 8 Go RAM) ; support WhatsApp Baileys absent ou obsolète ; manque de contrôle sur les protocoles audio natifs (Gemini Live) et waveforms. |
| **Architecture Microservices Réseau (gRPC / RabbitMQ)** | Isolation stricte des processus par canal. | Complexité opérationnelle disproportionnée ; surconsommation CPU/RAM sur machine bi-cœur ; latence inter-processus dégradant la réactivité vocale. |
| **Abstraction Polymorphique `ITransport` + `TransportManager` (Retenue)** | Découplage total $C_e = 0$ pour le cœur ; injection IoC ; transport interne silencieux pour la cognition ; empreinte mémoire minimale ($< 15$ Mo). | Nécessite la normalisation manuelle des spécificités de chaque canal (chunking, format des pièces jointes). |

---

## 5. Frontières Architecturales & Invariants

### Ce qui est DANS le périmètre de SS-15 :
- La définition des types universels de transport (`ITransport`, `MessageData`, `TransportGroupMetadata`).
- La gestion du cycle de vie des connexions des canaux configurés (`initialize`, `disconnect`).
- Le multiplexage des messages entrants et l'injection du métadonnée `sourceChannel`.
- Le routage intelligent des réponses vers le canal émetteur approprié.
- La protection contre le rejeu de messages obsolètes au démarrage (*anti-backlog*).
- La fragmentation automatique des messages excédant les limites de taille du protocole.

### Ce qui est STRICTEMENT EXCLU de SS-15 :
- La logique de décision et la boucle de réflexion ReAct (déléguées à `SS-01`/`BotCore`).
- La gestion des permissions et l'approbation humaine HITL (déléguées à `SS-09`/`PermissionManager`).
- La persistance sémantique et la mémoire de travail (déléguées à `SS-18`/`SemanticMemory`).
- L'ordonnancement équitable des requêtes multi-utilisateurs (délégué à `SS-02`/`FairnessQueue`).

### Invariants et Comportements de Repli :
1. **Transport par Défaut** : Si un message sortant ne spécifie aucun `sourceChannel`, ou si le canal demandé n'est pas actif, `TransportManager` bascule de manière transparente sur le premier transport actif disponible (ou `whatsapp`).
2. **Canal Inerte (`internal`/`system`)** : Les requêtes portant la source `internal` ou `system` sont absorbées par un transport factice inerte qui renvoie des promesses résolues sans émettre aucun paquet réseau.
3. **Fail-Closed sur Métadonnées de Groupe** : Si `getGroupMetadata()` échoue ou cible un canal inexistant, une erreur explicite est levée pour éviter la corruption des droits administrateurs dans l'orchestrateur.

---

## 6. Liens & Navigation

- **Référence Technique :** [`universal-transport-reference.md`](./universal-transport-reference.md)
- **Guide Pratique d'Intégration :** [`universal-transport-howto.md`](./universal-transport-howto.md)
- **Index du Domaine :** [`index.md`](./index.md)
- **Index Général :** [`../00_index.md`](../00_index.md)
