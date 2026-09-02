# Dynamic Plugin Pipeline & Strict Validation (SS-25) — Référence Technique

Description factuelle et spécification d'interface du gestionnaire de plugins dynamique, du système de validation stricte des paramètres et du client MCP.

- **Fichiers sources :** `src/plugins/loader.ts`, `src/utils/toolValidator.ts`, `src/services/mcpClient.ts`, `src/utils/toolExecution.ts`
- **Conteneur IoC :** Singleton exporté `pluginLoader` (`PluginLoader`), singleton exporté `mcpClient` (`McpClientService`).
- **Dépendances majeures :** `ajv`, `zod`, `@modelcontextprotocol/sdk`, `src/core/events.ts` (`eventBus`, `BotEvents`), `src/utils/safeFs.ts`.

## 1. Interfaces & Types TypeScript

```typescript
import type { OpenAIToolDefinition } from '../src/services/ptc/types.js';
import { z } from 'zod';

export interface Plugin {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly enabled?: boolean;
  readonly toolDefinition?: OpenAIToolDefinition;
  readonly toolDefinitions?: readonly OpenAIToolDefinition[];
  readonly init?: () => Promise<void> | void;
  readonly execute: (
    args: Record<string, unknown>,
    context: Record<string, unknown>,
    toolName: string,
  ) => Promise<PluginResult>;
  readonly textMatchers?: readonly TextMatcher[];
  readonly processor?: unknown;
}

export interface PluginResult {
  readonly success: boolean;
  readonly message: string;
  readonly error?: string;
  readonly gracefulDegradation?: boolean;
  readonly [key: string]: unknown;
}

export interface TextMatcher {
  readonly pattern: RegExp;
  readonly name?: string;
  readonly handler?: string;
  readonly description?: string;
  readonly extractArgs?: (
    match: RegExpMatchArray,
    message: Record<string, unknown>,
    text: string,
  ) => Record<string, unknown> | null | undefined;
}

export interface McpServerConfig {
  type: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface ToolDefParameter {
  type?: string;
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, unknown>;
}

export interface ToolDef {
  function?: {
    name?: string;
    description?: string;
    parameters?: ToolDefParameter;
  };
}

export interface ValidationResult {
  valid: boolean;
  missing: string[];
  schema: unknown;
  formattedError?: string;
}
```

## 2. Classes & Méthodes Publiques

### `PluginLoader` (`src/plugins/loader.ts`)

#### Méthode `loadAll()`

```typescript
public async loadAll(): Promise<Map<string, Plugin>>
```

Explore l'ensemble des sous-répertoires de `src/plugins/`, instancie et valide chaque plugin et enregistre ses outils.

**Valeur de retour :**

- `Promise<Map<string, Plugin>>` : Table associative associant le nom du plugin à son instance active.

#### Méthode `execute(toolName, args, context)`

```typescript
public async execute(
  toolName: string,
  args: Record<string, unknown>,
  context: Record<string, unknown>
): Promise<PluginResult>
```

Exécute un outil en routant vers le plugin détenteur avec interception sécurisée des erreurs.

**Paramètres :**

| Paramètre  | Type                      | Obligatoire | Description                                                       |
| :--------- | :------------------------ | :---------- | :---------------------------------------------------------------- |
| `toolName` | `string`                  | Oui         | Nom de l'outil ciblé (ex. `'edit_file'`, `'google_ai_search'`).   |
| `args`     | `Record<string, unknown>` | Oui         | Arguments analysés et validés.                                    |
| `context`  | `Record<string, unknown>` | Oui         | Contexte d'exécution (contenant `chatId`, `sourceChannel`, etc.). |

#### Méthode `getRelevantTools(userMessage, limit?, fallbackLimit?, options?)`

```typescript
public async getRelevantTools(
  userMessage: string,
  limit: number = 5,
  fallbackLimit: number = 10,
  options: { forceModeration?: boolean } = {}
): Promise<OpenAIToolDefinition[]>
```

Effectue la recherche RAG sémantique dans Supabase et retourne la liste des définitions d'outils combinant résultats vectoriels et outils système indispensables.

#### Méthode `reload(name)`

```typescript
public async reload(name: string): Promise<void>
```

Recharge à chaud un plugin spécifique sans redémarrer le démon.

---

### `McpClientService` (`src/services/mcpClient.ts`)

#### Méthode `connectAll()`

```typescript
public async connectAll(): Promise<void>
```

Lit la configuration `.mcprc` et établit les connexions avec tous les serveurs MCP configurés (`stdio` ou `sse`).

#### Méthode `getTools()`

```typescript
public async getTools(): Promise<McpToolDefinition[]>
```

Interroge chaque serveur MCP connecté via la méthode standard `tools/list` et retourne les définitions converties au format OpenAI Tool Definition.

#### Méthode `callTool(serverName, toolName, args)`

```typescript
public async callTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolResult>
```

Délègue l'exécution d'un outil distant au serveur MCP cible via le protocole SDK officiel.

---

### Fonctions Utilitaires (`toolValidator.ts` & `toolExecution.ts`)

#### `validateToolArgs(toolName, toolArgs, toolDefs)`

```typescript
export function validateToolArgs(
  toolName: string,
  toolArgs: string,
  toolDefs: ToolDef[],
): ValidationResult;
```

Valide une chaîne JSON d'arguments contre le schéma JSON Schema de l'outil via Ajv en forçant `additionalProperties: false`.

#### `defineZodTool(toolDef)`

```typescript
export function defineZodTool<T extends z.ZodTypeAny>(toolDef: ToolDefinition<T>): ZodTool;
```

Génère une définition d'outil compatible OpenAI à partir d'un schéma Zod typé.

## 3. Schéma de Configuration (`.mcprc`)

Fichier JSON local à la racine du projet déclarant les serveurs MCP :

```json
{
  "filesystem": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
    "env": {}
  },
  "remote_service": {
    "type": "sse",
    "url": "http://localhost:8080/sse"
  }
}
```

## 4. Diagnostics & Erreurs Formatées (`<tool_use_error>`)

| Diagnostic Formate                                                                                 | Cause                                                                         | Comportement Agent                                                               |
| :------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- | :------------------------------------------------------------------------------- |
| `<tool_use_error>InputValidationError: The required parameter 'X' is missing.</tool_use_error>`    | Un argument obligatoire défini dans `required` n'a pas été fourni par le LLM. | L'agent lit le message et régénère l'appel en fournissant le paramètre manquant. |
| `<tool_use_error>InputValidationError: An unexpected parameter 'Y' was provided.</tool_use_error>` | Le LLM a halluciné un argument non présent dans le schéma `properties`.       | L'agent retire le paramètre superflue au tour suivant.                           |
| `<tool_use_error>InputValidationError: Failed to parse JSON.</tool_use_error>`                     | La chaîne transmise dans `arguments` n'est pas un JSON syntaxiquement valide. | L'agent régénère la syntaxe JSON.                                                |
| `TOOL_ERROR: Plugin "X" not found.`                                                                | L'outil demandé n'est pas chargé ou n'existe pas dans le registre.            | Message dégradé permettant à l'agent d'avertir l'utilisateur sans planter.       |

## 5. Exemple d'Utilisation Minimal

```typescript
import { defineZodTool, executeZodTool } from '../src/utils/toolExecution.js';
import { z } from 'zod';

// 1. Définition d'un outil typé avec Zod
const myCalculatorTool = defineZodTool({
  name: 'calculate_sum',
  description: 'Calcule la somme de deux nombres réels.',
  schema: z.object({
    a: z.number().describe('Premier terme'),
    b: z.number().describe('Second terme'),
  }),
  execute: async (args) => {
    return { result: args.a + args.b };
  },
});

// 2. Exécution avec validation automatique
const rawArgs = JSON.stringify({ a: 10, b: 32 });
const result = await executeZodTool(myCalculatorTool, rawArgs, {});
console.log('Résultat calculé :', result); // { result: 42 }
```

## 6. Limitations & Invariants Opérationnels

- **Concurrence des Validations** : La compilation Ajv est effectuée à la volée avec l'option `{ allErrors: true, strict: false }`.
- **RAG Fallback** : Si Supabase ou le service d'embeddings est indisponible, le système bascule automatiquement sur la liste `SAFE_FALLBACK_TOOLS` (11 outils fondamentaux), assurant une disponibilité 100%.
- **Délai MCP** : Les connexions aux serveurs MCP locaux et distants sont initialisées en parallèle lors du premier appel à `getTools()`.
