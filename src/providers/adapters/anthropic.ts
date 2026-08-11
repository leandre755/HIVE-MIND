// providers/adapters/anthropic.ts
// Adaptateur pour Anthropic Claude (https://api.anthropic.com/v1/messages)
// Traduit le format OpenAI (entrée) vers le format Messages d'Anthropic, puis
// reconvertit les blocs `tool_use` en `tool_calls` OpenAI (sortie).

import type {
  AdapterChatOptions,
  AdapterChatResult,
  ApiErrorResponse,
  ChatMessage,
  ProviderAdapter,
  ToolDefinition,
  TokenUsage,
} from '../types.js';
import { requireModel } from '../requireModel.js';
import { mergeWireParams } from '../families/protocols/wireMerge.js';
import {
  convertMessagesForAnthropic,
  convertResponseForAnthropic,
} from '../families/protocols/messageConverter.js';

/**
 * Plafond de génération exigé par l'API Messages : `max_tokens` est un champ
 * obligatoire, sans valeur par défaut côté Anthropic. Utilisé seulement quand
 * ni `options.max_tokens` (budget routeur, throttling KKT compris) ni le
 * `max_tokens` filaire ne fournissent de valeur — la fusion des wireParams,
 * appliquée en dernier, prime sur ce plancher. Ce n'est pas un paramètre de
 * modèle mais une contrainte de protocole, d'où sa présence ici et non dans
 * `models_config.json`.
 */
const REQUIRED_MAX_TOKENS_FLOOR = 4096;

/**
 * Clés `wireParams` admises à la fusion dans le corps Messages, dans l'ordre
 * de déclaration. `top_p` et `top_k` couvrent les extensions futures du canal
 * filaire : `toWireParams` n'émet aujourd'hui que `max_tokens`, `temperature`
 * et `thinking`.
 */
const ANTHROPIC_WIRE_PARAM_KEYS: readonly string[] = [
  'thinking',
  'temperature',
  'max_tokens',
  'top_p',
  'top_k',
];

/**
 * Lit `options.wireParams` (clé de la signature d'index, posée par le routeur)
 * de façon défensive.
 *
 * Le canal filaire est un enrichissement optionnel : une clé absente ou une
 * valeur qui n'est pas un objet simple est ignorée silencieusement, jamais
 * traitée comme une erreur (les wireParams légitimes ont déjà été validés
 * fail-closed en amont par `validateParams`).
 *
 * @param options Options reçues du routeur.
 * @returns L'objet filaire, ou `undefined` s'il n'y a rien à fusionner.
 */
function readNativeWireParams(options: AdapterChatOptions): Record<string, unknown> | undefined {
  if (!Object.hasOwn(options, 'wireParams')) {
    return undefined;
  }
  const raw = Reflect.get(options, 'wireParams') as unknown;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  return raw as Record<string, unknown>;
}

/** Outil déclaré au format Anthropic (`input_schema` au lieu de `parameters`). */
interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

interface AnthropicMessage {
  role: string;
  content: string | unknown[] | null | undefined;
}

/**
 * Corps de `POST /v1/messages`, forme fermée étendue par les réglages filaires
 * admis (`thinking`, `temperature`). Alias d'objet littéral plutôt qu'
 * `interface` : la signature d'index implicite des types littéraux le rend
 * assignable au `Record<string, unknown>` exigé par `mergeWireParams`, tout en
 * restant fermé (aucune clé dynamique n'est statiquement déclarée).
 */
type AnthropicRequestBody = {
  model: string;
  max_tokens: number;
  system: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  thinking?: { type: string; budget_tokens: number };
  temperature?: number;
};

export default {
  name: 'anthropic',

  /**
   * Appel Claude.
   *
   * Ordre de précédence de `max_tokens` (Step 4 du plan de génération) : le
   * plancher {@link REQUIRED_MAX_TOKENS_FLOOR} d'abord, puis le budget routeur
   * (`options.max_tokens`, throttling KKT compris), puis les wireParams
   * validés EN DERNIER — `validateParams` a garanti que tout budget
   * `thinking.budget_tokens` filaire reste strictement inférieur au
   * `max_tokens` effectif post-bridage.
   */
  async chat(messages: ChatMessage[], options: AdapterChatOptions): Promise<AdapterChatResult> {
    const { model, apiKey, tools, max_tokens: maxTokens } = options;
    const modelId = requireModel(model, 'Anthropic Adapter');

    // Séparer le system des messages
    const systemEntry = messages.find((m: ChatMessage) => m.role === 'system')?.content;
    const systemMessage = typeof systemEntry === 'string' ? systemEntry : '';

    const chatMessages = convertMessagesForAnthropic(messages) as unknown as AnthropicMessage[];

    const body: AnthropicRequestBody = {
      model: modelId,
      // Plancher du protocole : repli quand ni le budget routeur ni le wire ne
      // fournissent de valeur. La fusion filaire, appliquée en dernier, prime.
      max_tokens: maxTokens ?? REQUIRED_MAX_TOKENS_FLOOR,
      system: systemMessage,
      messages: chatMessages,
    };

    // Convertir les tools au format Anthropic
    if (tools?.length) {
      body.tools = tools.map((t: ToolDefinition) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    // Dernier mot aux wireParams (Step 4 du plan) : une clé wire validée en
    // amont prime sur le plancher comme sur le budget routeur ; une valeur
    // `undefined` n'écrase jamais un champ explicite existant.
    mergeWireParams(body, readNativeWireParams(options), ANTHROPIC_WIRE_PARAM_KEYS);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey ?? '',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiErrorResponse;
      throw new Error(error.error?.message || 'Erreur Anthropic');
    }

    const data = (await response.json()) as Record<string, unknown>;
    const conversion = convertResponseForAnthropic(data);

    return {
      content: conversion.content,
      toolCalls: conversion.toolCalls,
      thought: conversion.thought,
      finishReason: typeof data['stop_reason'] === 'string' ? data['stop_reason'] : undefined,
      usage: data['usage'] as TokenUsage | undefined,
    };
  },
} satisfies ProviderAdapter;
