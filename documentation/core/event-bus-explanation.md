# EventBus (BotEvents) — Architecture & Principes de Fonctionnement

Le sous-système **EventBus** constitue le canal nerveux asynchrone et réactif de HIVE-MIND, permettant une communication totalement découplée entre l'ensemble des modules producteurs et consommateurs d'événements.

## 1. Contexte & Problématique d'Ingénierie

Dans un système d'agent autonome modulaire, de nombreux sous-systèmes doivent réagir aux étapes du cycle de vie sans pour autant introduire de dépendances directes :
- **Télémétrie et monitoring** : L'interface graphique (TUI), les métriques d'usage et les modules de supervision runtime doivent observer les requêtes IA et les exécutions d'outils sans s'immiscer dans le code de `BotCore`.
- **Réaction en temps réel aux événements externes** : Les passerelles de transport (WhatsApp, Discord, Telegram) reçoivent des messages, des déconnexions ou des réactions et doivent les notifier aux gestionnaires de mémoire et d'authentification de façon non-bloquante.
- **Gestion des pannes critiques (Kill Switch)** : Les erreurs système fatales et conflits de session doivent être propagés instantanément à l'ensemble du démon pour déclencher l'arrêt sécurisé ou l'alerte de l'administrateur.

`EventBus` résout ces besoins en implémentant le patron de conception Publication/Souscription (*Pub/Sub*) au-dessus d'une taxonomie normalisée et immuable d'événements (`BotEvents`).

## 2. Modèle Mental & Architecture Conceptuelle

L'architecture repose sur un émetteur-récepteur central (`EventBus`) étendant `EventEmitter` de Node.js :
- **Émission non-bloquante (`publish`)** : Un composant producteur émet un signal avec ses arguments associés sans connaître l'identité, le nombre ou l'état des consommateurs.
- **Abonnement typé (`subscribe`, `subscribeOnce`)** : Les observateurs enregistrent leurs fonctions de rappel (*handlers*) sur des chaînes d'événements canoniques.
- **Journalisation transparente** : Lorsque le mode de débogage est activé (`DEBUG=true`), les événements sont journalisés avec troncature de sécurité des charges utiles volumineuses.

```
       [PRODUCTEURS]                                [CONSOMMATEURS]
 ┌───────────────────────┐                    ┌───────────────────────┐
 │ TransportManager      │──┐              ┌─►│ TuiServerTransport    │
 │ (MESSAGE_RECEIVED)    │  │              │  │ (Rendu temps réel)    │
 └───────────────────────┘  │              │  └───────────────────────┘
 ┌───────────────────────┐  │  publish()   │  ┌───────────────────────┐
 │ BotCore / LLM Router  │──┼─► [EventBus] ┼─►│ SemanticMemory        │
 │ (AI_REQUEST/RESPONSE) │  │              │  │ (Capture souvenirs)   │
 └───────────────────────┘  │              │  └───────────────────────┘
 ┌───────────────────────┐  │              │  ┌───────────────────────┐
 │ PluginLoader          │──┘              └─►│ RuntimeSentinel       │
 │ (PLUGIN_EXECUTED)     │                    │ (Supervision sécurité)│
 └───────────────────────┘                    └───────────────────────┘
```

## 3. Choix de Conception & Raisons d'Ingénierie

1. **Taxonomie Immuable Centralisée (`BotEvents`)** :
   - *Raison* : L'utilisation d'une constante immuable contenant les noms d'événements élimine les fautes de frappe (*magic strings*) et fournit un contrat d'interfaçage clair entre toutes les couches du système.
2. **Plafond d'Écouteurs Adapté (`setMaxListeners(50)`)** :
   - *Raison* : Le plafond par défaut de Node.js (10 écouteurs) générait des alertes fallacieuses de fuite de mémoire lorsque plusieurs plugins, loggers et passerelles s'abonnaient aux flux de messages. Le seuil de 50 est dimensionné pour la charge nominale de HIVE-MIND tout en détectant d'éventuels abonnements en boucle infinie.
3. **Encapsulation Propre (`publish / subscribe`)** :
   - *Raison* : Masquer l'API interne (`emit / on / off`) sous une nomenclature standard facilite une éventuelle migration vers un courtier distribué (Redis Pub/Sub, NATS) sans modifier le code métier des appelants.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Appels de Méthodes Directs / Callbacks** | Zéro indirection, traçage direct dans la pile d'appels. | Couplage fort entre composants ; l'ajout d'un nouvel observateur oblige à modifier tous les producteurs. |
| **Broker de Messages Externe (Redis Pub/Sub / RabbitMQ)** | Communication inter-processus et multi-serveurs. | Dépendance d'infrastructure et latence réseau injustifiées pour la synchronisation intra-processus. |
| **Streams Node.js (`Readable / Transform`)** | Gestion native de la contre-pression (*backpressure*). | Complexité accrue pour des notifications ponctuelles du cycle de vie ne nécessitant pas de découpage en flux binaires. |

## 5. Frontières Architecturales & Invariants

- **Dans le périmètre de `EventBus`** :
  - Distribution synchrone/asynchrone des événements aux écouteurs abonnés.
  - Normalisation de la nomenclature des événements via `BotEvents`.
  - Traçabilité et journalisation conditionnelle des charges utiles.
- **Exclu du périmètre** :
  - Persistance ou rejeu des événements passés (aucune garantie de livraison après déconnexion).
  - Ordonnancement équitable ou mise en file d'attente (délégués à `FairnessQueue`).

## 6. Liens & Navigation

- **Référence Technique :** [`event-bus-reference.md`](./event-bus-reference.md)
- **Guide Pratique d'Intégration :** [`event-bus-howto.md`](./event-bus-howto.md)
- **Index du Domaine Core :** [`index.md`](./index.md)
