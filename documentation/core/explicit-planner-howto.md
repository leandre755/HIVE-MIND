# Comment Planifier et Exécuter une Tâche Complexe avec ExplicitPlanner

Ce guide pratique détaille la méthode pour générer un plan multi-étapes en graphe DAG, configurer l'interpolation dynamique de variables et exécuter la séquence avec gestion des erreurs et replanification.

## Prérequis
- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendances du projet installées (`npm install`).
- Clés d'API IA configurées pour le routeur de modèles.

## Étapes de Réalisation

### 1. Importer `planner` et définir les outils disponibles

Dans votre orchestrateur ou gestionnaire de tâches :

```typescript
import { planner, type ToolInfo } from '../../src/services/agentic/Planner.js';

const availableTools: ToolInfo[] = [
  {
    name: 'fetch_stock_data',
    description: 'Récupère les données boursières récentes d’un symbole',
    parameters: {
      properties: {
        symbol: { type: 'string', description: 'Symbole du ticker (ex: AAPL)' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'render_chart_report',
    description: 'Génère un graphique à partir des données fournies',
    parameters: {
      properties: {
        chartData: { type: 'string', description: 'Données JSON ou texte' },
        outputPath: { type: 'string', description: 'Chemin du fichier de sortie' },
      },
      required: ['chartData', 'outputPath'],
    },
  },
];
```

### 2. Vérifier si la requête nécessite une planification

Avant d'engager le coût de génération d'un plan complet, vérifiez la complexité :

```typescript
const userGoal = 'Télécharger l’historique d’Apple (AAPL) et générer un rapport graphique dans report.png';

const mustPlan = await planner.needsPlanning(userGoal, availableTools);

if (mustPlan) {
  console.log('[Planner] Tâche complexe détectée : génération d’un plan formel...');
}
```

### 3. Générer le plan d'étapes (DAG)

Appelez la méthode `plan()` avec l'objectif et le contexte de conversation :

```typescript
const planResult = await planner.plan(userGoal, {
  tools: availableTools,
  chatId: 'user_analytics_session_1',
});

console.log(`[Planner] Plan ID: ${planResult.id} (${planResult.steps.length} étapes)`);
planResult.steps.forEach((step) => {
  console.log(`  - Étape ${step.id} : ${step.action} [Outil: ${step.tool}] (Dépend de: ${step.depends_on.join(', ') || 'aucune'})`);
});
```

### 4. Exécuter le plan avec interpolation dynamique

Exécutez le plan en fournissant les fonctions concrètes des outils :

```typescript
const executionContext = {
  chatId: 'user_analytics_session_1',
  message: { role: 'user', content: userGoal },
  tools: availableTools,
  executeToolFn: async (
    toolCall: { id: string; function: { name: string; arguments: string } },
    _msg: unknown,
  ) => {
    console.log(`[Tool] Exécution de ${toolCall.function.name}...`);
    const args = JSON.parse(toolCall.function.arguments || '{}');
    if (toolCall.function.name === 'fetch_stock_data') {
      return { status: 'ok', prices: [150, 155, 160], symbol: args.symbol };
    }
    if (toolCall.function.name === 'render_chart_report') {
      return { success: true, file: args.outputPath };
    }
    return { error: true, message: `Outil inconnu : ${toolCall.function.name}` };
  },
};

const executionLog = await planner.execute(planResult, executionContext);
const reviewResult = await planner.review(executionLog);

console.log('[Planner] Bilan d’exécution :', {
  succès: reviewResult.success,
  tauxSuccès: `${reviewResult.successRate * 100}%`,
  étapesComplétées: `${reviewResult.completed}/${reviewResult.totalSteps}`,
  duréeMs: reviewResult.duration,
});
```

## Cas Particuliers & Variantes

### Variante A : Utilisation de balises d'interpolation personnalisées

Dans la définition des étapes d'un plan, vous pouvez spécifier des références croisées que `ExplicitPlanner` résoudra automatiquement :

```typescript
// Exemple de paramètre d'étape dépendant de l'étape 1 :
const stepParams = {
  chartData: '{{step_1_result}}',
  outputPath: 'Sandbox1/report_{{symbol_from_step_1}}.png',
};
```

## Vérification & Validation

Exécutez la suite de tests unitaires dédiée au planificateur :

```bash
npx jest src/tests/unit/services/Planner.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/services/Planner.test.ts
  ExplicitPlanner
    ✓ should accurately assess if task needs planning (28 ms)
    ✓ should generate structured DAG plan from goal (120 ms)
    ✓ should execute plan with variable interpolation (85 ms)
    ✓ should trigger replanning on tool failure (95 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        1.640 s
```

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `[Planner] Replanning failed after 5 attempts` | L'outil requis rencontre une erreur fatale systématique ou les paramètres sont structurellement incompatibles. | Vérifier la signature et les identifiants d'API de l'outil défaillant dans `tools`. |
| La variable `{{step_1_result}}` reste brute dans la chaîne | L'étape 1 n'a pas produit d'objet JSON ou son résultat était `undefined`. | S'assurer que la fonction de l'étape 1 retourne une valeur sérialisable non vide. |
| `Error: Tool not found: <toolName>` | Le plan généré utilise un outil qui n'a pas été fourni dans le tableau `context.tools`. | Déclarer explicitement l'ensemble des outils dans l'objet d'exécution passé à `execute`. |
