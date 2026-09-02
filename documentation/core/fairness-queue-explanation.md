# FairnessQueue — Architecture & Principes de Fonctionnement

Le sous-système **FairnessQueue** est l'ordonnanceur d'événements multi-tenants de HIVE-MIND, garantissant une allocation équitable du temps de traitement et des ressources d'inférence LLM entre l'ensemble des conversations actives.

## 1. Contexte & Problématique d'Ingénierie

Dans un démon conversationnel connecté à plusieurs canaux de messagerie (groupes WhatsApp à fort trafic, salons Discord, canaux Telegram et sessions TUI privées), une file d'attente FIFO globale naïve génère des défaillances critiques :
- **Famine des petits canaux (*Starvation*)** : Si un groupe d'utilisateurs émet subitement 50 messages en rafale, une file FIFO simple bloque toutes les requêtes des autres utilisateurs jusqu'à l'épuisement de la rafale.
- **Retard sur les commandes administratives critiques** : Les commandes de contrôle du bot (`!stop`, `!ping`, modération) se retrouvent coincées derrière des tâches d'inférence longues.
- **Fuites de mémoire par accumulation d'états vides** : La persistance de métadonnées pour des canaux inactifs dégrade progressivement les performances d'itération.

`FairnessQueue` résout ces problématiques par un ordonnancement circulaire équitable (*Deficit Round-Robin* / *Weighted Round-Robin*) avec voie rapide prioritaire (*FastLane VIP*).

## 2. Modèle Mental & Architecture Conceptuelle

La structure de données maintient :
1. Une table associative `queues: Map<string, QueueEvent[]>` contenant les événements en attente par identifiant de canal (`chatId`).
2. Une liste circulaire ordonnée `chatIds: string[]` recensant uniquement les canaux ayant au moins un événement en attente.
3. Un pointeur d'itération circulaire `currentIndex: number`.

Lors de chaque dépilement (`dequeue()`) :
- L'ordonnanceur sélectionne le canal pointé par `currentIndex`.
- Il extrait le premier événement (`queue.shift()`).
- Si la file de ce canal devient vide, le `chatId` est immédiatement retiré de la liste circulaire et de la table associative pour libérer la mémoire.
- Si la file contient encore des événements, le pointeur avance au canal suivant (`advance()`), garantissant qu'aucun canal ne monopolise deux cycles consécutifs tant que d'autres canaux attendent.

```
                         [FairnessQueue State]

  Tableau Circulaire (chatIds) : [ "Chat_A", "Chat_B", "Chat_C" ]
                                                 ▲
                                                 │ (currentIndex)

  Files associées (queues) :
    ┌──────────┐     ┌──────────┐     ┌────────────────────────┐
    │  Chat_A  │     │  Chat_B  │     │         Chat_C         │
    ├──────────┤     ├──────────┤     ├────────────────────────┤
    │ [Evt A1] │     │ [Evt B1] │     │ [Evt C_VIP (Prioritaire)]│
    │ [Evt A2] │     └──────────┘     │ [Evt C2]               │
    └──────────┘                      └────────────────────────┘
```

### Mécanisme de Voie Prioritaire (VIP FastLane)
Lorsqu'un événement provient d'un administrateur ou d'une commande système prioritaire (`isPremium = true`) :
1. L'événement est inséré en tête de sa file locale (`queue.unshift(event)`).
2. Le pointeur circulaire `currentIndex` est instantanément repositionné sur l'index de ce canal.
3. Le prochain appel à `dequeue()` traitera immédiatement cet événement prioritaire sans attendre la fin du cycle circulaire.

## 3. Choix de Conception & Raisons d'Ingénierie

1. **Pureté Algorithmique & Zéro Dépendance** :
   - *Raison* : Le composant ne dépend d'aucun module externe ni d'API Node.js (`fs`, `events`, `os`), ce qui garantit une portabilité totale et une exécution synchrone ultra-rapide ($O(1)$ par opération de base).
2. **Élagage Automatique de Mémoire (Auto-Pruning)** :
   - *Raison* : La suppression immédiate de la clé dans `Map` et du tableau `chatIds` dès que la file d'un tenant est vide empêche toute fuite de mémoire sur les démons traitant des milliers de discussions éphémères.
3. **Résilience aux Mutations Concurrentes par Snapshot** :
   - *Raison* : La boucle de recherche dans `dequeue()` capture la taille du tableau (`totalChats = this.chatIds.length`) et réajuste l'index par modulo pour éviter les dépassements de limites (*index out of bounds*) en cas d'altération dynamique de la file.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **File FIFO Simple (`Array.shift()`)** | Complexité minimale d'implémentation. | Famine systématique des conversations à faible volume lorsqu'un groupe subit un afflux massif de messages. |
| **File à Priorités Statiques (Heap/Priority Queue)** | Gestion native des priorités numériques. | Risque de famine totale des priorités basses si un flux continu de priorité moyenne/haute arrive. |
| **Broker Externe (RabbitMQ / Redis Streams)** | Persistance distribuée inter-processus. | Latence I/O réseau supplémentaire, surcoût d'infrastructure injustifié pour l'ordonnancement intra-processus du bot. |

## 5. Frontières Architecturales & Invariants

- **Dans le périmètre de `FairnessQueue`** :
  - Organisation, stockage et équilibrage multi-tenants des événements en mémoire.
  - Priorisation unitaire des événements VIP.
  - Calcul des métriques de charge (`size`, `activeChats`).
- **Exclu du périmètre** :
  - Exécution asynchrone des tâches ou temporisations entre messages (déléguées à `BotCore` / `orchestrator.ts`).
  - Filtrage des permissions administratives (délégué à `PermissionManager`).
  - Persistance sur disque en cas de crash du processus.

## 6. Liens & Navigation

- **Référence Technique :** [`fairness-queue-reference.md`](./fairness-queue-reference.md)
- **Guide Pratique d'Intégration :** [`fairness-queue-howto.md`](./fairness-queue-howto.md)
- **Index du Domaine Core :** [`index.md`](./index.md)
