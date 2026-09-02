# SubAgentEngine — Référence Technique

Le module `SubAgentEngine` fournit l'infrastructure d'exécution et de délégation pour les sous-agents éphémères autonomes au sein de l'architecture Swarm de HIVE-MIND.

- **Fichier source :** `src/services/agentic/SubAgentEngine.ts`
- **Outil d'invocation système :** `src/plugins/base/dev_tools/SpawnSubAgentTool.ts`
- **Dépendances :** `src/providers/index.ts`, `src/plugins/loader.ts`, `src/core/blueprint/AgentBlueprint.ts`, `src/utils/toolValidator.ts`

## 1. Interfaces & Types TypeScript

```typescript
export interface SubAgentConfig {
  name: string;
  systemPrompt: string;
  allowedTools: string[];
  maxIterations?: number;
  category?: string;
  parentHistory?: readonly SubAgentMessage[];
}

export interface SubAgentContext {
  readonly blueprint?: AgentBlueprint;
  readonly [key: string]: unknown;
}

export interface SubAgentResult {
  success: boolean;
  message: string;
}

export interface SubAgentMessage {
  readonly role: string;
  readonly content: string | null;
  readonly tool_calls?: readonly SubAgentToolCall[];
  readonly tool_call_id?: string;
  readonly name?: string;
}

export interface SubAgentToolCall {
  readonly id: string;
  readonly type: string;
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}
```

## 2. Classes & Signatures de Méthodes

### `SubAgentEngine`

#### Constructeur
```typescript
constructor(config: SubAgentConfig)
```

Initialise le moteur de sous-agent avec sa configuration, en appliquant les valeurs par défaut (`maxIterations: 10`, `category: 'AGENTIC'`).

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `config` | `SubAgentConfig` | Oui | — | Objet de configuration définissant le nom, le prompt système et les outils autorisés. |

---

#### Méthode `run(task, context)`
```typescript
public async run(task: string, context: SubAgentContext): Promise<SubAgentResult>
```

Instancie le blueprint éphémère en RAM, construit l'historique conversationnel forké ou vierge, exécute la boucle ReAct isolée, filtre les balises de réflexion et désalloue les ressources dans un bloc `finally`.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `task` | `string` | Oui | — | Ordre de mission précis confié au sous-agent. |
| `context` | `SubAgentContext` | Oui | — | Contexte d'exécution héritant des contraintes parentales (`blueprint.constraints`). |

**Valeur de retour :**
- `Promise<SubAgentResult>` : Résultat contenant le statut `success` et le rapport consolidé `message`.

## 3. Paramètres de l'Outil Système `spawn_sub_agent`

| Paramètre | Type | Obligatoire | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | Oui | Nom identifiant du sous-agent (ex: `"FactChecker"`, `"CodeReviewer"`). |
| `persona` | `string` | Oui | System prompt complet définissant l'expertise et les règles du sous-agent. |
| `tools` | `string[]` | Oui | Liste blanche des outils utilisables (ex: `["read_file", "duckduck_search"]`). |
| `mission` | `string` | Oui | Consigne précise et instruction de travail à accomplir. |
| `mode` | `'fresh' \| 'fork'` | Non (défaut: `'fresh'`) | Mode d'initialisation de l'historique conversationnel. |

## 4. Codes d'Erreur & États Internes

| État / Log | Signification | Comportement |
| :--- | :--- | :--- |
| `[SubAgentEngine:Name] ⚠️ Outil non autorisé ignoré: <tool>` | Tentative d'appel d'un outil absent de `allowedTools` | L'appel est bloqué et une notification d'erreur d'autorisation est retournée au sous-agent. |
| `[SubAgentEngine:Name] ⏱️ Timeout atteint (120s)` | Exécution dépassant la limite temporelle | Interruption propre de la boucle et génération du rapport partiel. |
| `[SubAgentEngine:Name] 🛑 Plafond d'itérations atteint` | 10 itérations ReAct consécutives | Synthèse forcée des résultats acquis. |

## 5. Exemple d'Utilisation Minimal

```typescript
import { SubAgentEngine } from '../../src/services/agentic/SubAgentEngine.js';

// 1. Instanciation du moteur avec liste blanche stricte
const researcher = new SubAgentEngine({
  name: 'DocAuditor',
  systemPrompt: 'Tu es un auditeur technique spécialisé dans l’analyse d’architecture.',
  allowedTools: ['read_file', 'ast_query'],
  maxIterations: 6,
});

// 2. Exécution de la mission isolée
const result = await researcher.run(
  'Analyser les imports du dossier src/core/ et lister les couplages.',
  {
    blueprint: {
      metadata: { id: 'parent', name: 'Main', version: '1.0' },
      mindos: { drives: [] },
      action_space: { allowed_tools: ['*'] },
      constraints: { read_only_fs: true, max_budget_usd: 0.1, max_iterations: 10 },
    },
  }
);

console.log('Succès:', result.success);
console.log('Rapport:', result.message);
```

## 6. Limitations & Invariants Opérationnels

- **Isolation Mémoire :** Le sous-agent ne modifie pas l'historique de la conversation principale ; seul le message final est transmis.
- **Circuit Breaker :** Plafond strict à 120 secondes et 10 itérations ReAct.
- **Sanitisation :** Suppression automatique des balises `<think>` et `<thought>` avant le retour.
