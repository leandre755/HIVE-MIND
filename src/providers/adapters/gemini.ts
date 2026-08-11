// providers/adapters/gemini.ts
// providers/adapters/gemini.js
// Adaptateur pour Google Gemini

import { randomUUID } from 'node:crypto';
import { requireModel } from '../requireModel.js';
import type {
  AdapterChatOptions,
  AdapterChatResult,
  ChatContentPart,
  ChatMessage,
  ProviderAdapter,
  ToolCall,
} from '../types.js';
import type {
  GeminiContent,
  GeminiErrorResponse,
  GeminiGenerateContentResponse,
  GeminiGenerationConfig,
  GeminiPart,
  GeminiRequestBody,
} from '../geminiTypes.js';

/**
 * Plafond de génération appliqué en repli, quand ni `options.max_tokens`
 * (budget routeur, throttling KKT compris) ni le `maxOutputTokens` filaire ne
 * fournissent de valeur. Valeur historique de cet adapter, conservée pour ne
 * pas changer le comportement réseau par défaut.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 1000;

/** Température par défaut, identique à la valeur historique de l'adapter. */
const DEFAULT_TEMPERATURE = 0.7;

/** Bloc image au format OpenAI, tel que produit en amont par le bot. */
interface OpenAIImagePart extends ChatContentPart {
  type: 'image_url';
  image_url: { url: string };
}

/** Vrai si le fragment est un bloc image au format OpenAI convertible. */
function isOpenAIImagePart(part: ChatContentPart): part is OpenAIImagePart {
  if (part.type !== 'image_url') return false;
  const candidate = part['image_url'];
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { url?: unknown }).url === 'string'
  );
}

/**
 * Convertit un fragment de contenu OpenAI en `part` Gemini.
 *
 * Un bloc image dont l'URL n'est pas une donnée base64 inline retombe sur la
 * sérialisation JSON : l'API REST n'accepte pas d'URL distante dans
 * `inline_data`, et un fragment muet perdrait l'information.
 */
function toGeminiPart(block: ChatContentPart): GeminiPart {
  if (block.type === 'text') {
    return { text: block.text };
  }
  if (isOpenAIImagePart(block)) {
    const base64Match = block.image_url.url.match(/^data:image\/(\w+);base64,(.+)$/);
    if (base64Match) {
      return {
        inline_data: {
          mime_type: `image/${base64Match[1]}`,
          data: base64Match[2],
        },
      };
    }
  }
  return { text: JSON.stringify(block) }; // Fallback
}

/**
 * Construit le tour `model` d'un message assistant.
 *
 * L'ordre texte → pensée → appels de fonction est significatif pour les
 * modèles « Thinking » : le texte porte le cheminement qui justifie l'appel.
 */
function toModelContent(m: ChatMessage): GeminiContent {
  const parts: GeminiPart[] = [];

  // 1. D'abord le texte/pensée (S'il existe)
  // C'est CRUCIAL pour les modèles "Thinking" (Gemini 2.0/3.0)
  // Le texte contient le cheminement de pensée qui justifie l'appel de fonction
  if (typeof m.content === 'string' && m.content) {
    parts.push({ text: m.content });
  }

  // [FIX] Gérer explicitement le bloc "thought" pour les modèles Thinking
  if (m.thought) {
    parts.push({ thought: m.thought });
  }

  // 2. Ensuite les appels de fonction
  for (const tc of m.tool_calls ?? []) {
    const part: GeminiPart = {
      functionCall: {
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      },
    };

    // Réinjecter le thought_signature
    if (tc.thought_signature) {
      part.thoughtSignature = tc.thought_signature;
      part.thought_signature = tc.thought_signature;
    }
    parts.push(part);
  }

  // Si on a des parts (texte ou tools), on retourne le message modèle
  if (parts.length > 0) {
    return { role: 'model', parts };
  }
  // Sinon (cas rare message vide), on renvoie un texte vide pour éviter erreur
  return { role: 'model', parts: [{ text: '' }] };
}

/** Convertit un message du routeur en tour de conversation Gemini. */
function toGeminiContent(m: ChatMessage): GeminiContent {
  if (m.role === 'assistant') {
    return toModelContent(m);
  }

  // 2. Résultat d'outil (Role: tool)
  if (m.role === 'tool') {
    return {
      role: 'function',
      parts: [
        {
          functionResponse: {
            name: m.name, // Nom de la fonction (stocké dans le message par le Core)
            response: {
              name: m.name,
              content: m.content, // Le contenu textuel ou JSON
            },
          },
        },
      ],
    };
  }

  // 3. User & Assistant Standard (Texte OU Multimodal)
  // Gemini supporte le multimodal via parts: [{ text: "..." }, { inline_data: {...} }]
  const parts: GeminiPart[] = Array.isArray(m.content)
    ? m.content.map(toGeminiPart) // MULTIMODAL : Convertir le format OpenAI vers Gemini
    : [{ text: m.content ?? '' }]; // TEXTE SIMPLE

  return { role: 'user', parts };
}

/**
 * Extrait l'empreinte de pensée d'un fragment d'appel de fonction.
 *
 * Les modèles Gemini la placent selon leur version à l'un des cinq
 * emplacements sondés ici ; la réinjecter est nécessaire pour que le tour
 * suivant conserve le raisonnement.
 */
function extractThoughtSignature(part: GeminiPart): string | undefined {
  const fromPart = part.thoughtSignature ?? part.thought_signature;
  if (fromPart) return fromPart;
  if (typeof part.thought === 'string' && part.thought) return part.thought;
  return part.functionCall?.thoughtSignature ?? part.functionCall?.thought_signature;
}

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

/**
 * Vrai si la valeur brute a la forme d'un bloc `thinkingConfig` Gemini.
 *
 * Défense de bordure : le canal amont est validé fail-closed, mais un appel
 * direct hors routeur ne doit pas pouvoir poser une forme inattendue dans
 * `generationConfig`.
 */
function isGeminiThinkingConfig(
  value: unknown,
): value is NonNullable<GeminiGenerationConfig['thinkingConfig']> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const includeThoughts = record['includeThoughts'];
  const thinkingBudget = record['thinkingBudget'];
  const includeThoughtsOk = includeThoughts === undefined || typeof includeThoughts === 'boolean';
  const budgetOk = thinkingBudget === undefined || typeof thinkingBudget === 'number';
  return includeThoughtsOk && budgetOk;
}

/**
 * Fusionne des wireParams Gemini dans un `generationConfig`, CHAMP PAR CHAMP
 * et sous allowlist fermée : `maxOutputTokens`, `temperature`, `thinkingConfig`.
 *
 * Le wire n'est JAMAIS étalé en bloc dans la structure typée : seules les clés
 * déclarées, présentes et bien formées sont appliquées, et une valeur absente
 * ou invalide n'écrase jamais un réglage explicite existant (les wireParams
 * légitimes ont précédence sur les défauts de l'adapter — arbitrage du Step 4
 * du plan de génération).
 *
 * @param config Réglages de génération en cours d'assemblage (mutés en place).
 * @param wire WireParams lus via {@link readNativeWireParams}.
 */
function applyGenerationConfigWire(
  config: GeminiGenerationConfig,
  wire: Record<string, unknown> | undefined,
): void {
  if (wire === undefined) {
    return;
  }
  if (Object.hasOwn(wire, 'maxOutputTokens')) {
    const value = Reflect.get(wire, 'maxOutputTokens') as unknown;
    if (typeof value === 'number' && Number.isFinite(value)) {
      config.maxOutputTokens = value;
    }
  }
  if (Object.hasOwn(wire, 'temperature')) {
    const value = Reflect.get(wire, 'temperature') as unknown;
    if (typeof value === 'number' && Number.isFinite(value)) {
      config.temperature = value;
    }
  }
  if (Object.hasOwn(wire, 'thinkingConfig')) {
    const value = Reflect.get(wire, 'thinkingConfig') as unknown;
    if (isGeminiThinkingConfig(value)) {
      config.thinkingConfig = value;
    }
  }
}

const geminiAdapter: ProviderAdapter = {
  name: 'gemini',

  /**
   * Appel `generateContent` de l'API Generative Language.
   *
   * Budget de génération (correction Step 4 du plan) : le défaut historique
   * {@link DEFAULT_MAX_OUTPUT_TOKENS} d'abord, puis `options.max_tokens` si
   * nombre, puis les wireParams validés en dernier — le throttling budgétaire
   * KKT (`max_tokens` routeur post-bridage) redevient effectif pour Gemini,
   * après avoir été ignoré par un plafond fixe de 1000.
   *
   * INVARIANT : retourne toujours un `AdapterChatResult` dont `content` est une
   * chaîne non vide ou `null` ; tout échec HTTP ou réponse sans candidat lève.
   *
   * @throws {Error} Modèle absent, statut HTTP non 2xx, ou réponse sans candidat.
   */
  async chat(messages: ChatMessage[], options: AdapterChatOptions): Promise<AdapterChatResult> {
    const {
      model,
      apiKey,
      tools,
      temperature = DEFAULT_TEMPERATURE,
      max_tokens: maxTokens,
    } = options;
    const modelId = requireModel(model, 'Gemini Adapter');

    // Convertir les messages au format Gemini
    const contents = messages.filter((m) => m.role !== 'system').map(toGeminiContent);

    // Extraire le system prompt
    const systemMessage = messages.find((m) => m.role === 'system');
    const systemInstruction =
      typeof systemMessage?.content === 'string' ? systemMessage.content : undefined;

    // Ordre de précédence : défaut historique -> budget routeur (throttling
    // KKT compris) -> wireParams validés, fusionnés en dernier champ par champ.
    const generationConfig: GeminiGenerationConfig = {
      temperature,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    };
    if (typeof maxTokens === 'number') {
      generationConfig.maxOutputTokens = maxTokens;
    }
    applyGenerationConfigWire(generationConfig, readNativeWireParams(options));

    const body: GeminiRequestBody = {
      contents,
      generationConfig,
    };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    // Convertir les tools au format Gemini
    if (tools?.length) {
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          })),
        },
      ];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response.json()) as GeminiErrorResponse;
      throw new Error(error.error?.message ?? 'Erreur Gemini');
    }

    const data = (await response.json()) as GeminiGenerateContentResponse;
    const candidate = data.candidates?.[0];

    if (!candidate) {
      console.error('[Gemini] RAW Response (No Candidate):', JSON.stringify(data, null, 2));
      throw new Error('Pas de réponse Gemini');
    }

    // Extraire le contenu (Extraction multi-parts)
    const parts = candidate.content?.parts ?? [];

    // 1. Concaténer tout le contenu texte
    const textContent = parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join('\n')
      .trim();

    // [FIX] Extraire le bloc "thought" s'il existe (Gemini 2.0 Thinking)
    const thoughtPart = parts.find((p) => typeof p.thought === 'string' && p.thought);
    const thoughtContent = typeof thoughtPart?.thought === 'string' ? thoughtPart.thought : null;

    // 2. Chercher les appels de fonction
    const functionCallPart = parts.find((p) => p.functionCall);

    // Convertir functionCall au format OpenAI tool_calls
    let toolCalls: ToolCall[] | null = null;
    if (functionCallPart?.functionCall) {
      // Extraction robuste de la pensée (thought)
      const thoughtSig = extractThoughtSignature(functionCallPart);

      toolCalls = [
        {
          id: `call_${randomUUID()}`,
          type: 'function',
          function: {
            name: functionCallPart.functionCall.name,
            arguments: JSON.stringify(functionCallPart.functionCall.args),
          },
          thought_signature: thoughtSig,
        },
      ];
    }

    return {
      content: textContent || null,
      thought: thoughtContent,
      toolCalls,
      finishReason: candidate.finishReason,
      usage: data.usageMetadata,
    };
  },
};

export default geminiAdapter;
