# Comment Ordonnancer Équitablement des Messages Multi-Canaux avec FairnessQueue

Ce guide pratique détaille la procédure pour intégrer, alimenter et consommer la file d'attente `FairnessQueue` afin de garantir une répartition équitable des messages entrants et de prioriser les commandes d'administration.

## Prérequis
- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendances du projet installées (`npm install`).

## Étapes de Réalisation

### 1. Importer et instancier la file d'attente

Dans votre module de traitement d'événements (par exemple un récepteur de passerelle de transport ou un orchestrateur) :

```typescript
import { FairnessQueue } from '../../src/core/FairnessQueue.js';

interface QueueEvent {
  readonly chatId: string;
  readonly timestamp?: number;
  [key: string]: unknown;
}

const fairnessQueue = new FairnessQueue();
```

### 2. Enfiler les événements entrants par canal (`chatId`)

Lors de la réception d'un nouveau message, enfilez-le en précisant l'identifiant du canal. Si l'émetteur est administrateur, activez le drapeau prioritaire `isPremium` :

```typescript
function onMessageReceived(chatId: string, payload: unknown, isAdmin: boolean = false): void {
  const event: QueueEvent = {
    chatId,
    timestamp: Date.now(),
    payload,
  };

  fairnessQueue.enqueue(chatId, event, isAdmin);
  console.log(`[Queue] Message enfilé pour ${chatId}. Taille totale: ${fairnessQueue.size}`);
}
```

### 3. Dépiler et exécuter dans la boucle de traitement principale

Dans votre boucle d'orchestration asynchrone, dépilez les événements les uns après les autres :

```typescript
async function processQueueLoop(): Promise<void> {
  while (true) {
    const event = fairnessQueue.dequeue();

    if (!event) {
      // Pause courte lorsque la file est vide
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }

    try {
      console.log(`[Worker] Traitement de l'événement pour le canal ${event.chatId}`);
      await handleEvent(event);
    } catch (error) {
      console.error(`[Worker] Erreur lors du traitement pour ${event.chatId}:`, error);
    }
  }
}

async function handleEvent(event: QueueEvent): Promise<void> {
  // Logique de traitement du message
}
```

## Cas Particuliers & Variantes

### Variante A : Inspection des métriques de charge en temps réel

Pour surveiller l'état de saturation des canaux :

```typescript
function logQueueHealth(): void {
  console.log({
    totalQueuedEvents: fairnessQueue.size,
    distinctActiveChats: fairnessQueue.activeChats,
  });
}
```

## Vérification & Validation

Exécutez la suite de tests unitaires dédiée à la `FairnessQueue` :

```bash
npx jest src/tests/unit/core/FairnessQueue.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/core/FairnessQueue.test.ts
  FairnessQueue
    ✓ should enqueue and dequeue events in round-robin order (15 ms)
    ✓ should prioritize premium events with unshift (8 ms)
    ✓ should clean up empty chat queues dynamically (6 ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Snapshots:   0 total
Time:        1.102 s
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `dequeue()` retourne toujours `null` malgré l'appel à `enqueue()` | L'objet `event` passé à `enqueue()` ne contenait pas de propriété `chatId` valide. | S'assurer que le premier argument et `event.chatId` correspondent bien à un identifiant non vide. |
| Un canal actif ne reçoit aucun cycle de traitement | La boucle de consommation n'invoque pas `dequeue()` ou subit un blocage synchrone dans `handleEvent`. | Rendre le traitement de chaque événement strictement asynchrone et vérifier la temporisation de boucle. |
