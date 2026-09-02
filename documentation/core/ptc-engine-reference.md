# Programmatic Tool Calling (PTC) Engine & WakeSystem — Référence Technique

Le sous-système `PTC Engine` fournit l'infrastructure de validation statique d'AST, d'exécution dans un bac à sable `node:vm`, d'auto-réparation de code et de réveil programmé (*HiveWakeSystem*) pour l'orchestration programmatique d'outils.

- **Fichiers sources :** `src/services/ptc/ProgrammaticExecutor.ts`, `src/services/ptc/SafeScriptValidator.ts`, `src/services/ptc/SandboxHelpers.ts`, `src/services/ptc/ToolBridge.ts`, `src/services/ptc/WakeSystem.ts`, `src/services/ptc/types.ts`
- **Dépendances :** `node:vm`, `acorn`
- **Classes majeures :** `ProgrammaticExecutor`, `SafeScriptValidator`, `WakeSystem`

## 1. Interfaces & Types TypeScript

```typescript
import type { SleepResult } from './WakeSystem.js';

export interface ToolCallRecord {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  executionTimeMs?: number;
}

export interface CodeExecutionMetadata {
  readonly toolCallCount: number;
  readonly intermediateTokensSaved: number;
  readonly totalTokensSaved: number;
  readonly tokenSavingsBreakdown: {
    readonly intermediateResults: number;
    readonly roundTripContext: number;
    readonly toolCallOverhead: number;
    readonly llmDecisions: number;
  };
  readonly toolsUsed: readonly string[];
  readonly executionTimeMs: number;
  readonly sandboxToolCalls: readonly ToolCallRecord[];
  readonly sleepScheduled?: SleepResult;
  readonly warning?: string;
}

export interface PTCExecutionResult {
  readonly result: unknown;
  readonly metadata: CodeExecutionMetadata;
}

export interface PTCConfig {
  readonly timeoutMs: number;
  readonly baseContextTokens: number;
}

export type ToolFunction = (args: Record<string, unknown>) => Promise<unknown>;

export interface OpenAIToolDefinition {
  readonly type?: string;
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: {
      readonly type: string;
      readonly properties: Record<string, unknown>;
      readonly required?: readonly string[];
    };
  };
}
```

## 2. Classes & Signatures de Méthodes

### `ProgrammaticExecutor`

#### Constructeur
```typescript
constructor(config?: Partial<PTCConfig>)
```
Initialise l'exécuteur avec configuration personnalisée ou valeurs par défaut (`timeoutMs: 30000`, `baseContextTokens: 7000`).

---

#### Méthode `buildCodeExecutionToolDef(availableTools)`
```typescript
public buildCodeExecutionToolDef(
  availableTools: readonly OpenAIToolDefinition[]
): OpenAIToolDefinition
```

Génère dynamiquement la définition de méta-outil `code_execution` au format OpenAI en incluant la documentation des outils injectables et les instructions des helpers défensifs.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `availableTools` | `readonly OpenAIToolDefinition[]` | Oui | — | Définitions d'outils disponibles à documenter dans le prompt d'outil. |

**Valeur de retour :**
- `OpenAIToolDefinition` : Objet de méta-outil prêt pour l'API LLM.

---

#### Méthode `execute(code, toolFunctions, hiveBridge)`
```typescript
public async execute(
  code: string,
  toolFunctions: ReadonlyMap<string, ToolFunction>,
  hiveBridge?: HiveWakeBridge
): Promise<PTCExecutionResult>
```

Valide, auto-répare et exécute le script JavaScript fourni dans une machine virtuelle `node:vm` isolée, enregistre les appels d'outils et calcule les métriques d'économie de jetons.

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `code` | `string` | Oui | — | Script JavaScript généré par le LLM. |
| `toolFunctions` | `ReadonlyMap<string, ToolFunction>` | Oui | — | Table associative des fonctions asynchrones d'outils injectées. |
| `hiveBridge` | `HiveWakeBridge` | Non | `undefined` | Pont optionnel de gestion du réveil contextuel `HIVE.sleepAndWake`. |

**Valeur de retour :**
- `Promise<PTCExecutionResult>` : Résultat final retourné par le script et métriques détaillées.

**Exceptions :**
| Type d'Erreur | Condition de Déclenchement |
| :--- | :--- |
| `ValidationError` | Présence de primitives interdites (`require`, `eval`, `process`) dans l'AST. |
| `TimeoutError` | Durée d'exécution du script excédant `timeoutMs` (30s par défaut). |
| `RuntimeError` | Exception JavaScript non interceptée dans le code du script. |

## 3. Helpers Défensifs Injectés dans le Sandbox

| Helper | Signature | Description |
| :--- | :--- | :--- |
| `toArray(val)` | `(val: unknown) => unknown[]` | Convertit de façon sûre toute valeur en tableau (extrait `.items`, `.data` ou retourne `[]`). |
| `safeGet(obj, path, def)` | `(obj: unknown, path: string, def?: unknown) => unknown` | Accès sécurisé aux propriétés imbriquées sans `TypeError`. |
| `safeMap(arr, fn)` | `(arr: unknown, fn: (item: unknown) => unknown) => unknown[]` | Mappe un tableau en ignorant les éléments nuls ou non itérables. |
| `isSuccess(res)` | `(res: unknown) => boolean` | Détermine si un retour d'outil signale un succès fonctionnel. |
| `extractText(res)` | `(res: unknown) => string` | Extrait le contenu textuel d'une réponse d'outil complexe. |

## 4. Codes d'Erreur & États Internes

| Code / Message | Signification | Comportement |
| :--- | :--- | :--- |
| `SECURITY_VIOLATION: <ident>` | Détection d'un identifiant interdit (`eval`, `process`, `import`) | Rejet immédiat du script avant exécution. |
| `PTC_TIMEOUT` | Exécution bloquante dépassant le temps imparti | Arrêt forcé du contexte VM. |
| `SCOPE_GUARD_INTERCEPT: <var>` | Accès à une variable globale non déclarée | Retourne `undefined` via le Proxy sans lever de `ReferenceError`. |

## 5. Exemple d'Utilisation Minimal

```typescript
import { ProgrammaticExecutor } from '../../src/services/ptc/ProgrammaticExecutor.js';

const executor = new ProgrammaticExecutor({ timeoutMs: 15000 });

// Déclaration des outils injectés
const tools = new Map([
  [
    'get_temperature',
    async (args: { city?: unknown }) => ({ city: String(args.city), temp: 22 }),
  ],
]);

// Code JS orchestré généré par l'agent
const script = `
  const [t1, t2] = await Promise.all([
    get_temperature({ city: 'Paris' }),
    get_temperature({ city: 'Nice' })
  ]);
  return { average: (t1.temp + t2.temp) / 2 };
`;

const execution = await executor.execute(script, tools);
console.log('Résultat final:', execution.result); // { average: 22 }
console.log('Jetons économisés:', execution.metadata.totalTokensSaved);
```

## 6. Limitations & Invariants Opérationnels

- **Isolation VM :** Le bac à sable s'exécute dans le même thread que le processus Node.js parent ; un calcul synchrone bloquant sans fin (`while(true)`) est interrompu par le disjoncteur de timeout du contexte VM.
- **Règles d'Appels :** Chaque fonction d'outil injectée attend exactement un objet de paramètres unique.
