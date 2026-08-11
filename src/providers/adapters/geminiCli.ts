// providers/adapters/geminiCli.ts
// Adaptateur pour Google Gemini CLI avec authentification OAuth officielle et quotas dédiés.

import { Buffer } from 'buffer';
import { randomUUID } from 'node:crypto';
import type {
  AdapterChatOptions,
  AdapterChatResult,
  ChatContentPart,
  ChatMessage,
  ProviderAdapter,
  ToolCall,
  ToolDefinition,
} from '../types.js';
import type {
  CodeAssistRequestWrapper,
  CodeAssistResponse,
  GeminiContent,
  GeminiPart,
  GeminiRequestBody,
  GeminiSchema,
  GeminiToolBlock,
  GoogleJwtPayload,
  GoogleOAuthTokenResponse,
  LoadCodeAssistResponse,
} from '../geminiTypes.js';
import { requireModel } from '../requireModel.js';

// --- CONFIGURATION D'AUTHENTIFICATION (IDENTIFIANTS GOOGLE OAUTH CLIENT) ---
// Note de sécurité : Le "Client ID" est un identifiant public permettant à Google de reconnaître l'application client.
// Il est chargé depuis .env pour des raisons de conformité technique (Push Protection).
const CLIENT_ID = process.env.GE_CLIENT_ID || '';

// Le "Client Secret" de l'application est privé et sensible. Il est importé de manière étanche depuis les variables d'environnement.
const CLIENT_SECRET = process.env.GE_CLIENT_SECRET || '';

// L'identifiant du projet Google Cloud ciblé.
const DEFAULT_PROJECT_ID = process.env.GE_DEFAULT_PROJECT_ID || 'rising-fact-p41fc';

/** Marge avant expiration en deçà de laquelle le jeton est renouvelé (secondes). */
const REFRESH_MARGIN_SECONDS = 300;

/** Plafond de génération, valeur historique de l'adapter. */
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/** Température par défaut, valeur historique de l'adapter. */
const DEFAULT_TEMPERATURE = 0.7;

/** Types acceptés par le dialecte de schéma Gemini. Tout autre type devient `STRING`. */
const VALID_SCHEMA_TYPES = ['OBJECT', 'STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY'];

/** Extrait le type MIME et la charge base64 d'une URL `data:`. */
const INLINE_IMAGE_PATTERN = /^data:image\/(\w+);base64,(.+)$/;

interface TokenData {
  accessToken: string | null;
  refreshToken: string | null;
  projectId: string | null;
}

/**
 * Décode un JWT pour inspecter son expiration.
 *
 * INVARIANT : retourne `null` — jamais une exception — pour toute entrée
 * malformée. L'appelant traite `null` comme « renouvellement nécessaire ».
 */
function decodeJwt(token: string): GoogleJwtPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const decoded = Buffer.from(parts[1], 'base64').toString('utf8');
    return JSON.parse(decoded) as GoogleJwtPayload;
  } catch {
    return null;
  }
}

function loadLocalTokens(): TokenData {
  const accessToken = process.env.GEMINI_CLI_ACCESS_TOKEN || null;
  const refreshToken = process.env.GEMINI_CLI_REFRESH_TOKEN || null;
  const projectId = process.env.GE_DEFAULT_PROJECT_ID || null;
  return { accessToken, refreshToken, projectId };
}

function saveLocalTokens(tokens: {
  access_token: string;
  refresh_token: string;
  project_id?: string;
}): void {
  if (process.env.NODE_ENV === 'test') return;
  process.env.GEMINI_CLI_ACCESS_TOKEN = tokens.access_token;
  if (tokens.refresh_token) {
    process.env.GEMINI_CLI_REFRESH_TOKEN = tokens.refresh_token;
  }
  if (tokens.project_id) {
    process.env.GE_DEFAULT_PROJECT_ID = tokens.project_id;
  }
}

function isTokenExpired(accessToken: string | null): boolean {
  if (!accessToken) return true;
  const payload = decodeJwt(accessToken);
  if (!payload || typeof payload.exp !== 'number') return true;
  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp - nowSec < REFRESH_MARGIN_SECONDS;
}

async function refreshOAuthToken(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token: string }> {
  if (!refreshToken) throw new Error('Invalid refresh token');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GoogleOAuthTokenResponse;
  if (!data.access_token) throw new Error('No access token in Google OAuth response');
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
  };
}

async function resolveGoogleProject(accessToken: string, endpoint: string): Promise<string> {
  if (!accessToken) throw new Error('Invalid access token');
  if (!endpoint) throw new Error('Invalid endpoint');
  try {
    const res = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GeminiCLI/1.0.0',
      },
      body: JSON.stringify({
        metadata: { ideType: 'GEMINI_CLI', platform: 'PLATFORM_UNSPECIFIED' },
      }),
    });
    if (!res.ok) return DEFAULT_PROJECT_ID;
    const data = (await res.json()) as LoadCodeAssistResponse;
    const project = data?.cloudaicompanionProject;
    if (typeof project === 'string') return project || DEFAULT_PROJECT_ID;
    return project?.id || DEFAULT_PROJECT_ID;
  } catch {
    return DEFAULT_PROJECT_ID;
  }
}

async function getTokens(endpoint: string): Promise<{ accessToken: string; projectId: string }> {
  if (!endpoint) throw new Error('Invalid endpoint parameter');
  const tokens = loadLocalTokens();
  if (!tokens.refreshToken) {
    throw new Error('Gemini CLI refresh token missing from environment');
  }
  let accessToken = tokens.accessToken;
  let refreshToken = tokens.refreshToken;
  let projectId = tokens.projectId;

  if (isTokenExpired(accessToken)) {
    const refreshed = await refreshOAuthToken(refreshToken);
    accessToken = refreshed.access_token;
    refreshToken = refreshed.refresh_token;
    if (!projectId) {
      projectId = await resolveGoogleProject(accessToken, endpoint);
    }
    saveLocalTokens({
      access_token: accessToken,
      refresh_token: refreshToken,
      project_id: projectId,
    });
  }

  if (!accessToken) {
    throw new Error('Gemini CLI access token unavailable after refresh');
  }
  return { accessToken, projectId: projectId || DEFAULT_PROJECT_ID };
}

function cleanType(type: unknown): string | undefined {
  if (typeof type !== 'string') return undefined;
  const mapped = type.toUpperCase();
  return VALID_SCHEMA_TYPES.includes(mapped) ? mapped : 'STRING';
}

function cleanProperties(properties: unknown): Record<string, GeminiSchema> | undefined {
  if (!properties || typeof properties !== 'object') return undefined;
  // `Map` puis reconstruction : un accès `clean[key]` déclencherait
  // `security/detect-object-injection` sur une clé dynamique.
  const clean = new Map<string, GeminiSchema>();
  for (const [key, val] of Object.entries(properties)) {
    clean.set(key, cleanSchema(val));
  }
  return Object.fromEntries(clean);
}

/**
 * Normalise un schéma JSON Schema vers le dialecte Gemini.
 *
 * Un schéma absent devient `{ type: 'STRING' }` : l'API rejette une
 * déclaration d'outil dont les paramètres n'ont pas de type.
 */
function cleanSchema(schema: unknown): GeminiSchema {
  if (!schema || typeof schema !== 'object') return { type: 'STRING' };
  const source = schema as Record<string, unknown>;
  const result: GeminiSchema = {};
  const type = cleanType(source.type);
  if (type) result.type = type;
  if (typeof source.description === 'string' && source.description) {
    result.description = source.description;
  }
  const cleanedProps = cleanProperties(source.properties);
  if (cleanedProps) result.properties = cleanedProps;
  if (source.items && typeof source.items === 'object') {
    result.items = cleanSchema(source.items);
  }
  if (Array.isArray(source.required)) {
    result.required = source.required.filter((item): item is string => typeof item === 'string');
  }
  if (Array.isArray(source.enum)) {
    result.enum = source.enum.map((entry) => String(entry));
  }
  return result;
}

/**
 * Réduit un contenu de message à du texte.
 *
 * L'API n'accepte qu'une chaîne dans `part.text` ; un contenu multimodal
 * (tableau de fragments) est concaténé.
 */
function flattenContent(content: string | ChatContentPart[] | null | undefined): string {
  if (Array.isArray(content)) {
    return content.map((part) => part.text || '').join('\n');
  }
  return typeof content === 'string' ? content : '';
}

/**
 * Désérialise les arguments d'un appel d'outil.
 *
 * Les arguments transitent en JSON sérialisé côté OpenAI alors que l'API
 * Gemini attend un objet. Un JSON invalide produit un objet vide plutôt qu'une
 * exception : perdre les arguments d'un appel est moins destructeur
 * qu'interrompre la conversation entière.
 */
function parseToolArguments(rawArguments: unknown): Record<string, unknown> {
  if (rawArguments && typeof rawArguments === 'object') {
    return rawArguments as Record<string, unknown>;
  }
  if (typeof rawArguments !== 'string') return {};
  try {
    return JSON.parse(rawArguments) as Record<string, unknown>;
  } catch {
    console.warn('[GeminiCLI] Arguments de tool_call JSON invalides, objet vide transmis.');
    return {};
  }
}

function mapAssistantMessage(msg: ChatMessage): GeminiContent {
  const parts: GeminiPart[] = [];
  if (msg.content) parts.push({ text: flattenContent(msg.content) });
  if (msg.thought) parts.push({ thought: msg.thought });

  (msg.tool_calls ?? []).forEach((tc, index) => {
    const part: GeminiPart = {
      functionCall: { name: tc.function.name, args: parseToolArguments(tc.function.arguments) },
    };
    if (index === 0) {
      // L'API exige une signature de pensée sur le premier appel d'un tour ;
      // le jeton littéral la court-circuite quand le modèle n'en a pas fourni.
      const signature = tc.thought_signature || 'skip_thought_signature_validator';
      part.thoughtSignature = signature;
      part.thought_signature = signature;
    }
    parts.push(part);
  });

  return { role: 'model', parts: parts.length > 0 ? parts : [{ text: '' }] };
}

function mapToolMessage(msg: ChatMessage): GeminiContent {
  if (!msg.name) throw new Error('Tool message missing name');
  const responseContent = typeof msg.content === 'string' ? { content: msg.content } : msg.content;
  return {
    role: 'function',
    parts: [
      {
        functionResponse: {
          name: msg.name,
          response: { name: msg.name, content: responseContent },
        },
      },
    ],
  };
}

/** Vrai si le fragment porte une `image_url` exploitable. */
function hasImageUrl(block: ChatContentPart): block is ChatContentPart & {
  image_url: { url: string };
} {
  const candidate = block['image_url'];
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { url?: unknown }).url === 'string'
  );
}

function mapUserMessage(msg: ChatMessage): GeminiContent {
  const parts: GeminiPart[] = [];
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'image_url' && hasImageUrl(block)) {
        const match = INLINE_IMAGE_PATTERN.exec(block.image_url.url);
        if (match) parts.push({ inline_data: { mime_type: `image/${match[1]}`, data: match[2] } });
      }
    }
  } else {
    parts.push({ text: flattenContent(msg.content) });
  }
  return { role: msg.role === 'assistant' ? 'model' : 'user', parts };
}

function mapMessages(messages: ChatMessage[]): GeminiContent[] {
  if (messages.length === 0) throw new Error('Messages cannot be empty');
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'assistant') return mapAssistantMessage(m);
      if (m.role === 'tool') return mapToolMessage(m);
      return mapUserMessage(m);
    });
}

function formatTools(tools: ToolDefinition[]): GeminiToolBlock[] | undefined {
  if (tools.length === 0) return undefined;
  const functionDeclarations = tools.map((t) => {
    if (!t.function || typeof t.function !== 'object') throw new Error('Invalid tool structure');
    return {
      name: t.function.name,
      description: t.function.description || '',
      parameters: cleanSchema(t.function.parameters),
    };
  });
  return [{ functionDeclarations }];
}

function buildRequestPayload(
  contents: GeminiContent[],
  temperature: number,
  systemInstruction?: string,
  tools?: ToolDefinition[],
): GeminiRequestBody {
  const payload: GeminiRequestBody = {
    contents,
    generationConfig: { temperature, maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS },
  };
  if (systemInstruction) {
    payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  const formatted = formatTools(tools ?? []);
  if (formatted) payload.tools = formatted;
  return payload;
}

async function executeGeminiCliRequest(
  endpoint: string,
  accessToken: string,
  wrappedBody: CodeAssistRequestWrapper,
): Promise<CodeAssistResponse> {
  if (!endpoint || !accessToken) throw new Error('Missing endpoint or access token');
  const res = await fetch(`${endpoint}/v1internal:generateContent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GeminiCLI/1.0.0',
    },
    body: JSON.stringify(wrappedBody),
  });
  if (!res.ok) {
    throw new Error(`Gemini CLI call failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as CodeAssistResponse;
}

function extractToolCalls(parts: GeminiPart[]): ToolCall[] | null {
  const functionCallPart = parts.find((p) => p.functionCall);
  if (!functionCallPart) return null;
  const thoughtSig = functionCallPart.thoughtSignature || functionCallPart.thought_signature;
  return [
    {
      // `randomUUID` et non `Date.now()` : deux appels émis dans la même
      // milliseconde produisaient le même identifiant, ce qui réattribuait un
      // résultat d'outil au mauvais appel.
      id: `call_${randomUUID()}`,
      type: 'function',
      function: {
        name: functionCallPart.functionCall?.name ?? '',
        arguments: JSON.stringify(functionCallPart.functionCall?.args ?? {}),
      },
      thought_signature: thoughtSig,
    },
  ];
}

function parseGeminiCliResponse(data: CodeAssistResponse): AdapterChatResult {
  if (!data || typeof data !== 'object') throw new Error('Invalid response data');
  const responseRoot = data.response || data;
  const candidate = responseRoot.candidates?.[0];
  if (!candidate) throw new Error('No candidate in Gemini CLI response');

  const parts = candidate.content?.parts || [];
  const textContent = parts
    .filter((p) => p.text)
    .map((p) => p.text)
    .join('\n')
    .trim();
  // `thought` est déclaré `string | boolean` : l'API le renvoie en booléen pour
  // marquer un fragment de raisonnement, seul le texte est relayé.
  const thoughtPart = parts.find((p) => typeof p.thought === 'string' && p.thought);
  const thoughtContent = typeof thoughtPart?.thought === 'string' ? thoughtPart.thought : null;

  return {
    content: textContent || null,
    thought: thoughtContent,
    toolCalls: extractToolCalls(parts),
    finishReason: candidate.finishReason || 'stop',
    usage: responseRoot.usageMetadata,
  };
}

export async function chat(
  messages: ChatMessage[],
  options: AdapterChatOptions,
): Promise<AdapterChatResult> {
  const { model, temperature = DEFAULT_TEMPERATURE, tools } = options;
  const endpoint = process.env.GEMINI_CLI_ENDPOINT || 'https://cloudcode-pa.googleapis.com';
  const { accessToken, projectId } = await getTokens(endpoint);

  const systemMsg = messages.find((m) => m.role === 'system');
  const systemInstruction = systemMsg ? flattenContent(systemMsg.content) : undefined;
  const payload = buildRequestPayload(mapMessages(messages), temperature, systemInstruction, tools);

  const wrappedBody: CodeAssistRequestWrapper = {
    project: projectId,
    model: requireModel(model, 'Gemini CLI Adapter'),
    request: payload,
    requestType: 'agent',
    userAgent: 'gemini-cli',
    requestId: `agent-${randomUUID()}`,
  };

  const data = await executeGeminiCliRequest(endpoint, accessToken, wrappedBody);
  return parseGeminiCliResponse(data);
}

export default {
  name: 'gemini-cli',
  chat,
} satisfies ProviderAdapter;
