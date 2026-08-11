// providers/adapters/openai.ts
// Adaptateur pour OpenAI

import type {
  AdapterChatOptions,
  AdapterChatResult,
  ApiErrorResponse,
  ChatMessage,
  OpenAIChatRequestBody,
  OpenAIEmbeddingResponse,
  ProviderAdapter,
  TokenUsage,
} from '../types.js';
import { requireModel } from '../requireModel.js';
import { mergeWireParams } from '../families/protocols/wireMerge.js';
import {
  convertMessagesForOpenAI,
  convertResponseForOpenAI,
} from '../families/protocols/messageConverter.js';

/**
 * Longueur maximale d'entrée envoyée à l'endpoint d'embeddings. Contrainte de
 * protocole (fenêtre du tokenizer), pas un paramètre de modèle.
 */
const EMBED_INPUT_MAX_CHARS = 8000;

/**
 * Corps natif ChatCompletions de cet adapter : intersection du contrat partagé
 * `OpenAIChatRequestBody` (champs statiques typés) et d'une table
 * d'enregistrement, exigée par la signature `Record<string, unknown>` de
 * `mergeWireParams`. Les clés filaires additionnelles (`max_completion_tokens`,
 * `reasoning_effort`) ne sont jamais écrites statiquement ici : seule la fusion
 * allowlistée des wireParams les pose, via `Reflect.set`.
 */
type OpenAINativeRequestBody = OpenAIChatRequestBody & Record<string, unknown>;

/**
 * Clés `wireParams` admises à la fusion dans le corps ChatCompletions, dans
 * l'ordre de déclaration. `toWireParams` ne produit qu'UN seul champ de plafond
 * (`max_tokens` ou `max_completion_tokens`, selon la capacité déclarée du
 * modèle) : les deux noms sont listés pour couvrir les deux dialectes, ils ne
 * sont jamais écrits simultanément.
 */
const OPENAI_WIRE_PARAM_KEYS: readonly string[] = [
  'temperature',
  'max_tokens',
  'max_completion_tokens',
  'reasoning_effort',
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

export default {
  name: 'openai',

  /**
   * Appel chat completion.
   *
   * CHANGEMENT (Step 4 du plan de génération) : la température n'est plus
   * émise par défaut. Elle n'est posée dans le corps QUE si
   * `options.temperature` est un nombre ; en son absence, l'API applique sa
   * propre valeur par défaut — omission requise pour les modèles gpt-5, qui
   * rejettent toute `temperature` différente de leur défaut.
   *
   * Précédence finale : les `wireParams` validés en amont (fail-closed par
   * `validateParams`) priment sur les valeurs assemblées ici ; la fusion est
   * restreinte à l'allowlist {@link OPENAI_WIRE_PARAM_KEYS} et appliquée en
   * dernier, juste avant l'émission.
   */
  async chat(messages: ChatMessage[], options: AdapterChatOptions): Promise<AdapterChatResult> {
    const { model, apiKey, tools, temperature, max_tokens: maxTokens } = options;

    const wireMessages = convertMessagesForOpenAI(messages) as unknown as ChatMessage[];

    const body: OpenAINativeRequestBody = {
      model: requireModel(model, 'OpenAI Adapter'),
      messages: wireMessages,
    };

    // Température omise si absente (cf. JSDoc : défaut API, compatibilité gpt-5).
    if (typeof temperature === 'number') {
      body.temperature = temperature;
    }

    // Budget de génération imposé par le routeur (throttling KKT compris).
    // Omis si absent : l'API applique alors sa propre valeur par défaut.
    if (typeof maxTokens === 'number') {
      body.max_tokens = maxTokens;
    }

    // Ajouter les outils si présents
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    // Dernier mot aux wireParams : corps déjà assemblé, fusion allowlistée
    // juste avant l'émission (une clé wire validée prime sur le défaut
    // statique de l'adapter ; une valeur `undefined` n'écrase jamais).
    mergeWireParams(body, readNativeWireParams(options), OPENAI_WIRE_PARAM_KEYS);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiErrorResponse;
      throw new Error(error.error?.message || 'Erreur OpenAI');
    }

    const data = (await response.json()) as Record<string, unknown>;
    const conversion = convertResponseForOpenAI(data);
    const choices = data['choices'] as Record<string, unknown>[] | undefined;
    const firstChoice = choices?.[0];

    return {
      content: conversion.content,
      toolCalls: conversion.toolCalls,
      reasoningContent: conversion.reasoningContent,
      finishReason:
        typeof firstChoice?.['finish_reason'] === 'string'
          ? firstChoice['finish_reason']
          : undefined,
      usage: data['usage'] as TokenUsage | undefined,
    };
  },

  /**
   * Génère un embedding
   */
  async embed(text: string, options: AdapterChatOptions): Promise<number[]> {
    const { apiKey, model } = options;
    const modelId = requireModel(model, 'OpenAI Adapter (embed)');

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        input: text.substring(0, EMBED_INPUT_MAX_CHARS),
      }),
    });

    if (!response.ok) {
      throw new Error('Erreur embedding OpenAI');
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;
    return data.data[0].embedding;
  },
} satisfies ProviderAdapter;
