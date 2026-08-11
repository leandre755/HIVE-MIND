/**
 * Moteur du dialecte Anthropic Messages API (`POST {base_url}/messages`).
 *
 * Factorise la traduction OpenAI -> Anthropic historiquement portée par
 * `adapters/anthropic.ts` : extraction du `system`, conversion des blocs
 * image `image_url` en source base64, format d'outils `input_schema`, et
 * reconversion des blocs `tool_use` en `ToolCall` du contrat routeur.
 *
 * Module autonome : n'importe que les contrats partagés, jamais
 * `src/providers/index.ts`.
 */

import type {
  AdapterChatResult,
  ApiErrorResponse,
  ChatMessage,
  TokenUsage,
  ToolDefinition,
} from '../../types.js';
import type { ProtocolContext, ProtocolFamily } from '../types.js';
import { convertMessagesForAnthropic, convertResponseForAnthropic } from './messageConverter.js';
import { mergeWireParams } from './wireMerge.js';

/** Nom public du moteur, réutilisé dans tous les messages d'erreur. */
const PROTOCOL_NAME = 'anthropic-compatible';

/**
 * Plafond de génération exigé par l'API Messages : `max_tokens` est un champ
 * obligatoire sans valeur par défaut côté Anthropic. Ne s'applique que quand
 * le routeur n'impose pas de budget (`options.max_tokens`) — même sémantique
 * que `REQUIRED_MAX_TOKENS_FLOOR` de l'adapter historique.
 */
const REQUIRED_MAX_TOKENS_FLOOR = 4096;

/** Budget HTTP par défaut, identique aux adapters historiques (60 s). */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Allowlist des clés `wireParams` fusionnées dans le corps. Contient
 * `thinking` (budget de raisonnement étendu) et les réglages d'échantillonnage
 * propres au dialecte (`top_k`).
 */
const WIRE_PARAM_KEYS: readonly string[] = [
  'thinking',
  'temperature',
  'max_tokens',
  'top_p',
  'top_k',
];

/** Outil déclaré au format Anthropic (`input_schema` au lieu de `parameters`). */
interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

/** Bloc de contenu renvoyé par Anthropic : texte ou appel d'outil. */
interface AnthropicResponseBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

/** Comptage de jetons Anthropic, normalisé en `TokenUsage` à la sortie. */
interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

/** Forme minimale de la réponse `POST /messages` relue par le moteur. */
interface AnthropicResponse {
  content?: AnthropicResponseBlock[];
  stop_reason?: string;
  usage?: AnthropicUsage;
}

/** Convertit la déclaration d'outils OpenAI vers le format `input_schema`. */
function toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

/**
 * Normalise le comptage Anthropic (`input_tokens`/`output_tokens`) vers le
 * contrat routeur (`prompt_tokens`/`completion_tokens`, somme en
 * `total_tokens`). Retourne `undefined` si l'API n'a rien renvoyé.
 */
function normalizeUsage(usage: AnthropicUsage | undefined): TokenUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const result: TokenUsage = {};
  if (typeof usage.input_tokens === 'number') {
    result.prompt_tokens = usage.input_tokens;
  }
  if (typeof usage.output_tokens === 'number') {
    result.completion_tokens = usage.output_tokens;
  }
  if (typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number') {
    result.total_tokens = usage.input_tokens + usage.output_tokens;
  }
  return result;
}

/**
 * Moteur singleton du dialecte Anthropic Messages.
 *
 * Enregistré auprès du routeur via son export par défaut ; les erreurs ne
 * remontent que par `throw`, jamais par un objet retourné.
 */
export const anthropicCompatibleProtocol: ProtocolFamily = {
  name: PROTOCOL_NAME,
  supportsTools: true,
  wireParamKeys: [...WIRE_PARAM_KEYS],
  timeoutMs: DEFAULT_TIMEOUT_MS,

  /**
   * Construit `{base_url sans slash terminal}/messages`.
   *
   * Fail-closed : sans `base_url` dans la déclaration JSON, lève une erreur
   * explicite plutôt que de deviner un endpoint.
   */
  buildUrl(ctx: ProtocolContext): string {
    const baseUrl = ctx.familyConfig?.base_url;
    if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
      throw new Error(
        `[${PROTOCOL_NAME}] base_url absente : la déclaration de la famille dans ` +
          `models_config.json doit fournir familyConfig.base_url.`,
      );
    }
    // Retrait des slashs terminaux sans expression régulière (règle
    // sonarjs/super-linear-regex : boucle bornée par la longueur de l'entrée).
    let trimmed = baseUrl;
    while (trimmed.endsWith('/')) {
      trimmed = trimmed.slice(0, -1);
    }
    return `${trimmed}/messages`;
  },

  /**
   * Assemble le corps de la requête Messages.
   *
   * Le premier message `system` de l'historique est extrait dans le champ
   * `system` dédié et retiré de `messages` (comportement exact de
   * `adapters/anthropic.ts`) ; `max_tokens` retombe sur
   * {@link REQUIRED_MAX_TOKENS_FLOOR} faute de budget routeur. Les
   * `wireParams` autorisés sont fusionnés en dernier.
   */
  buildBody(ctx: ProtocolContext): Record<string, unknown> {
    const systemEntry = ctx.messages.find((m: ChatMessage) => m.role === 'system')?.content;
    const systemMessage = typeof systemEntry === 'string' ? systemEntry : '';

    const messages = convertMessagesForAnthropic(ctx.messages);

    const body: Record<string, unknown> = {
      model: ctx.model,
      max_tokens: ctx.options.max_tokens ?? REQUIRED_MAX_TOKENS_FLOOR,
      system: systemMessage,
      messages,
    };

    const tools = ctx.options.tools;
    if (tools?.length && anthropicCompatibleProtocol.supportsTools !== false) {
      body.tools = toAnthropicTools(tools);
    }

    // Dernier mot aux wireParams, restreints à l'allowlist déclarée.
    mergeWireParams(
      body,
      ctx.wireParams,
      anthropicCompatibleProtocol.wireParamKeys ?? WIRE_PARAM_KEYS,
    );

    return body;
  },

  /**
   * Convertit les blocs de la réponse Messages en `AdapterChatResult`.
   *
   * Chaque bloc `tool_use` redevient un `ToolCall` OpenAI (ID préservé,
   * `arguments` sérialisés). Le dernier bloc `text` fait foi pour `content`
   * (comportement historique de l'adapter). `usage` est normalisé vers
   * `prompt_tokens`/`completion_tokens`/`total_tokens`.
   *
   * INVARIANT : lève une erreur si la charge n'est pas un objet ou si
   * `content` n'est pas un tableau.
   */
  parseResponse(data: unknown): AdapterChatResult {
    if (data === null || typeof data !== 'object') {
      throw new Error(`[${PROTOCOL_NAME}] Réponse API invalide : objet JSON attendu.`);
    }

    const response = data as AnthropicResponse;
    if (!Array.isArray(response.content)) {
      throw new Error(`[${PROTOCOL_NAME}] Réponse API invalide : "content" n'est pas un tableau.`);
    }

    const conversion = convertResponseForAnthropic(data);
    const result: AdapterChatResult = {
      content: conversion.content,
      toolCalls: conversion.toolCalls,
    };
    if (conversion.thought) {
      result.thought = conversion.thought;
    }
    if (typeof response.stop_reason === 'string') {
      result.finishReason = response.stop_reason;
    }
    const usage = normalizeUsage(response.usage);
    if (usage) {
      result.usage = usage;
    }

    return result;
  },

  /**
   * Lève l'erreur métier d'une réponse non-2xx.
   *
   * Extrait `error.message` puis `message` ; le statut HTTP est toujours
   * présent dans le message levé — un 429 matche ainsi le
   * `QUOTA_ERROR_PATTERN` du routeur (`/429|rate|limit/`).
   */
  parseError(body: unknown, status: number): never {
    const parsed = (body ?? {}) as ApiErrorResponse;
    const detail = parsed.error?.message || parsed.message || 'corps de réponse illisible';
    throw new Error(`[${PROTOCOL_NAME}] Erreur HTTP ${status} : ${detail}`);
  },
};

export default anthropicCompatibleProtocol;
