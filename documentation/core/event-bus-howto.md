# Comment Écouter et Émettre des Événements avec EventBus

Ce guide pratique décrit comment s'abonner aux événements du cycle de vie du bot, publier des signaux personnalisés entre modules et nettoyer correctement les écouteurs pour éviter les fuites de mémoire.

## Prérequis
- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendances du projet installées (`npm install`).

## Étapes de Réalisation

### 1. Importer `eventBus` et la constante `BotEvents`

Dans votre module consommateur ou plugin :

```typescript
import { eventBus, BotEvents } from '../../src/core/events.js';
```

### 2. Écouter un événement du cycle de vie

Déclarez une fonction de gestionnaire et abonnez-la à l'un des 23 événements prédéfinis :

```typescript
interface AIResponsePayload {
  chatId: string;
  model: string;
  durationMs: number;
  tokensUsed: number;
}

function handleAIResponse(payload: AIResponsePayload): void {
  console.log(
    `[Monitoring] Inférence terminée pour ${payload.chatId} via ${payload.model} en ${payload.durationMs}ms.`
  );
}

// Abonnement permanent
eventBus.subscribe(BotEvents.AI_RESPONSE, handleAIResponse);
```

### 3. Publier un événement depuis un module producteur

Lorsqu'une opération significative s'achève dans votre service :

```typescript
function notifyToolExecution(toolName: string, success: boolean, durationMs: number): void {
  eventBus.publish(BotEvents.PLUGIN_EXECUTED, {
    toolName,
    success,
    durationMs,
    timestamp: Date.now(),
  });
}
```

### 4. Désabonner l'écouteur lors de la destruction du module

Pour prévenir les fuites de mémoire lors du déchargement d'un plugin ou à la fermeture d'une session :

```typescript
function cleanup(): void {
  eventBus.unsubscribe(BotEvents.AI_RESPONSE, handleAIResponse);
  console.log('[Cleanup] Écouteurs désabonnés.');
}
```

## Cas Particuliers & Variantes

### Variante A : Écoute ponctuelle d'un événement unique

Pour attendre une seule notification (par exemple la connexion initiale) sans avoir à gérer le désabonnement manuel :

```typescript
eventBus.subscribeOnce(BotEvents.CONNECTED, (connectionData) => {
  console.log('[Init] Connexion établie avec succès :', connectionData);
});
```

## Vérification & Validation

Exécutez la suite de tests unitaires dédiée au bus d'événements :

```bash
npx jest src/tests/unit/core/eventBus.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/core/eventBus.test.ts
  EventBus
    ✓ should publish and trigger subscribed handlers (12 ms)
    ✓ should handle subscribeOnce correctly (6 ms)
    ✓ should unsubscribe handler successfully (4 ms)
    ✓ should support custom event strings (3 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        0.985 s
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `MaxListenersExceededWarning: Possible EventEmitter memory leak detected` | Plus de 50 écouteurs ont été abonnés sur le même événement sans être désabonnés. | Vérifier que les fonctions de rappel sont bien désabonnées via `unsubscribe` ou utiliser `subscribeOnce`. |
| Un gestionnaire d'événement n'est jamais appelé lors du `publish` | Faute de frappe dans le nom de l'événement ou écouteur enregistré après l'émission. | Toujours utiliser les constantes typées `BotEvents.*` et s'assurer que `subscribe()` précède `publish()`. |
| Le processus plante lors de la publication d'un événement | Une exception synchrone a été levée à l'intérieur de la fonction `handler` d'un écouteur. | Encapsuler la logique interne des gestionnaires d'événements dans des blocs `try / catch`. |
