/**
 * Moteur du dialecte Gemini natif (`POST {base_url}/v1beta/models/{model}:generateContent`).
 *
 * Reproduit fidèlement l'API REST native de Google (`@google/genai` / AI
 * Studio) : `contents[].parts[]`, `systemInstruction`, `generationConfig`,
 * `tools[].functionDeclarations`, et la lecture `candidates[].content.parts[]`
 * avec `usageMetadata`. L'authentification passe par l'en-tête
 * `x-goog-api-key` (famille `headers/XGoogApiKeyHeaders.ts`).
 *
 * Module autonome : n'importe que les contrats routeur et les primitives
 * d'IDs de `../../toolIds.js` — aucun import depuis `src/providers/index.ts`.
 */

import { generateSafeToolId } from '../../toolIds.js';
import type {
  AdapterChatResult,
  ApiErrorResponse,
  ChatMessage,
  TokenUsage,
  ToolCall,
} from '../../types.js';
import type { ProtocolContext, ProtocolFamily, ProtocolOptions } from '../types.js';

/** Nom public du moteur, réutilisé dans tous les messages d'erreur. */
const PROTOCOL_NAME = 'gemini-native';

/** Budget HTTP par défaut, identique aux autres moteurs (60 s). */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Allowlist des clés `wireParams` recopiées dans `generationConfig`.
 * Elles reflètent les sorties de `toWireParams('gemini-native', …)`.
 */
const DEFAULT_WIRE_PARAM_KEYS: readonly string[] = [
  'temperature',
  'maxOutputTokens',
  'thinkingConfig',
  'topP',
  'topK',
  'stopSequences',
];

/** Une part du contenu d'un message Gemini (texte, média ou appel de fonction). */
interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  fileData?: { fileUri?: string };
  functionCall?: { name?: string; args?: unknown };
  functionResponse?: { name?: string; response?: unknown };
}

/** Message filaire Gemini : `user` ou `model`, jamais `system`/`tool`. */
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** Forme minimale de la réponse `generateContent` relue par le moteur. */
interface GeminiResponse {
  candidates?: {
    content?: { role?: string; parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/** Corps d'erreur natif Gemini : `{ error: { code, message, status } }`. */
interface GeminiErrorBody extends ApiErrorResponse {
  error?: { code?: number; message?: string; status?: string };
}

/** Lit les réglages de dialecte relayés par le `GenericProviderAdapter`. */
function readProtocolOptions(ctx: ProtocolContext): ProtocolOptions {
  return ctx.protocolOptions ?? {};
}

/** Normalise un identifiant modèle (`models/gemini-x` → `gemini-x`). */
function stripModelsPrefix(model: string): string {
  return model.startsWith('models/') ? model.slice('models/'.length) : model;
}

/** Construit `{base_url sans slash terminal}/v1beta/models/{model}:{action}`. */
function buildEndpoint(ctx: ProtocolContext, action: string): string {
  const baseUrl = ctx.familyConfig?.base_url;
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new Error(
      `[${PROTOCOL_NAME}] base_url absente : la déclaration de la famille dans ` +
        `models_config.json doit fournir familyConfig.base_url.`,
    );
  }
  let trimmed = baseUrl;
  while (trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }
  const model = encodeURIComponent(stripModelsPrefix(ctx.model));
  return `${trimmed}/v1beta/models/${model}:${action}`;
}

/**
 * Convertit une URL d'image en part Gemini : data URI → `inlineData`,
 * URL distante → `fileData` (formats natifs `@google/genai`).
 */
function imagePartFromUrl(url: string): GeminiPart {
  const base64Marker = ';base64,';
  const markerIdx = url.indexOf(base64Marker);
  if (url.startsWith('data:') && markerIdx > 'data:'.length) {
    return {
      inlineData: {
        mimeType: url.slice('data:'.length, markerIdx),
        data: url.slice(markerIdx + base64Marker.length),
      },
    };
  }
  return { fileData: { fileUri: url } };
}

/** Extrait le texte d'un contenu routeur (`string` ou parts multimodales). */
function contentToText(content: ChatMessage['content']): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  const texts: string[] = [];
  for (const part of content) {
    if (typeof part.text === 'string') texts.push(part.text);
  }
  return texts.join('');
}

/** Projette un contenu routeur en parts Gemini (texte + médias). */
function contentToGeminiParts(content: ChatMessage['content']): GeminiPart[] {
  if (content == null) return [];
  if (typeof content === 'string') {
    return content.length > 0 ? [{ text: content }] : [];
  }
  const parts: GeminiPart[] = [];
  for (const part of content) {
    if (typeof part.text === 'string') {
      parts.push({ text: part.text });
      continue;
    }
    const imageUrl: unknown = Reflect.get(part, 'image_url');
    const url: unknown =
      typeof imageUrl === 'object' && imageUrl !== null
        ? Reflect.get(imageUrl as Record<string, unknown>, 'url')
        : undefined;
    if (typeof url === 'string') {
      parts.push(imagePartFromUrl(url));
    }
  }
  return parts;
}

/** Parse les arguments d'un tool_call ; préserve le brut si le JSON casse. */
function parseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}') as unknown;
  } catch {
    return { raw };
  }
}

/**
 * Projette un message routeur en contenus Gemini.
 * `system` alimente `systemInstruction` (hors `contents`) ; `tool` devient un
 * tour `user` portant une `functionResponse`.
 */
function mapMessageToContents(
  message: ChatMessage,
  contents: GeminiContent[],
  systemTexts: string[],
): void {
  if (message.role === 'system') {
    const text = contentToText(message.content);
    if (text.length > 0) systemTexts.push(text);
    return;
  }

  if (message.role === 'tool') {
    contents.push({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: message.name ?? 'function',
            response: { content: contentToText(message.content) },
          },
        },
      ],
    });
    return;
  }

  const role: 'user' | 'model' = message.role === 'assistant' ? 'model' : 'user';
  const parts: GeminiPart[] = contentToGeminiParts(message.content);
  if (message.tool_calls?.length) {
    for (const toolCall of message.tool_calls) {
      parts.push({
        functionCall: {
          name: toolCall.function.name,
          args: parseToolArguments(toolCall.function.arguments),
        },
      });
    }
  }
  if (parts.length === 0) {
    parts.push({ text: '' });
  }
  contents.push({ role, parts });
}

/** Convertit la déclaration d'outils routeur en `functionDeclarations` Gemini. */
function mapToolsToFunctionDeclarations(tools: NonNullable<ProtocolContext['options']['tools']>) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

/** Reconvertit les `functionCall` bruts vers les `tool_calls` du contrat routeur. */
function parseFunctionCalls(parts: GeminiPart[]): ToolCall[] | null {
  const calls: ToolCall[] = [];
  for (const part of parts) {
    const fn = part.functionCall;
    if (!fn || typeof fn.name !== 'string') continue;
    const id = generateSafeToolId();
    calls.push({
      id,
      type: 'function',
      function: {
        name: fn.name,
        arguments: JSON.stringify(fn.args ?? {}),
      },
    });
  }
  return calls.length > 0 ? calls : null;
}

/**
 * Moteur singleton du dialecte Gemini natif.
 *
 * Enregistré dans `../registry.ts` sous la clé `gemini-native` ; les erreurs ne
 * remontent que par `throw`, jamais par un objet retourné.
 */
export const geminiNativeProtocol: ProtocolFamily = {
  name: PROTOCOL_NAME,
  supportsTools: true,
  wireParamKeys: [...DEFAULT_WIRE_PARAM_KEYS],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  extraHeaders: {},
  streamUsesBodyFlag: false,

  buildUrl(ctx: ProtocolContext): string {
    return buildEndpoint(ctx, 'generateContent');
  },

  buildStreamUrl(ctx: ProtocolContext): string {
    return `${buildEndpoint(ctx, 'streamGenerateContent')}?alt=sse`;
  },

  /**
   * Assemble le corps `generateContent`.
   *
   * Fusion (du moins prioritaire au plus prioritaire) : défauts de
   * `protocol_options` -> `options` -> `wireParams` filtrés par l'allowlist,
   * le tout dans `generationConfig`. Un champ absent n'est pas émis, laissant
   * l'API appliquer son défaut.
   */
  buildBody(ctx: ProtocolContext): Record<string, unknown> {
    const protocolOptions = readProtocolOptions(ctx);

    const contents: GeminiContent[] = [];
    const systemTexts: string[] = [];
    for (const message of ctx.messages) {
      mapMessageToContents(message, contents, systemTexts);
    }

    const generationConfig: Record<string, unknown> = {};
    for (const key of geminiNativeProtocol.wireParamKeys ?? DEFAULT_WIRE_PARAM_KEYS) {
      const wireValue = ctx.wireParams ? Reflect.get(ctx.wireParams, key) : undefined;
      if (wireValue !== undefined) {
        Reflect.set(generationConfig, key, wireValue);
      }
    }

    const temperature = ctx.options.temperature ?? protocolOptions.default_temperature;
    if (typeof temperature === 'number') {
      generationConfig.temperature = temperature;
    }
    const maxOutputTokens = ctx.options.max_tokens ?? protocolOptions.default_max_tokens;
    if (typeof maxOutputTokens === 'number' && generationConfig.maxOutputTokens === undefined) {
      generationConfig.maxOutputTokens = maxOutputTokens;
    }

    const body: Record<string, unknown> = { contents };
    if (systemTexts.length > 0) {
      body.systemInstruction = { parts: [{ text: systemTexts.join('\n\n') }] };
    }
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    const tools = ctx.options.tools;
    if (tools?.length && geminiNativeProtocol.supportsTools !== false) {
      body.tools = [{ functionDeclarations: mapToolsToFunctionDeclarations(tools) }];
      const toolChoice = protocolOptions.tool_choice ?? 'auto';
      if (toolChoice !== 'omit') {
        body.toolConfig = { functionCallingConfig: { mode: toolChoice.toUpperCase() } };
      }
    }

    return body;
  },

  /**
   * Convertit la réponse `generateContent` en `AdapterChatResult`.
   *
   * INVARIANT : lève une erreur si la charge n'est pas un objet, si
   * `candidates` est absent/vide, ou si le premier candidat n'a pas de
   * `content` — même contrat fail-closed que les autres moteurs.
   */
  parseResponse(data: unknown, _ctx: ProtocolContext): AdapterChatResult {
    if (data === null || typeof data !== 'object') {
      throw new Error(`[${PROTOCOL_NAME}] Réponse API invalide : objet JSON attendu.`);
    }

    const response = data as GeminiResponse;
    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw new Error(`[${PROTOCOL_NAME}] Réponse API invalide : aucun "candidate" retourné.`);
    }
    if (!candidate.content) {
      throw new Error(
        `[${PROTOCOL_NAME}] Réponse API invalide : "content" absent du premier candidat.`,
      );
    }

    const parts = candidate.content.parts ?? [];
    const texts: string[] = [];
    for (const part of parts) {
      if (typeof part.text === 'string') texts.push(part.text);
    }

    const result: AdapterChatResult = {
      content: texts.length > 0 ? texts.join('') : null,
      toolCalls: parseFunctionCalls(parts),
    };

    if (typeof candidate.finishReason === 'string') {
      result.finishReason = candidate.finishReason;
    }

    const usageMetadata = response.usageMetadata;
    if (usageMetadata) {
      const usage: TokenUsage = {
        prompt_tokens: usageMetadata.promptTokenCount ?? 0,
        completion_tokens: usageMetadata.candidatesTokenCount ?? 0,
        total_tokens: usageMetadata.totalTokenCount ?? 0,
      };
      result.usage = usage;
    }

    return result;
  },

  /**
   * Lève l'erreur métier d'une réponse non-2xx.
   *
   * Extrait `error.message` puis `message` ; le statut HTTP est toujours
   * présent dans le message levé — un 429 matche ainsi le `QUOTA_ERROR_PATTERN`
   * du routeur (`/429|rate|limit/`).
   */
  parseError(body: unknown, status: number): never {
    const parsed = (body ?? {}) as GeminiErrorBody;
    const detail = parsed.error?.message || parsed.message || 'corps de réponse illisible';
    throw new Error(`[${PROTOCOL_NAME}] Erreur HTTP ${status} : ${detail}`);
  },
};

export default geminiNativeProtocol;
