# Comment Instancier et Déléguer une Sous-Tâche avec SubAgentEngine

Ce guide pratique détaille la démarche pour déléguer une tâche complexe à un sous-agent autonome éphémère doté d'outils restreints et récupérer son rapport consolidé.

## Prérequis
- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendances du projet installées (`npm install`).
- Plugins d'outils requis initialisés via `pluginLoader`.

## Étapes de Réalisation

### 1. Configurer les paramètres du sous-agent

Définissez le nom, le prompt système spécialisé et la liste blanche des outils nécessaires :

```typescript
import { SubAgentEngine, type SubAgentConfig } from '../../src/services/agentic/SubAgentEngine.js';

const agentConfig: SubAgentConfig = {
  name: 'SecurityAuditor',
  systemPrompt:
    'Tu es un expert en cybersécurité. Ton rôle est d’analyser les vulnérabilités de code sans jamais modifier les fichiers.',
  allowedTools: ['read_file', 'ast_query', 'line_hashing_read'],
  maxIterations: 5,
};
```

### 2. Instancier le moteur de sous-agent

Créez l'instance de `SubAgentEngine` :

```typescript
const securitySubAgent = new SubAgentEngine(agentConfig);
```

### 3. Exécuter la mission avec transmission des contraintes parentales

Lancez l'exécution de la mission en fournissant le contexte du blueprint parent :

```typescript
async function runSecurityAudit(targetDirectory: string): Promise<string> {
  const missionPrompt = `Audite tous les fichiers TypeScript dans ${targetDirectory} pour détecter d'éventuelles injections SQL ou appels eval().`;

  const context = {
    blueprint: {
      metadata: { id: 'parent_agent', name: 'HiveMain', version: '1.0.0' },
      mindos: { drives: ['safety'] },
      action_space: { allowed_tools: ['*'] },
      constraints: {
        read_only_fs: true, // Imposé au sous-agent
        max_budget_usd: 0.1,
        max_iterations: 10,
      },
    },
  };

  const result = await securitySubAgent.run(missionPrompt, context);

  if (!result.success) {
    console.warn('[SubAgent] Mission terminée avec des avertissements.');
  }

  return result.message;
}
```

### 4. Intégrer le rapport dans la réponse principale

Injectez le rapport Markdown retourné par le sous-agent dans votre logique de synthèse :

```typescript
const auditReport = await runSecurityAudit('src/core/security');
console.log('--- RAPPORT DE SOUS-AGENT ---');
console.log(auditReport);
```

## Cas Particuliers & Variantes

### Variante A : Délégation dynamique via l'outil `spawn_sub_agent`

Si vous utilisez le LLM pour décider quand déléguer une sous-tâche :

```typescript
import spawnSubAgentTool from '../../src/plugins/base/dev_tools/SpawnSubAgentTool.js';

// Invocation programmatique de l'outil
const toolResult = await spawnSubAgentTool.execute(
  {
    name: 'CodeReviewer',
    persona: 'Tu es un réviseur de code expérimenté.',
    tools: ['read_file', 'ast_query'],
    mission: 'Analyser les fichiers modifiés.',
    mode: 'fresh',
  },
  {},
  'spawn_sub_agent',
);
```

## Vérification & Validation

Exécutez la suite de tests unitaires dédiée au `SubAgentEngine` :

```bash
npx jest src/tests/unit/services/SubAgentEngine.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/services/SubAgentEngine.test.ts
  SubAgentEngine
    ✓ should initialize ephemeral blueprint in RAM (22 ms)
    ✓ should enforce allowedTools whitelist strictly (35 ms)
    ✓ should strip thinking tags from final report (15 ms)
    ✓ should clean up RAM blueprint on finish (12 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        1.450 s
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| Le sous-agent tente d'exécuter un outil et échoue immédiatement | L'outil invoqué ne fait pas partie du tableau `allowedTools` configuré dans `SubAgentConfig`. | Ajouter le nom exact de l'outil dans la liste blanche `allowedTools` si la sécurité le permet. |
| Le rapport final contient des balises `<think>...</think>` non désirées | Le modèle de langage a utilisé un format non standard de réflexion interne. | `SubAgentEngine` applique une regex de nettoyage ; vérifier que les sorties ne sont pas altérées en amont. |
| Le sous-agent s'arrête avant d'avoir trouvé la solution | Le plafond `maxIterations` (défaut: 10) est trop bas pour la complexité de la mission. | Augmenter `maxIterations` dans `SubAgentConfig` sans excéder les limites raisonnables de coût. |
