# SwarmDispatcher — Architecture & Principes de Fonctionnement

Le sous-système **SwarmDispatcher** est le régulateur de concurrence asynchrone de HIVE-MIND, orchestrant le parallélisme global des tâches du bot tout en garantissant une sérialisation stricte par canal de conversation (*per-JID Mutex*).

## 1. Contexte & Problématique d'Ingénierie

Dans un système d'agent autonome réagissant aux événements de messagerie asynchrones, deux contraintes orthogonales s'opposent :
1. **L'intégrité conversationnelle locale** : Deux messages consécutifs envoyés par un même utilisateur dans une même conversation (`jid`) doivent impérativement être traités dans leur ordre d'arrivée strict (FIFO). Si le message 2 est traité en parallèle et termine avant le message 1, l'historique conversationnel de l'agent est corrompu.
2. **Le débit et le dimensionnement matériel global** : Des utilisateurs distincts doivent pouvoir interagir simultanément avec l'agent, mais sans excéder la capacité mémoire (RAM) et processeur (CPU) de la machine hôte. Sur un serveur contraint (8 Go RAM, 2 cœurs CPU), lancer 30 boucles ReAct simultanées (chacune consommant ~250 Mo de contexte V8 et de mémoire de travail) provoque un crash immédiat par Out-Of-Memory (OOM).

`SwarmDispatcher` concilie ces deux exigences grâce à une double régulation : sérialisation locale par clé et limitation globale adaptative.

## 2. Modèle Mental & Architecture Conceptuelle

Le régulateur opère à deux niveaux :

### Niveau 1 : Sérialisation Locale par JID (Keyed Mutex)
Pour chaque `jid` actif, `SwarmDispatcher` conserve dans une table associative `accessMap: Map<string, Promise<unknown>>` la promesse correspondant à la dernière tâche en cours.
- Toute nouvelle tâche pour ce `jid` est automatiquement chaînée après la tâche précédente via `.catch().then()`.
- L'utilisation de `.catch()` garantit qu'un échec ou une exception sur la tâche $N$ ne bloque pas l'exécution de la tâche $N+1$.
- Dès qu'une tâche se termine, elle nettoie sa clé dans `accessMap` si aucune nouvelle tâche n'a été chaînée après elle.

### Niveau 2 : Régulation Globale Adaptative de la Charge (Throttling)
Avant d'exécuter la tâche réelle, `_executeWithThrottling` interroge la capacité maximale calculée dynamiquement selon les ressources matérielles disponibles de l'hôte.

```
 [Nouveau Message] ──► dispatch(jid, msg, taskFactory)
                             │
       ┌─────────────────────┴─────────────────────┐
       ▼                                           ▼
[Chaînage Local sur JID]                 [Vérification Priorité]
Attend que la tâche locale              Commandes système (!ping, !stop)
précédente se termine                   court-circuitent la file globale
       │                                           │
       └─────────────────────┬─────────────────────┘
                             │
                             ▼
              [Régulation Globale Throttling]
               ActiveThreads < MaxConcurrency ?
                     /               \
                   OUI               NON
                   /                   \
                  ▼                     ▼
          [Exécution Tâche]     [Mise en file d'attente]
          (activeThreads++)     (globalQueue.push)
                  │                     ▲
                  ▼                     │ Libère un slot
          [Fin d'Exécution] ────────────┘ (activeThreads--)
```

## 3. Choix de Conception & Raisons d'Ingénierie

1. **Formulation Mathématique de la Capacité Maximale ($C_{\max}$)** :
   La capacité globale de traitement simultané est recalculée dynamiquement :
   $$C_{\max} = \max\left(2, \; \min\left(\left\lfloor \frac{\text{RAM}_{\text{libre}}(\text{Mo})}{250} \right\rfloor, \; N_{\text{CPU}} \times 3, \; 50\right)\right)$$
   - $\text{RAM}_{\text{libre}} / 250$ : Réserve un budget nominal de 250 Mo par fil d'exécution de travailleur.
   - $N_{\text{CPU}} \times 3$ : Évite la saturation du pool de threads I/O de libuv.
   - $\max(2, \dots)$ : Garantit que le système ne se bloque jamais totalement même en condition de mémoire basse.
   - Plafond dur à 50 : Préserve la réactivité globale de l'interpréteur V8.
2. **Voie Prioritaire (System Priority Bypass)** :
   - *Raison* : Les commandes de contrôle vitales (`!ping`, `!stop`, `!menu`, `!help`, `!info`) sont détectées via regex et admises immédiatement sans passer par la file d'attente globale saturée.
3. **Auto-Nettoyage Idempotent des Verrous** :
   - *Raison* : Le nettoyage `if (this.accessMap.get(jid) === currentTask) this.accessMap.delete(jid)` dans le bloc `finally` élimine tout risque de fuite de mémoire sans race condition.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **P-Limit / Async-Queue globale** | Contrôle strict du parallélisme global. | Ne garantit pas l'ordre FIFO par conversation (`jid`), entraînant des collisions de messages. |
| **Worker Threads Node.js (`piscina`)** | Vraie parallélisation multi-cœurs. | Sérialisation lourde des données de contexte et du conteneur IoC, latence élevée de communication IPC. |
| **Mutex Distribué (Redlock / Redis)** | Synchronisation inter-instances. | Dépendance réseau externe, latence réseau superflue pour un démon autonome mono-processus. |

## 5. Frontières Architecturales & Invariants

- **Dans le périmètre de `SwarmDispatcher`** :
  - Sérialisation déterministe des tâches par `jid`.
  - Calcul dynamique de la capacité d'admission CPU/RAM.
  - Gestion de la file d'attente globale de délestage.
  - Télémétrie en temps réel (`activeThreads`, `queuedTasks`, `totalProcessed`, `errors`).
- **Exclu du périmètre** :
  - Logique d'analyse sémantique du message (en dehors de la détection de regex des commandes prioritaires).
  - Gestion des reprises sur erreur applicative du LLM.

## 6. Liens & Navigation

- **Référence Technique :** [`swarm-dispatcher-reference.md`](./swarm-dispatcher-reference.md)
- **Guide Pratique d'Intégration :** [`swarm-dispatcher-howto.md`](./swarm-dispatcher-howto.md)
- **Index du Domaine Core :** [`index.md`](./index.md)
