# ExplicitPlanner — Référence Technique

Le module `ExplicitPlanner` implémente le moteur de planification hiérarchique, d'exécution ordonnée en graphe acyclique (DAG) et de replanification autonome pour les tâches agentiques complexes de HIVE-MIND.

- **Fichier source :** `src/services/agentic/Planner.ts`
- **Dépendances :** `src/providers/index.ts`, `src/services/memory/ActionMemory.ts`, `src/utils/ResponseFormatEnforcer.ts`
- **Instance exportée :** `planner` (singleton), `ExplicitPlanner` (classe)

## 1. Interfaces & Types TypeScript

```typescript
export interface PlanStep {
  id: number;
  action: string;
  tool: string;
  params: Record<string, unknown>;
  estimated_time: number;
  depends_on: number[];
}

export interface Plan {
  steps: PlanStep[];
  total_time_estimate: number;
  complexity: 'low' | 'medium' | 'high';
}

export interface ToolInfo {
  function?: {
    name?: string;
    description?: string;
    parameters?: {
      properties?: Record<string, unknown>;
      required?: string[];
    };
  };
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface StepResult {
  error?: boolean;
  success?: boolean;
  message?: string;
  llmOutput?: unknown;
  data?: unknown;
  retries?: number;
  [key: string]: unknown;
}

export interface ReviewResult {
  success: boolean;
  successRate: number;
  totalSteps: number;
  completed: number;
  failed: number;
  duration: number;
  efficiency: number;
}

export interface PlanResult {
  id: string;
  goal: string;
  steps: PlanStep[];
  totalTime: number;
  complexity: string;
  status: string;
}
```

## 2. Classes & Signatures de Méthodes

### `ExplicitPlanner`

#### Constructeur
```typescript
constructor()
```
Initialise le planificateur avec ses extracteurs sémantiques et connecteurs au routeur de modèles.

---

#### Méthode `needsPlanning(userMessage, tools)`
```typescript
public async needsPlanning(userMessage: string, tools: ToolInfo[]): Promise<boolean>
```

Évalue par heuristique et analyse LLM si le message utilisateur justifie la création d'un plan formel structuré.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `userMessage` | `string` | Oui | — | Requête textuelle de l'utilisateur. |
| `tools` | `ToolInfo[]` | Oui | — | Liste des outils actuellement disponibles. |

**Valeur de retour :**
- `Promise<boolean>` : `true` si un plan en plusieurs étapes est nécessaire, sinon `false`.

---

#### Méthode `plan(goal, context)`
```typescript
public async plan(
  goal: string,
  context: { tools: ToolInfo[]; chatId: string }
): Promise<PlanResult>
```

Génère et valide un plan structuré sous forme de graphe DAG à partir de l'objectif utilisateur.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `goal` | `string` | Oui | — | Objectif principal de la mission. |
| `context` | `{ tools: ToolInfo[]; chatId: string }` | Oui | — | Contexte contenant les outils disponibles et l'identifiant du canal. |

**Valeur de retour :**
- `Promise<PlanResult>` : L'objet du plan généré avec sa liste d'étapes ordonnées et son estimation de complexité.

---

#### Méthode `executePlan(plan, context)`
```typescript
public async executePlan(
  plan: PlanResult,
  context: { tools: Record<string, unknown>; chatId: string; [key: string]: unknown }
): Promise<ReviewResult>
```

Exécute séquentiellement les étapes du plan en respectant les dépendances, en interpolant dynamiquement les variables et en déclenchant la replanification en cas d'échec.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `plan` | `PlanResult` | Oui | — | Plan validé à exécuter. |
| `context` | `ExecutionContext` | Oui | — | Environnement d'exécution contenant les fonctions réelles des outils. |

**Valeur de retour :**
- `Promise<ReviewResult>` : Bilan complet de l'exécution (taux de succès, durée, étapes réussies/échouées, score d'efficacité).

## 3. Modèle de Données d'une Étape (`PlanStep`)

| Propriété | Type | Description |
| :--- | :--- | :--- |
| `id` | `number` | Identifiant numérique unique de l'étape ($1, 2, \dots, N$). |
| `action` | `string` | Description en langage naturel de l'action accomplie. |
| `tool` | `string` | Nom de l'outil HIVE-MIND à invoquer. |
| `params` | `Record<string, unknown>` | Paramètres passés à l'outil (avec balises `{{...}}` optionnelles). |
| `estimated_time` | `number` | Estimation de temps d'exécution en secondes. |
| `depends_on` | `number[]` | Liste des identifiants d'étapes dont la réussite est prérequise. |

## 4. Codes d'Erreur & États Internes

| État / Log | Signification | Comportement Système |
| :--- | :--- | :--- |
| `[Planner] Replanning required for step <N>` | Échec d'un outil lors de l'exécution d'une étape | Déclenchement de la boucle de replanification (max 5 fois). |
| `[Planner] Tool name hallucination corrected: <A> -> <B>` | Nom d'outil corrigé via distance lexicale | Exécution de l'outil le plus proche identifié. |
| `[Planner] Circular dependency detected in plan` | Dépendance cyclique dans `depends_on` | Rejet du plan et régénération d'un graphe acyclique. |

## 5. Exemple d'Utilisation Minimal

```typescript
import { planner } from '../../src/services/agentic/Planner.ts';

// 1. Définition des outils disponibles
const tools = [
  { name: 'search_web', description: 'Recherche des informations en ligne' },
  { name: 'read_file', description: 'Lit le contenu d’un fichier local' },
  { name: 'write_file', description: 'Écrit un rapport sur disque' },
];

// 2. Génération d'un plan pour un objectif complexe
const goal = 'Rechercher les nouveautés de TypeScript 5.6 et générer un résumé dans report.md';
const plan = await planner.plan(goal, { tools, chatId: 'chat_dev_1' });

console.log(`Plan généré : ${plan.steps.length} étapes, Complexité : ${plan.complexity}`);

// 3. Exécution du plan
const review = await planner.executePlan(plan, {
  tools: {
    search_web: async (args) => ({ results: ['TS 5.6 features...'] }),
    write_file: async (args) => ({ success: true, filePath: 'report.md' }),
  },
  chatId: 'chat_dev_1',
});

console.log('Succès global:', review.success, 'Taux:', review.successRate);
```

## 6. Limitations & Invariants Opérationnels

- **Topologie Acyclique :** Tout plan doit être un graphe strictement acyclique ($S_i \notin \text{Descendants}(S_i)$).
- **Plafond de Replanification :** La boucle de replanification est bornée à 5 itérations maximum pour éviter la surconsommation de jetons.
- **Interpolation Contextuelle :** Les variables interpolées non résolues sont remplacées par des chaînes vides ou conservées sous forme de texte d'avertissement.
