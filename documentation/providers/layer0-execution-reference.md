# Layer 0 ExecutionLayer & ModelRegistry — Référence Technique

Ce document constitue la référence technique formelle du moteur d'exécution bas niveau **Layer 0** et du registre des modèles **ModelRegistry**.

- **Fichiers sources :** `src/providers/layer0/ExecutionLayer.ts`, `src/providers/layer0/ModelRegistry.ts`, `src/providers/layer0/classifyError.ts`, `src/providers/layer0/errors.ts`, `src/providers/families/registry.ts`, `src/providers/families/types.ts`
- **Conteneur IoC :** Instanciation directe ou singleton `executionLayer` / `ModelRegistry.getInstance()`
- **Dépendances majeures :** `node:crypto`, `node:path`, `fetch` (natif Node.js $\ge 22$), `src/utils/safeFs.ts`

## 1. Interfaces & Types TypeScript

```typescript
import type { ChatMessage, ToolDefinition, AdapterChatResult } from '../types.js';
import type { GenerationParams, ModelCapabilities, ProtocolDialect } from '../GenerationParams.js';

export interface ExecutionRequest {
  messages: ChatMessage[];
  params?: GenerationParams;
  tools?: ToolDefinition[];
  tool_choice?: string;
  wireParams?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface ExecutionOpts {
  apiKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  effectiveMaxTokens?: number;
}

export interface StreamChunk {
  content?: string;
  thought?: string;
  toolCalls?: unknown[];
  done?: boolean;
  raw?: unknown;
}

export interface ResolvedModelConfig {
  modelId: string;
  provider: string;
  base_url?: string;
  protocol_family: ProtocolDialect;
  header_family: string;
  capabilities: ModelCapabilities;
  familyConfig?: Record<string, unknown>;
  modelMeta?: Record<string, unknown>;
}

export interface ProtocolContext {
  model: string;
  apiKey: string;
  messages: unknown[];
  options: Record<string, unknown>;
  familyConfig?: Record<string, unknown>;
  wireParams?: Record<string, unknown>;
  protocolOptions?: ProtocolOptions;
}

export interface ProtocolOptions {
  default_max_tokens?: number;
  default_temperature?: number;
  extra_body?: Record<string, unknown>;
  extra_headers?: Record<string, string>;
  passthrough_options?: string[];
  tool_choice?: 'auto' | 'gpt-only' | 'omit';
  sanitize_tool_ids?: boolean;
  messages_payload?: 'full' | 'role-content-only';
  omit_tools_if_model_contains?: string[];
  relay_reasoning_content?: boolean;
  extract_reasoning_content?: boolean;
  timeout_ms?: number;
}

export interface ProtocolFamily {
  name: string;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
  supportsTools?: boolean;
  wireParamKeys?: string[];
  buildUrl(context: ProtocolContext): string;
  buildBody(context: ProtocolContext): Record<string, unknown>;
  parseResponse(data: unknown, context: ProtocolContext): AdapterChatResult;
  parseError(body: unknown, status: number): never;
  parseStreamChunk?(chunk: string, context: ProtocolContext): StreamChunk | null;
}

export interface HeaderFamily {
  name: string;
  buildHeaders(apiKey: string, context?: HeaderContext): Record<string, string>;
}
```

## 2. Classes & Signatures de Méthodes

### `ExecutionLayer`

#### Méthode `execute(modelId, request, opts)`
```typescript
public async execute(
  modelId: string,
  request: ExecutionRequest,
  opts?: ExecutionOpts
): Promise<AdapterChatResult>
```

**Paramètres :**
| Paramètre | Type | Obligatoire | Défaut | Description |
| :--- | :--- | :--- | :--- | :--- |
| `modelId` | `string` | Oui | — | Identifiant unique du modèle déclaré dans `models_config.json`. |
| `request` | `ExecutionRequest` | Oui | — | Objet décrivant les messages, paramètres, et définitions d'outils. |
| `opts` | `ExecutionOpts` | Non | `{}` | Options d'exécution : clé API surchargée, timeout, `AbortSignal`, bridage max_tokens. |

**Valeur de retour :**
- `Promise<AdapterChatResult>` : Résultat standardisé contenant `content`, `toolCalls`, `usage` et métadonnées de réponse.

**Exceptions Levées :**
| Type d'Erreur | Condition de Déclenchement |
| :--- | :--- |
| `InvalidRequestError` | Modèle inconnu (`MODEL_NOT_FOUND`) ou payload rejeté par l'API (HTTP 400 / 422). |
| `AuthError` | Clé d'API absente, vide ou rejetée par le fournisseur (HTTP 401 / 403). |
| `RateLimitError` | Dépassement de quota ou saturation du fournisseur (HTTP 429). |
| `ServerError` | Erreur interne du fournisseur (HTTP 5xx) ou réponse JSON corrompue. |
| `NetworkError` | Requête annulée par timeout (`AbortError`), coupure de connexion ou `status: 0`. |
| `ContentFilterError` | Déclenchement d'un filtre de sécurité ou de modération chez le fournisseur. |

---

#### Méthode `executeStream(modelId, request, opts)`
```typescript
public async *executeStream(
  modelId: string,
  request: ExecutionRequest,
  opts?: ExecutionOpts
): AsyncIterable<StreamChunk>
```

**Paramètres :**
Identiques à `execute()`.

**Valeur de retour :**
- `AsyncIterable<StreamChunk>` : Générateur asynchrone émettant des fragments de flux SSE désérialisés (`content`, `thought`, `toolCalls`, `done: boolean`).

---

### `ModelRegistry`

#### Méthode `getModelConfig(modelId)`
```typescript
public getModelConfig(modelId: string): ResolvedModelConfig
```
Retourne la configuration résolue d'un modèle. Lève une `InvalidRequestError` si l'identifiant n'existe pas dans le registre.

#### Méthode `hasModel(modelId)`
```typescript
public hasModel(modelId: string): boolean
```
Retourne `true` si le modèle est enregistré dans `models_config.json`.

#### Méthode `listModels()`
```typescript
public listModels(): string[]
```
Retourne la liste complète de tous les identifiants de modèles indexés.

#### Méthodes Statiques Singleton
```typescript
public static getInstance(): ModelRegistry
public static resetInstance(): void
```

---

## 3. Familles de Protocoles & Stratégies d'En-têtes

### Familles de Protocoles (`ProtocolFamily`)
| Nom Enregistré | Singleton Source | Description |
| :--- | :--- | :--- |
| `openai-compatible` | `openAICompatibleProtocol` | Dialecte standard OpenAI ChatCompletions (`/chat/completions`). Supporte le streaming SSE delta, les tools `function` et la restitution de `reasoning_content`. |
| `anthropic-compatible` | `anthropicCompatibleProtocol` | Dialecte Anthropic Messages (`/v1/messages`). Supporte `tool_use`, `thinking` avec budget, et l'injection de prompt caching éphémère. |

### Familles d'En-têtes (`HeaderFamily`)
| Nom Enregistré | Format d'En-tête Généré | Fournisseurs Types |
| :--- | :--- | :--- |
| `standard-bearer` | `Authorization: Bearer <apiKey>` | OpenAI, Groq, DeepSeek, Together, Mistral |
| `standard-token` | `Authorization: Token <apiKey>` | Replicate, Modal |
| `x-api-key` | `x-api-key: <apiKey>` | Anthropic, Cohere |
| `claude-code` | En-têtes impersonés Claude Code | Proxies Claude Code internes |

---

## 4. Schéma de Configuration & Variables d'Environnement

### Variables d'Environnement
| Variable d'Environnement | Type | Défaut | Obligatoire | Description |
| :--- | :--- | :--- | :--- | :--- |
| `OPENAI_API_KEY` | `string` | — | Non | Clé API pour la famille OpenAI. |
| `ANTHROPIC_API_KEY` | `string` | — | Non | Clé API pour la famille Anthropic. |
| `GROQ_API_KEY` | `string` | — | Non | Clé API pour la famille Groq. |
| `DEEPSEEK_API_KEY` | `string` | — | Non | Clé API pour la famille DeepSeek. |

### Schéma JSON dans `models_config.json`
```json
{
  "familles": {
    "openai": {
      "base_url": "https://api.openai.com/v1",
      "protocol_family": "openai-compatible",
      "header_family": "standard-bearer",
      "protocol_options": {
        "timeout_ms": 60000,
        "tool_choice": "auto"
      },
      "modeles": [
        {
          "id": "gpt-4o",
          "capacites": {
            "thinking": "none",
            "prompt_caching": true,
            "temperature_range": [0, 2],
            "max_tokens_field": "max_tokens",
            "max_tokens_required": false
          }
        }
      ]
    }
  }
}
```

---

## 5. Hiérarchie des Erreurs (`Layer0Error`)

| Classe d'Erreur | Code Propriété | Statut HTTP | Rétriable (`retriable`) | Poids Malus (`malusWeight`) |
| :--- | :--- | :--- | :--- | :--- |
| `InvalidRequestError` | `INVALID_REQUEST` | 400, 422 | `false` | 0 |
| `AuthError` | `AUTH_ERROR` | 401, 403 | `false` | 10 |
| `RateLimitError` | `RATE_LIMIT` | 429 | `true` | 2 (avec `retryAfterMs`) |
| `ServerError` | `SERVER_ERROR` | 500..599 | `true` | 8 |
| `NetworkError` | `NETWORK_ERROR` | 0, Timeout | `true` | 8 |
| `ContentFilterError` | `CONTENT_FILTER` | 200, 400 | `false` | 0 |

---

## 6. Exemple d'Utilisation Minimal

```typescript
import { executionLayer, type ExecutionRequest } from '../../src/providers/layer0/ExecutionLayer.js';

const request: ExecutionRequest = {
  messages: [
    { role: 'system', content: 'Tu es un assistant concis.' },
    { role: 'user', content: 'Donne-moi 3 faits sur TypeScript.' }
  ],
  params: {
    temperature: 0.7,
    maxTokens: 500
  }
};

// 1. Exécution bloquante
const result = await executionLayer.execute('gpt-4o', request, {
  timeoutMs: 30000
});
console.log('Réponse :', result.content);

// 2. Exécution en streaming
for await (const chunk of executionLayer.executeStream('gpt-4o', request)) {
  if (chunk.content) {
    process.stdout.write(chunk.content);
  }
}
```

---

## 7. Limitations & Invariants Opérationnels

- **Concurrence & Thread-Safety** : `ExecutionLayer` est 100% stateless et réentrant. Aucune variable partagée n'est altérée lors des appels concurrents.
- **Complexité Algorithmique** :
  - Résolution de modèle : $O(1)$ par consultation de `Map<string, ResolvedModelConfig>`.
  - Décodage SSE : $O(N)$ où $N$ est la longueur du flux en octets.
- **Gestion Mémoire** : Aucun buffer infini. Le tampon SSE conserve uniquement la ligne courante non terminée, évitant toute saturation mémoire lors de longues réponses.
