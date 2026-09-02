# Comment Enregistrer et Résoudre un Nouveau Service dans ServiceContainer

Ce guide pratique décrit la procédure pas-à-pas pour déclarer, enregistrer et consommer un nouveau service applicatif dans le conteneur IoC de HIVE-MIND, ainsi que pour substituer un service par une doublure de test (*mock*).

## Prérequis
- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendances du projet installées (`npm install`).
- Fichiers de configuration de base présents (`src/config/credentials.json` et `src/config/models_config.json`).

## Étapes de Réalisation

### 1. Déclarer la classe du nouveau service

Créez votre classe de service dans le répertoire approprié (par exemple `src/services/custom/MetricsService.ts`) en implémentant optionnellement `setContainer` si l'accès à d'autres services est requis :

```typescript
import type { ServiceContainer } from '../../core/ServiceContainer.js';

export class MetricsService {
  private container?: ServiceContainer;

  public setContainer(container: ServiceContainer): void {
    this.container = container;
  }

  public recordMetric(metricName: string, value: number): void {
    console.log(`[Metrics] ${metricName} = ${value}`);
  }
}
```

### 2. Étendre l'interface TypeScript `ServiceRegistry`

Ouvrez `src/core/ServiceContainer.ts` et ajoutez la clé typée correspondante dans l'interface `ServiceRegistry` :

```typescript
export interface ServiceRegistry {
  // ... services existants ...
  metricsService: InstanceType<typeof import('../services/custom/MetricsService.js').MetricsService>;
}
```

### 3. Enregistrer le service dans le conteneur

Enregistrez la fabrique de votre service en spécifiant si l'instance doit être conservée sous forme de singleton :

```typescript
import { container } from '../../src/core/container.js';
import { MetricsService } from '../../src/services/custom/MetricsService.js';

// Enregistrement avec mise en cache singleton
container.register('metricsService', () => new MetricsService(), { singleton: true });
```

### 4. Résoudre et utiliser le service

Dans votre module consommateur ou orchestrateur, résolvez l'instance via la méthode `get()` :

```typescript
import { container } from '../../src/core/container.js';

const metrics = container.get('metricsService');
metrics.recordMetric('agent_memory_usage_mb', 128);
```

## Cas Particuliers & Variantes

### Variante A : Substitution par un Mock dans les tests unitaires

Pour injecter une implémentation simulée lors d'un test Jest :

```typescript
import { container } from '../../../src/core/container.js';

const mockMetrics = {
  recordMetric: jest.fn(),
};

// Remplacement dynamique avant l'exécution du test
container.register('metricsService', () => mockMetrics, { singleton: true });

const resolved = container.get('metricsService');
resolved.recordMetric('test_run', 1);
expect(mockMetrics.recordMetric).toHaveBeenCalledWith('test_run', 1);
```

## Vérification & Validation

Exécutez la suite de tests unitaires dédiée au `ServiceContainer` pour valider l'enregistrement et la résolution :

```bash
npx jest src/tests/unit/core/ServiceContainer.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/core/ServiceContainer.test.ts
  ServiceContainer
    ✓ should initialize with minimal mode (45 ms)
    ✓ should register and resolve singletons (12 ms)
    ✓ should throw error when resolving unregistered service (4 ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Snapshots:   0 total
Time:        1.245 s
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `Error: [ServiceContainer] Service non trouvé: <name>` | Le service est demandé via `container.get()` avant d'avoir été enregistré via `container.register()`. | Vérifier que l'enregistrement a bien eu lieu lors de la phase d'amorçage ou appeler `container.init()`. |
| `TypeError: container.get(...) is not a function` | La fabrique enregistrée a retourné `undefined` ou n'a pas été enveloppée dans une fonction `() => new Service()`. | S'assurer que le deuxième argument passé à `register()` est bien une instance valide ou une fonction fabrique. |
| `Warning: Service <name> déjà enregistré - remplacement` | Deux modules enregistrent le même nom de service avec des fabriques concurrentes. | Harmoniser l'enregistrement dans un point d'initialisation unique ou vérifier les doublons d'appels. |
