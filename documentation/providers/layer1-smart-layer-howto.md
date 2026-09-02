# Comment Configurer le Routage Intelligent et le Circuit Breaker de Layer 1

Ce guide pratique explique comment consommer le routeur de haut niveau **Layer 1 SmartLayer**, configurer des recettes logiques de services avec des chaînes de repli (*fallback chains*), et tester la résilience du disjoncteur face aux pannes distantes.

## Prérequis

- Node.js $\ge 22.0.0$ (ESM natif) et TypeScript configuré.
- Fichiers `src/config/models_config.json` et `src/config/services_config.json` initialisés.
- Variables d'environnement configurées pour au moins deux fournisseurs (ex. `OPENAI_API_KEY` et `ANTHROPIC_API_KEY`) pour permettre le basculement automatique.

## Étapes de Réalisation

### 1. Déclarer une recette logique dans `services_config.json`

Ouvrez ou créez `src/config/services_config.json` et définissez une chaîne de repli ordonnée sous `service_recipes` :

```json
{
  "reliability_defaults": {
    "max_attempts": 4,
    "deadline_ms": 120000,
    "per_attempt_timeout_ms": 45000,
    "minimum_throughput": 3,
    "failure_ratio_threshold": 0.5
  },
  "service_recipes": {
    "CODE_ASSISTANT": {
      "model": "claude-3-7-sonnet-latest",
      "fallback": "gpt-4o",
      "fallback_2": "deepseek-chat",
      "temperature": 0.2
    }
  }
}
```

### 2. Exécuter une requête résiliente via `SmartLayer`

Instanciez ou importez `smartLayer` et transmettez le nom de la recette logique dans `serviceOrCategory` :

```typescript
import { smartLayer, type SmartExecutionRequest } from '../../src/providers/layer1/SmartLayer.js';

async function executeTask() {
  const request: SmartExecutionRequest = {
    serviceOrCategory: 'CODE_ASSISTANT',
    messages: [
      {
        role: 'system',
        content: 'Tu es un ingénieur expert en TypeScript.',
      },
      {
        role: 'user',
        content: 'Écris un type utilitaire StrictOmit<T, K>.',
      },
    ],
  };

  try {
    const response = await smartLayer.execute(request, {
      maxAttempts: 3,
      deadlineMs: 45000,
    });

    console.log(`[Succès] Réponse obtenue via : ${response.usedModel} (Tentatives : ${response.attemptsCount})`);
    console.log(response.result.content);
  } catch (error) {
    console.error('[Échec critique] Tous les modèles de la cascade ont échoué :', (error as Error).message);
  }
}
```

### 3. Exécuter un streaming avec protection Stream Lock

Pour diffuser la réponse en temps réel tout en bénéficiant de la cascade initiale (avant l'émission du premier token) :

```typescript
import { smartLayer } from '../../src/providers/layer1/SmartLayer.js';

async function streamTask() {
  const stream = smartLayer.executeStream({
    serviceOrCategory: 'CODE_ASSISTANT',
    messages: [{ role: 'user', content: 'Génère un composant React complet.' }],
  });

  try {
    for await (const chunk of stream) {
      if (chunk.content) {
        process.stdout.write(chunk.content);
      }
    }
    console.log('\n[Stream terminé]');
  } catch (err) {
    console.error('\n[Erreur Stream] Interruption :', (err as Error).message);
  }
}
```

### 4. Simuler et tester manuellement l'ouverture du Circuit Breaker

Pour valider le comportement du disjoncteur dans un scénario de test :

```typescript
import { ModelHealthRegistry } from '../../src/providers/layer1/ModelHealthRegistry.js';
import { ServerError } from '../../src/providers/layer0/errors.js';

const healthRegistry = ModelHealthRegistry.getInstance();

// 1. Simuler 3 pannes successives sur gpt-4o
healthRegistry.recordFailure('gpt-4o', new ServerError('Service 500'));
healthRegistry.recordFailure('gpt-4o', new ServerError('Service 500'));
healthRegistry.recordFailure('gpt-4o', new ServerError('Service 500'));

// 2. Vérifier l'état du disjoncteur
const isOpen = healthRegistry.isCircuitOpen('gpt-4o');
console.log('Disjoncteur gpt-4o ouvert ?', isOpen); // true

// 3. Constater que SmartLayer écarte gpt-4o et bascule directement sur le fallback
```

## Cas Particuliers & Variantes

### Variante A : Ciblage direct d'un modèle spécifique
Si vous souhaitez interroger un modèle précis sans passer par une recette nommée, passez directement son identifiant :

```typescript
const result = await smartLayer.execute({
  modelId: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Ping' }],
});
```

### Variante B : Forcer un signal d'interruption global
Pour lier la cascade à un signal d'annulation (ex. timeout global de l'agent) :

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(new Error('Temps imparti écoulé')), 20000);

const result = await smartLayer.execute(request, { signal: controller.signal });
```

## Vérification & Validation

Exécutez la suite de tests unitaires dédiée à Layer 1 :

```bash
NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=dummy REDIS_URL=redis://localhost:6379 NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest src/tests/unit/providers/layer1.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/providers/layer1.test.ts
  Layer 1 - ModelHealthRegistry & Circuit Breaker
    ✓ opens circuit when failure ratio exceeds 50% with throughput >= 3
    ✓ acquires single-flight probe in HALF_OPEN state
    ✓ escalates family circuit breaker when 2 models in family experience infrastructure failure
    ✓ calculates P50 latency and sorts candidate models by preference score
  Layer 1 - ServiceRegistry
    ✓ resolves service recipes from services_config.json
    ✓ resolves chat category recipes and reliability defaults
  Layer 1 - CredentialProvider
    ✓ resolves healthy API keys via QuotaManager and round-robin
    ✓ records quota exceeded events
  Layer 1 - SmartLayer Cascade & Stream Lock
    ✓ executes primary model successfully
    ✓ cascades to fallback model on primary failure
    ✓ halts fallback cascade once stream has started (__streamStarted lock)

Test Suites: 1 passed, 1 total
Tests:       18 passed, 1 total
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `SmartLayer: Request for "XYZ" failed after 4 attempts` | Tous les modèles déclarés dans la recette ont échoué ou ont leurs disjoncteurs ouverts. | Vérifier la connectivité réseau, la validité des clés d'API et ajouter des modèles de repli tiers dans `services_config.json`. |
| `Error: [__streamStarted: true]` | Une coupure réseau ou une erreur distante est survenue en cours de diffusion SSE. | Normal (protection anti-corruption) : redémarrer la tâche ou inviter l'utilisateur à reformuler. |
| `ServiceRecipeNotFound` ou repli sur modèle par défaut | La recette demandée n'est pas déclarée dans `services_config.json`. | Vérifier l'orthographe de `serviceOrCategory` ou déclarer la recette sous `service_recipes`. |
