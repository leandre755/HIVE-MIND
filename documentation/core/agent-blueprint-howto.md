# Comment Créer et Enregistrer un Profil d'Agent avec AgentBlueprint

Ce guide pratique détaille la démarche pour concevoir un nouveau profil d'agent statique au format JSON, ainsi que pour enregistrer dynamiquement un sous-agent éphémère en mémoire vive avec des contraintes strictes.

## Prérequis
- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendances du projet installées (`npm install`).

## Étapes de Réalisation

### 1. Créer un fichier de blueprint statique sur disque

Pour un profil permanent disponible au démarrage, créez un fichier JSON dans le répertoire `src/config/blueprints/` (par exemple `src/config/blueprints/sql_expert.json`) :

```json
{
  "metadata": {
    "id": "sql_expert",
    "name": "Expert SQL & Optimisation Base de Données",
    "version": "1.0.0"
  },
  "mindos": {
    "drives": ["query_efficiency", "data_integrity", "least_privilege"]
  },
  "action_space": {
    "allowed_tools": [
      "read_file",
      "supabase_query_readonly",
      "explain_query_plan"
    ]
  },
  "constraints": {
    "read_only_fs": true,
    "max_budget_usd": 0.5,
    "max_iterations": 8
  }
}
```

### 2. Charger et valider le profil dans l'application

Dans votre module de service ou contrôleur d'agent :

```typescript
import { blueprintManager } from '../../src/core/blueprint/AgentBlueprint.js';

// Chargement et validation automatique via Zod
const sqlBlueprint = blueprintManager.loadBlueprint('sql_expert');

console.log(`[Agent] Profil chargé : ${sqlBlueprint.metadata.name}`);
console.log(`[Agent] Budget max : $${sqlBlueprint.constraints.max_budget_usd}`);
```

### 3. Enregistrer dynamiquement un sous-agent éphémère en RAM

Lorsque l'agent principal décide de déléguer une sous-tâche avec des permissions réduites :

```typescript
import { blueprintManager } from '../../src/core/blueprint/AgentBlueprint.js';

const ephemeralBlueprintData = {
  metadata: {
    id: `temp_crawler_${Date.now()}`,
    name: 'WebCrawlerWorker',
    version: '1.0.0',
  },
  mindos: {
    drives: ['thoroughness'],
  },
  action_space: {
    allowed_tools: ['duckduck_search', 'firecrawl_scrape'],
  },
  constraints: {
    read_only_fs: true,
    max_budget_usd: 0.05,
    max_iterations: 4,
  },
};

// Enregistrement immédiat dans la RAM
const blueprintId = blueprintManager.registerEphemeral(ephemeralBlueprintData);

try {
  const activeBlueprint = blueprintManager.loadBlueprint(blueprintId);
  // Exécution de la tâche avec ce profil...
} finally {
  // 4. Nettoyage obligatoire en fin de mission
  blueprintManager.cleanupEphemeral(blueprintId);
}
```

## Cas Particuliers & Variantes

### Variante A : Vérification préalable de la conformité d'un profil

Pour tester si un objet est conforme avant tout enregistrement :

```typescript
import { AgenticFormatSchema } from '../../src/core/blueprint/AgentBlueprint.js';

const parseResult = AgenticFormatSchema.safeParse(candidateData);
if (!parseResult.success) {
  console.error('Erreurs de validation :', parseResult.error.format());
}
```

## Vérification & Validation

Exécutez la suite de tests unitaires dédiée à `AgentBlueprint` :

```bash
npx jest src/tests/unit/blueprint/AgentBlueprint.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/blueprint/AgentBlueprint.test.ts
  AgentBlueprint & BlueprintManager
    ✓ should load valid blueprint from disk (18 ms)
    ✓ should throw when blueprint file does not exist (4 ms)
    ✓ should register and resolve ephemeral blueprints in RAM (5 ms)
    ✓ should cleanup ephemeral blueprints (3 ms)
    ✓ should reject invalid blueprint schemas (6 ms)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
Time:        1.189 s
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `Error: [BlueprintManager] Blueprint file not found on disk` | Le fichier JSON n'existe pas dans `src/config/blueprints/` ou le nom de fichier ne correspond pas exactement à `${id}.json`. | Vérifier l'orthographe du fichier et s'assurer qu'il est situé dans `src/config/blueprints/`. |
| `Error: [BlueprintManager] Ephemeral schema validation failed` | Une propriété obligatoire manque (ex: `action_space.allowed_tools` ou `metadata.id`). | Vérifier les clés de l'objet par rapport au schéma Zod `AgenticFormatSchema`. |
| Les outils autorisés ne sont pas respectés lors de l'exécution | Le blueprint a été chargé mais les outils n'ont pas été transmis au validateur d'outils. | S'assurer de passer `blueprint.action_space.allowed_tools` à la configuration de la boucle ReAct. |
