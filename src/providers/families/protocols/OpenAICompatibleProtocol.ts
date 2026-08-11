/**
 * Moteur du dialecte OpenAI ChatCompletions (`POST {base_url}/chat/completions`).
 *
 * Factorise la mécanique partagée des adapters historiques compatibles
 * OpenAI (groq, moonshot, github, kimi, openrouter, nvidia, mistral,
 * codestral…) : construction de l'URL, assemblage du corps (messages, tools,
 * passthrough, wireParams), lecture de la réponse et des erreurs.
 *
 * Les écarts de dialecte ne vivent plus dans le code mais dans les
 * `protocol_options` de `models_config.json` (relayés par le
 * `GenericProviderAdapter` via `ctx.protocolOptions`) et dans `wireParams`.
 *
 * Module autonome : n'importe que les contrats routeur et les primitives
 * d'IDs de `../../toolIds.js` — aucun import depuis `src/providers/index.ts`.
 */

import { generateSafeToolId, isValidToolId } from '../../toolIds.js';
import type {
  AdapterChatResult,
  ApiErrorResponse,
  ChatMessage,
  OpenAIResponseMessage,
  TokenUsage,
  ToolCall,
} from '../../types.js';
import type { ProtocolContext, ProtocolFamily, ProtocolOptions } from '../types.js';
import { mergeWireParams } from './wireMerge.js';

/** Nom public du moteur, réutilisé dans tous les messages d'erreur. */
const PROTOCOL_NAME = 'openai-compatible';

/** Budget HTTP par défaut, identique aux adapters historiques (60 s). */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Allowlist par défaut des clés `wireParams` fusionnées dans le corps.
 * `top_p` est volontairement hors du défaut : il transite par
 * `passthrough_options` quand une famille l'exige (cf. nvidia).
 */
const DEFAULT_WIRE_PARAM_KEYS: readonly string[] = [
  'temperature',
  'max_tokens',
  'max_completion_tokens',
  'reasoning_effort',
];

/** Corps d'erreur étendu : certains dialectes exposent `errors[]` (OpenAI). */
interface ProtocolErrorBody extends ApiErrorResponse {
  errors?: { message?: string }[];
}

/** Message de réponse étendu : OpenRouter expose la pensée sous `reasoning`. */
interface ProtocolResponseMessage extends OpenAIResponseMessage {
  reasoning?: string | null;
}

/** Forme minimale de la réponse `chat/completions` relue par le moteur. */
interface ProtocolChatResponse {
  choices?: { message?: ProtocolResponseMessage; finish_reason?: string }[];
  usage?: TokenUsage;
  /** Détail par modèle sous-jacent (Groq Compound), relayé sans interprétation. */
  usage_breakdown?: unknown;
}

/**
 * Lit les réglages de dialecte relayés par le `GenericProviderAdapter`.
 *
 * Source unique : `ctx.protocolOptions` (issu de la clé JSON
 * `protocol_options`, dont la forme a déjà été validée par l'adapter).
 * INVARIANT : retourne toujours un objet (vide si la famille n'en déclare
 * pas) — jamais de lecture directe dans `familyConfig`.
 *
 * @param ctx Contexte courant construit par l'adapter.
 */
function readProtocolOptions(ctx: ProtocolContext): ProtocolOptions {
  return ctx.protocolOptions ?? {};
}

/**
 * Réécrit les IDs de `tool_call` non conformes (9 caractères alphanumériques,
 * format Mistral/Codestral) et consigne la correspondance ancien -> nouveau
 * dans `idMap` pour réattribuer les réponses `tool`.
 *
 * Réplique la fonction privée de `adapters/mistral.ts` sur les primitives de
 * `../../toolIds.js`.
 */
function sanitizeToolCalls(toolCalls: ToolCall[], idMap: Map<string, string>): ToolCall[] {
  return toolCalls.map((tc) => {
    const safeId = isValidToolId(tc.id) ? tc.id : generateSafeToolId();
    if (safeId !== tc.id) {
      idMap.set(tc.id, safeId);
    }
    return { id: safeId, type: 'function', function: tc.function };
  });
}

/**
 * Sanitize les tool_call IDs au format Mistral/Codestral (9 caractères alphanumériques).
 *
 * Limitation connue: Si un fallback inter-famille survient en cours de conversation
 * multi-tours avec outils (ex: OpenAI vers Mistral après rate-limit), les IDs de tool_call
 * sont réécrits. Le message role:tool suivant cherche l'ancien ID via idMap.get(),
 * mais cette Map est locale à un seul appel buildBody(). Résultat: l'ID original est
 * perdu, le résultat d'outil devient orphelin.
 *
 * Mitigation: Éviter les fallbacks inter-familles en cours de boucle ReAct, ou
 * implémenter une persistance de l'idMap au niveau de la conversation (epic séparé).
 */
function sanitizeToolIdsInMessages(messages: ChatMessage[]): ChatMessage[] {
  const idMap = new Map<string, string>();

  return messages.flatMap((m): ChatMessage[] => {
    if (m.role === 'assistant') {
      const hasContent = m.content != null && m.content !== '';
      const hasToolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;

      if (hasContent && hasToolCalls) {
        // Éclatement : message texte puis message tool_calls sans contenu.
        const toolMessage: ChatMessage = {
          role: 'assistant',
          tool_calls: sanitizeToolCalls(m.tool_calls ?? [], idMap),
          content: null,
        };
        return [{ role: 'assistant', content: m.content }, toolMessage];
      }
      if (hasToolCalls) {
        return [
          {
            role: 'assistant',
            tool_calls: sanitizeToolCalls(m.tool_calls ?? [], idMap),
            content: null,
          },
        ];
      }
      return [{ role: 'assistant', content: m.content ?? '' }];
    }

    if (m.role === 'tool') {
      // Alignement de la réponse d'outil sur l'ID réécrit le cas échéant.
      const safeId = (m.tool_call_id && idMap.get(m.tool_call_id)) || m.tool_call_id;
      return [{ role: 'tool', tool_call_id: safeId, name: m.name, content: m.content }];
    }

    // System & user : passage direct.
    return [{ role: m.role, content: m.content }];
  });
}

/**
 * Projette les messages au format wire OpenAI.
 *
 * `messages_payload === 'role-content-only'` réduit chaque message à
 * `{ role, content }` (moonshot, github) ; le mode `'full'` préserve
 * `tool_calls`, `tool_call_id` et, si `relay_reasoning_content` est activé,
 * `reasoning_content` (kimi, DeepSeek R1 via Groq).
 */
function mapMessages(messages: ChatMessage[], protocolOptions: ProtocolOptions): ChatMessage[] {
  if (protocolOptions.messages_payload === 'role-content-only') {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }

  const relayReasoning = protocolOptions.relay_reasoning_content === true;
  return messages.map((m) => {
    const wire: ChatMessage = { role: m.role, content: m.content };
    if (m.tool_calls) {
      wire.tool_calls = m.tool_calls;
    }
    if (m.tool_call_id) {
      wire.tool_call_id = m.tool_call_id;
    }
    if (relayReasoning && m.reasoning_content) {
      wire.reasoning_content = m.reasoning_content;
    }
    return wire;
  });
}

/** Vrai si le modèle déclenche l'omission des tools (cas groq compound). */
function shouldOmitTools(model: string, protocolOptions: ProtocolOptions): boolean {
  const needles = protocolOptions.omit_tools_if_model_contains;
  if (!Array.isArray(needles)) {
    return false;
  }
  return needles.some((needle) => model.includes(needle));
}

/**
 * Résout la valeur de `tool_choice` à émettre selon la politique déclarée :
 * `'auto'` par défaut, `'gpt-only'` restreint aux modèles `gpt*` (github),
 * `'omit'` jamais. `undefined` signifie « ne pas émettre le champ ».
 */
function resolveToolChoice(model: string, protocolOptions: ProtocolOptions): string | undefined {
  const mode = protocolOptions.tool_choice ?? 'auto';
  if (mode === 'omit') {
    return undefined;
  }
  if (mode === 'gpt-only') {
    return model.startsWith('gpt') ? 'auto' : undefined;
  }
  return 'auto';
}

/**
 * Recopie telles quelles dans le corps les clés d'`options` listées par
 * `passthrough_options` (ex. `reasoning` OpenRouter, `chat_template_kwargs`
 * NVIDIA). Les accès dynamiques passent par `Object.hasOwn`/`Reflect`
 * (convention sécurité du dépôt).
 */
function applyPassthroughOptions(
  ctx: ProtocolContext,
  body: Record<string, unknown>,
  protocolOptions: ProtocolOptions,
): void {
  const keys = protocolOptions.passthrough_options;
  if (!Array.isArray(keys)) {
    return;
  }
  for (const key of keys) {
    if (Object.hasOwn(ctx.options, key)) {
      const value = Reflect.get(ctx.options, key) as unknown;
      if (value !== undefined) {
        Reflect.set(body, key, value);
      }
    }
  }
}

/** Reconvertit les `tool_calls` bruts de la réponse vers le contrat routeur. */
function parseToolCalls(toolCalls: ToolCall[] | null | undefined): ToolCall[] | null {
  if (!toolCalls?.length) {
    return null;
  }
  return toolCalls.map((tc) => ({
    id: tc.id,
    type: tc.type || 'function',
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments,
    },
  }));
}

/**
 * Moteur singleton du dialecte OpenAI ChatCompletions.
 *
 * Enregistré auprès du routeur via son export par défaut ; les erreurs ne
 * remontent que par `throw`, jamais par un objet retourné.
 */
export const openAICompatibleProtocol: ProtocolFamily = {
  name: PROTOCOL_NAME,
  supportsTools: true,
  wireParamKeys: [...DEFAULT_WIRE_PARAM_KEYS],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  extraHeaders: {},

  /**
   * Construit `{base_url sans slash terminal}/chat/completions`.
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
    return `${trimmed}/chat/completions`;
  },

  /**
   * Assemble le corps de la requête ChatCompletions.
   *
   * Ordre de fusion (du moins prioritaire au plus prioritaire) : champs de
   * base -> `extra_body` -> `passthrough_options` -> `wireParams` filtré par
   * l'allowlist `wireParamKeys`. Un champ absent de `options` et de
   * `protocolOptions` n'est pas émis, laissant l'API appliquer son défaut.
   */
  buildBody(ctx: ProtocolContext): Record<string, unknown> {
    const protocolOptions = readProtocolOptions(ctx);

    const sourceMessages =
      protocolOptions.sanitize_tool_ids === true
        ? sanitizeToolIdsInMessages(ctx.messages)
        : ctx.messages;

    const body: Record<string, unknown> = {
      model: ctx.model,
      messages: mapMessages(sourceMessages, protocolOptions),
    };

    const temperature = ctx.options.temperature ?? protocolOptions.default_temperature;
    if (typeof temperature === 'number') {
      body.temperature = temperature;
    }

    const maxTokens = ctx.options.max_tokens ?? protocolOptions.default_max_tokens;
    if (typeof maxTokens === 'number') {
      body.max_tokens = maxTokens;
    }

    // Tools : omis si le moteur ne les supporte pas ou si le modèle déclenche
    // une règle d'omission (groq/compound ne supporte pas les custom tools).
    const tools = ctx.options.tools;
    if (
      tools?.length &&
      openAICompatibleProtocol.supportsTools !== false &&
      !shouldOmitTools(ctx.model, protocolOptions)
    ) {
      body.tools = tools;
      const toolChoice = resolveToolChoice(ctx.model, protocolOptions);
      if (toolChoice) {
        body.tool_choice = toolChoice;
      }
    }

    if (protocolOptions.extra_body) {
      Object.assign(body, protocolOptions.extra_body);
    }

    applyPassthroughOptions(ctx, body, protocolOptions);

    // Dernier mot aux wireParams, restreints à l'allowlist déclarée.
    mergeWireParams(
      body,
      ctx.wireParams,
      openAICompatibleProtocol.wireParamKeys ?? DEFAULT_WIRE_PARAM_KEYS,
    );

    return body;
  },

  /**
   * Convertit la réponse ChatCompletions en `AdapterChatResult`.
   *
   * INVARIANT : lève une erreur si la charge n'est pas un objet, si
   * `choices` est absent/vide, ou si le premier choix n'a pas de `message`.
   * Les champs optionnels (`reasoningContent`, `executedTools`,
   * `usageBreakdown`) ne sont exposés que lorsqu'ils sont présents dans la
   * réponse.
   */
  parseResponse(data: unknown, ctx: ProtocolContext): AdapterChatResult {
    if (data === null || typeof data !== 'object') {
      throw new Error(`[${PROTOCOL_NAME}] Réponse API invalide : objet JSON attendu.`);
    }

    const response = data as ProtocolChatResponse;
    if (!Array.isArray(response.choices) || response.choices.length === 0) {
      throw new Error(`[${PROTOCOL_NAME}] Réponse API invalide : aucun "choice" retourné.`);
    }

    const message = response.choices[0]?.message;
    if (!message) {
      throw new Error(
        `[${PROTOCOL_NAME}] Réponse API invalide : "message" absent du premier choix.`,
      );
    }

    const protocolOptions = readProtocolOptions(ctx);
    const choice = response.choices[0];

    const result: AdapterChatResult = {
      content: message.content ?? null,
      toolCalls: parseToolCalls(message.tool_calls),
    };

    if (typeof choice.finish_reason === 'string') {
      result.finishReason = choice.finish_reason;
    }
    if (response.usage) {
      result.usage = response.usage;
    }
    if (protocolOptions.extract_reasoning_content === true) {
      result.reasoningContent = message.reasoning_content ?? message.reasoning ?? null;
    }
    if (message.executed_tools) {
      result.executedTools = message.executed_tools;
    }
    if (response.usage_breakdown) {
      result.usageBreakdown = response.usage_breakdown;
    }

    return result;
  },

  /**
   * Lève l'erreur métier d'une réponse non-2xx.
   *
   * Extrait `error.message`, `errors[0].message` puis `message` ; le statut
   * HTTP est toujours présent dans le message levé — un 429 matche ainsi le
   * `QUOTA_ERROR_PATTERN` du routeur (`/429|rate|limit/`).
   */
  parseError(body: unknown, status: number): never {
    const parsed = (body ?? {}) as ProtocolErrorBody;
    const detail =
      parsed.error?.message ||
      (Array.isArray(parsed.errors) ? parsed.errors[0]?.message : undefined) ||
      parsed.message ||
      'corps de réponse illisible';
    throw new Error(`[${PROTOCOL_NAME}] Erreur HTTP ${status} : ${detail}`);
  },
};

export default openAICompatibleProtocol;
