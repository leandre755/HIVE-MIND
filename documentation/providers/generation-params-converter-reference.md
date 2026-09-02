# GenerationParams & MessageConverter — Référence Technique

Ce document fournit la spécification formelle et exhaustive du normalisateur de paramètres **GenerationParams**, des convertisseurs dialectaux **MessageConverter** et du générateur d'identifiants d'outils **ToolIds**.

- **Fichiers sources :** `src/providers/GenerationParams.ts`, `src/providers/families/protocols/messageConverter.ts`, `src/providers/toolIds.ts`, `src/providers/types.ts`
- **Conteneur IoC :** Module de fonctions pures et types exportés (aucun état global, zéro instanciation requise).
- **Dépendances majeures :** `node:crypto` (`randomUUID`, `randomInt`). Zero dépendance externe.

## 1. Interfaces & Types TypeScript

```typescript
// ── Types Pivots Fondamentaux ──────────────────────────────

export type ThinkingKind = 'anthropic-budget' | 'openai-effort' | 'gemini-budget' | 'none';

export type MaxTokensField = 'max_tokens' | 'max_completion_tokens' | 'maxOutputTokens';

export type ProtocolDialect = 'openai-compatible' | 'anthropic-compatible' | 'gemini-native';

export interface ThinkingParams {
  mode: 'off' | 'budget' | 'effort';
  budgetTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}

export interface GenerationParams {
  thinking?: ThinkingParams;
  maxTokens?: number;
  temperature?: number;
  promptCaching?: boolean;
}

export interface ModelCapabilities {
  thinking: ThinkingKind;
  promptCaching: boolean;
  temperatureRange: [number, number] | 'unsupported';
  maxTokensField: MaxTokensField;
  maxTokensRequired: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[] | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface WireMessage {
  role: string;
  content: string | unknown[] | null;
  [key: string]: unknown;
}

export interface ResponseConversion {
  content: string | null;
  toolCalls: ToolCall[] | null;
  reasoningContent?: string | null;
  thought?: string | null;
}
```

## 2. Fonctions & Signatures Exportées

### Module `GenerationParams.ts`

#### `resolveCapabilities(modelId, familyConfig)`
```typescript
export function resolveCapabilities(
  modelId: string,
  familyConfig: Record<string, unknown>
): ModelCapabilities
```
Extrait et valide l'objet `capacites` d'un modèle en fusionnant les capacités définies au niveau de la famille avec la surcharge éventuelle propre au modèle.

#### `validateParams(params, caps, effectiveMaxTokens)`
```typescript
export function validateParams(
  params: GenerationParams,
  caps: ModelCapabilities,
  effectiveMaxTokens?: number
): void
```
Vérifie la conformité des paramètres par rapport aux capacités du modèle. Lève une `GenerationParamsError` en cas de dépassement de bornes (ex. budget de raisonnement $\ge$ `effectiveMaxTokens`).

#### `toWireParams(dialect, params, caps, effectiveMaxTokens)`
```typescript
export function toWireParams(
  dialect: ProtocolDialect,
  params: GenerationParams,
  caps: ModelCapabilities,
  effectiveMaxTokens?: number
): Record<string, unknown>
```
Traduit les paramètres abstraits en dictionnaire de clés filaires prêtes pour le corps HTTP.

| Dialecte Cible | Champ Sortie Token | Champ Température | Gestion Raisonnement |
| :--- | :--- | :--- | :--- |
| `openai-compatible` | `max_tokens` ou `max_completion_tokens` | `temperature` (omis si `unsupported`) | `reasoning_effort: 'low' \| 'medium' \| 'high'` |
| `anthropic-compatible` | `max_tokens` (obligatoire) | `temperature` | `thinking: { type: 'enabled', budget_tokens: N }` |
| `gemini-native` | `maxOutputTokens` | `temperature` | `thinkingConfig: { thinkingBudget: N }` |

#### `applyPromptCaching(messages, caps)`
```typescript
export function applyPromptCaching(
  messages: ChatMessage[],
  caps: ModelCapabilities
): ChatMessage[]
```
Injecte `{ cache_control: { type: 'ephemeral' } }` sur les messages applicables pour Anthropic si `caps.promptCaching === true`. Retourne une copie profonde ou le tableau original si non supporté.

---

### Module `messageConverter.ts`

#### Fonctions de Conversion des Messages Entrants
| Fonction | Entrée | Sortie | Rôle & Spécificités |
| :--- | :--- | :--- | :--- |
| `convertMessagesForOpenAI(messages)` | `ChatMessage[]` | `WireMessage[]` | Pass-through fidèle avec conservation de `tool_calls`, `reasoning_content` et `name`. |
| `convertMessagesForAnthropic(messages)` | `ChatMessage[]` | `WireMessage[]` | Conversion des `tool_calls` en blocs `tool_use` (avec parsing JSON des arguments), réponses d'outils en `tool_result`, et extraction des images base64. |
| `convertMessagesForGemini(messages)` | `ChatMessage[]` | `WireMessage[]` | Adaptation des rôles en `user` et `model`, conversion des outils en `functionCall` et des réponses en `functionResponse`. |
| `convertMessagesForCohere(messages)` | `ChatMessage[]` | `WireMessage[]` | Adaptation des rôles en `USER`, `CHATBOT`, `SYSTEM`, `TOOL`. |

#### Fonctions de Conversion des Réponses API
| Fonction | Entrée | Sortie |
| :--- | :--- | :--- |
| `convertResponseForOpenAI(data)` | `unknown` | `ResponseConversion` |
| `convertResponseForAnthropic(data)` | `unknown` | `ResponseConversion` |
| `convertResponseForGemini(data)` | `unknown` | `ResponseConversion` |
| `convertResponseForCohere(data)` | `unknown` | `ResponseConversion` |

---

### Module `toolIds.ts`

#### `generateSafeToolId()`
```typescript
export function generateSafeToolId(): string
```
Génère une chaîne aléatoire uniforme de 9 caractères dans l'alphabet `[a-zA-Z0-9]` via `crypto.randomInt()`. Conforme au format strict Mistral/Codestral.

#### `isValidToolId(id)`
```typescript
export function isValidToolId(id: string): boolean
```
Vérifie par expression régulière stricte `/^[a-zA-Z0-9]{9}$/` que l'identifiant est conforme.

---

## 3. Schéma JSON des Capacités dans `models_config.json`

```json
{
  "capacites": {
    "thinking": "anthropic-budget",
    "prompt_caching": true,
    "temperature_range": [0, 1],
    "max_tokens_field": "max_tokens",
    "max_tokens_required": true
  }
}
```

| Clé JSON | Type | Valeurs Possibles | Défaut Fail-Closed |
| :--- | :--- | :--- | :--- |
| `thinking` | `string` | `'anthropic-budget'`, `'openai-effort'`, `'gemini-budget'`, `'none'` | `'none'` |
| `prompt_caching` | `boolean` | `true`, `false` | `false` |
| `temperature_range` | `[number, number] \| "unsupported"` | Ex. `[0, 2]`, `[0, 1]`, `"unsupported"` | `[0, 2]` |
| `max_tokens_field` | `string` | `'max_tokens'`, `'max_completion_tokens'`, `'maxOutputTokens'` | `'max_tokens'` |
| `max_tokens_required` | `boolean` | `true`, `false` | `false` |

---

## 4. Exceptions & Erreurs Levées

| Exception | Condition de Déclenchement | Comportement Système |
| :--- | :--- | :--- |
| `GenerationParamsError` | Clé inconnue dans l'objet `capacites`, type invalide, ou budget de raisonnement excédant `effectiveMaxTokens`. | Échec immédiat au démarrage ou avant l'émission réseau (*Fail-Closed*). |
| `Error: [toolIds] ID généré non conforme` | Échec improbable lors de la génération de l'ID d'outil (invariance de taille). | Rejet immédiat avec log d'anomalie cryptographique. |

---

## 5. Exemple d'Utilisation Minimal

```typescript
import {
  toWireParams,
  applyPromptCaching,
  type GenerationParams,
  type ModelCapabilities,
} from '../../src/providers/GenerationParams.js';
import {
  convertMessagesForAnthropic,
  type WireMessage,
} from '../../src/providers/families/protocols/messageConverter.js';
import { generateSafeToolId } from '../../src/providers/toolIds.js';

const caps: ModelCapabilities = {
  thinking: 'anthropic-budget',
  promptCaching: true,
  temperatureRange: [0, 1],
  maxTokensField: 'max_tokens',
  maxTokensRequired: true,
};

const params: GenerationParams = {
  temperature: 0.5,
  maxTokens: 4096,
  thinking: { mode: 'budget', budgetTokens: 2048 },
};

// 1. Traduction filaire des paramètres
const wireBody = toWireParams('anthropic-compatible', params, caps, 4096);
console.log('Wire Body Params:', wireBody);
// { max_tokens: 4096, temperature: 0.5, thinking: { type: 'enabled', budget_tokens: 2048 } }

// 2. Génération d'un ID d'outil sécurisé
const toolId = generateSafeToolId();
console.log('Safe Tool ID:', toolId); // Ex: "k8Z1pQ9mX"

// 3. Conversion de messages
const messages = [
  { role: 'user', content: 'Bonjour' },
];
const anthropicWire = convertMessagesForAnthropic(messages);
```

---

## 6. Limitations & Invariants Opérationnels

- **Pureté Fonctionnelle Totale** : Métrique d'instabilité de Martin $I = 0.00$. Zéro dépendance vers le reste du système.
- **Complexité Algorithmique** :
  - `toWireParams` : $O(1)$ en temps et en allocation.
  - `convertMessagesFor*` : $O(M)$ où $M$ est le nombre total de messages et de blocs d'outils.
  - `generateSafeToolId` : $O(1)$ (boucle fixe de 9 itérations).
- **Consommation Mémoire** : Empreinte négligeable, libérée immédiatement par le Garbage Collector après la sérialisation HTTP.
