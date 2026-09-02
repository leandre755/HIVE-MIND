# Comment Exécuter des Outils en Mode Programmatique avec PTC Engine

Ce guide pratique décrit comment injecter des fonctions d'outils, valider du code JavaScript généré par un LLM et l'exécuter dans le bac à sable PTC pour réduire les coûts de jetons et la latence.

## Prérequis
- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendances du projet installées (`npm install`).

## Étapes de Réalisation

### 1. Importer `ProgrammaticExecutor` et préparer les fonctions d'outils

Dans votre module de traitement d'outils ou d'orchestration :

```typescript
import { ProgrammaticExecutor } from '../../src/services/ptc/ProgrammaticExecutor.js';
import type { ToolFunction, OpenAIToolDefinition } from '../../src/services/ptc/types.js';

const executor = new ProgrammaticExecutor({
  timeoutMs: 30000,
  baseContextTokens: 7000,
});

// Déclaration de la table des fonctions asynchrones
const toolMap = new Map<string, ToolFunction>();

toolMap.set('search_database', async (args) => {
  const query = String(args.query || '');
  return { results: [`Résultat pour ${query}`], count: 1 };
});

toolMap.set('send_notification', async (args) => {
  const text = String(args.message || '');
  console.log(`[Notification envoyée] : ${text}`);
  return { delivered: true };
});
```

### 2. Générer la définition du méta-outil `code_execution` pour le LLM

Pour exposer le méta-outil au modèle avec la liste des capacités disponibles :

```typescript
const availableDefinitions: OpenAIToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_database',
      description: 'Recherche des documents dans la base de connaissances',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Terme de recherche' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_notification',
      description: 'Envoie un message de notification',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string', description: 'Contenu' } },
        required: ['message'],
      },
    },
  },
];

const codeExecutionToolDef = executor.buildCodeExecutionToolDef(availableDefinitions);
```

### 3. Exécuter le script généré dans la machine virtuelle

Lorsque le LLM invoque l'outil `code_execution` avec son bloc de code :

```typescript
const generatedScript = `
  const db1 = await search_database({ query: 'architecture' });
  const db2 = await search_database({ query: 'performance' });
  
  const allResults = [...toArray(db1.results), ...toArray(db2.results)];
  
  await send_notification({ message: \`Trouvé \${allResults.length} résultats\` });
  
  return { total: allResults.length, items: allResults };
`;

const executionResult = await executor.execute(generatedScript, toolMap);

console.log('[PTC] Résultat final :', executionResult.result);
console.log('[PTC] Métriques FinOps :', {
  outilsInvoqués: executionResult.metadata.toolCallCount,
  jetonsÉconomisés: executionResult.metadata.totalTokensSaved,
  duréeMs: executionResult.metadata.executionTimeMs,
});
```

## Cas Particuliers & Variantes

### Variante A : Utilisation de `HIVE.sleepAndWake` pour la suspension asynchrone

Pour programmer une attente longue sans bloquer le fil d'exécution :

```typescript
const wakeScript = `
  const report = await search_database({ query: 'monitoring' });
  if (report.count === 0) {
    return await HIVE.sleepAndWake(60000, 'Re-vérifier les logs de monitoring');
  }
  return report;
`;
```

## Vérification & Validation

Exécutez la suite de tests unitaires dédiée au moteur PTC :

```bash
npx jest src/tests/unit/ptc/ProgrammaticExecutor.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/ptc/ProgrammaticExecutor.test.ts
  ProgrammaticExecutor
    ✓ should execute multi-tool script in sandbox (42 ms)
    ✓ should calculate token savings correctly (12 ms)
    ✓ should block unsafe primitives like require or eval (8 ms)
    ✓ should auto-repair malformed tool call arguments (18 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        1.380 s
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `SecurityError: Access to forbidden primitive: require` | Le script généré a tenté d'importer un module Node.js directement. | Les modules système sont interdits ; exposer la fonctionnalité sous forme d'outil dans `toolMap`. |
| `TimeoutError: Script execution timed out after 30000ms` | Une boucle infinie synchrone ou une promesse jamais résolue a bloqué le sandbox. | Augmenter `timeoutMs` dans la configuration ou vérifier que les fonctions d'outils résolvent toujours leurs promesses. |
| Le script retourne `undefined` | L'instruction explicite `return` a été omise à la fin du script JavaScript. | Vérifier la règle n°2 du méta-outil : le script doit impérativement comporter une instruction `return`. |
