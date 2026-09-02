# Comment Réguler la Concurrence et Sérialiser les Messages avec SwarmDispatcher

Ce guide pratique décrit comment utiliser `SwarmDispatcher` pour exécuter des traitements asynchrones tout en garantissant que les messages d'un même contact sont exécutés séquentiellement et que la machine hôte ne subit pas de saturation matérielle.

## Prérequis
- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendances du projet installées (`npm install`).

## Étapes de Réalisation

### 1. Importer l'instance singleton de `SwarmDispatcher`

Dans votre module de traitement ou gestionnaire de passerelle :

```typescript
import swarmDispatcher from '../../src/core/concurrency/SwarmDispatcher.js';
```

### 2. Encapsuler le traitement du message dans une fonction de fabrique

Définissez votre logique d'inférence ou de traitement sous la forme d'une fonction asynchrone sans paramètre (`() => Promise<T>`) :

```typescript
interface IncomingMessage {
  id: string;
  senderJid: string;
  text: string;
}

async function handleIncomingMessage(msg: IncomingMessage): Promise<string> {
  const taskFactory = async (): Promise<string> => {
    console.log(`[Processor] Début traitement pour ${msg.senderJid} (ID: ${msg.id})`);
    
    // Simulation d'une inférence ou d'un appel d'outil
    await new Promise((resolve) => setTimeout(resolve, 200));
    
    return `Réponse générée pour le message : "${msg.text}"`;
  };

  // Dispatch de la tâche
  const response = (await swarmDispatcher.dispatch(
    msg.senderJid,
    msg,
    taskFactory
  )) as string;

  return response;
}
```

### 3. Consulter les métriques de concurrence pour le monitoring

Pour afficher la charge active et les files d'attente du régulateur :

```typescript
function printDispatcherStatus(): void {
  const metrics = swarmDispatcher.getMetrics();
  console.log(
    `[Swarm Status] Threads actifs: ${metrics.activeThreads}/${metrics.maxConcurrency} | En attente: ${metrics.queuedTasks} | JIDs actifs: ${metrics.activeJids}`
  );
}
```

## Cas Particuliers & Variantes

### Variante A : Émission d'une commande d'urgence prioritaire

Pour forcer le traitement immédiat d'une commande sans attendre les tâches en file d'attente :

```typescript
const emergencyMsg = { text: '!stop' };

await swarmDispatcher.dispatch('admin@s.whatsapp.net', emergencyMsg, async () => {
  console.log('[Swarm] Arrêt immédiat de la tâche en cours.');
});
```

## Vérification & Validation

Exécutez la suite de tests unitaires dédiée au `SwarmDispatcher` :

```bash
npx jest src/tests/unit/core/SwarmDispatcher.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/core/SwarmDispatcher.test.ts
  SwarmDispatcher
    ✓ should serialize tasks for the same JID (240 ms)
    ✓ should run tasks for different JIDs concurrently (120 ms)
    ✓ should bypass global throttling on priority commands (15 ms)
    ✓ should recover and continue chain after task failure (18 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        1.320 s
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `[Swarm] 🟠 Throttling Task ...` en boucle continue | La mémoire vive disponible de la machine est basse, réduisant `maxConcurrency` à 2. | Libérer de la mémoire sur l'hôte ou vérifier les processus orphelins en arrière-plan. |
| Une tâche bloque indéfiniment les messages suivants du même JID | La fabrique `taskFactory` a retourné une promesse qui ne se résout ni ne se rejette jamais. | Ajouter systématiquement un `AbortSignal` ou un timeout explicite (`Promise.race`) dans vos tâches asynchrones. |
| `[Swarm] ❌ Error Task [jid:taskId]` | Exception non capturée dans la fabrique de tâche. | Le `SwarmDispatcher` préserve le chaînage mais l'appelant doit entourer l'appel à `dispatch()` d'un bloc `try / catch`. |
