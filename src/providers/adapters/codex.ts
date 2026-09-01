// providers/adapters/codex.ts
// Adaptateur pour OpenAI Codex avec authentification OAuth officielle ChatGPT Plus/Pro.
// WHY: Permet de consommer les modèles SOTA (gpt-5.5, gpt-5.4, etc.) via l'abonnement Codex.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { Buffer } from 'buffer';
import { randomUUID } from 'node:crypto';
import type {
  AdapterChatOptions,
  AdapterChatResult,
  ChatMessage,
  ProviderAdapter,
  TokenUsage,
  ToolCall,
} from '../types.js';
import { requireModel } from '../requireModel.js';
import {
  buildResponsesInput,
  extractInstructions,
  extractResponsePayload,
  readEventStream,
  type CodexResponsesBody,
  type CodexResponsesPayload,
} from './codexProtocol.js';

const AUTH_FILE_PATH = '/home/omni/.codex/auth.json';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

/** Marge avant expiration en deçà de laquelle le jeton est rafraîchi (secondes). */
const REFRESH_MARGIN_SECONDS = 300;

/**
 * Charge utile du JWT d'accès, réduite aux champs réellement lus.
 *
 * `https://api.openai.com/auth` est une revendication propriétaire OpenAI ;
 * son nom est écrit littéralement, ici comme au point d'accès, plutôt que via
 * une constante : un bracket portant un identifiant déclencherait
 * `security/detect-object-injection`.
 */
interface CodexJwtPayload {
  exp?: number;
  'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
}

/** Bloc `tokens` du fichier `auth.json` écrit par la CLI Codex. */
interface CodexAuthTokens {
  access_token?: string;
  refresh_token?: string;
  account_id?: string;
}

/**
 * Contenu de `auth.json`. Les clés hors `tokens` (par ex. `last_refresh`) sont
 * préservées à la réécriture via la signature d'index : les écraser ferait
 * perdre l'état de la CLI officielle qui partage ce fichier.
 */
interface CodexAuthFile {
  tokens?: CodexAuthTokens;
  [key: string]: unknown;
}

/** Réponse de `POST https://auth.openai.com/oauth/token`. */
interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
}

/** Jeu d'identifiants résolu, avant toute décision de rafraîchissement. */
interface CodexCredentials {
  accessToken?: string;
  refreshToken?: string;
  accountId?: string;
  /** `null` quand aucun `auth.json` exploitable n'a été lu. */
  authData: CodexAuthFile | null;
}

/**
 * Décode un jeton JWT pour inspecter son expiration.
 *
 * INVARIANT : retourne `null` — et jamais une exception — pour toute entrée
 * malformée. L'appelant traite `null` comme « rafraîchissement nécessaire ».
 */
function decodeJwt(token: string): CodexJwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const decoded = Buffer.from(parts[1], 'base64').toString('utf8');
    return JSON.parse(decoded) as CodexJwtPayload;
  } catch {
    return null;
  }
}

/**
 * Résout les identifiants depuis l'environnement (production Railway) puis,
 * à défaut de jeton de rafraîchissement, depuis `auth.json` (développement).
 */
function loadCredentials(): CodexCredentials {
  const fromEnv: CodexCredentials = {
    accessToken: process.env.CODEX_ACCESS_TOKEN,
    refreshToken: process.env.CODEX_REFRESH_TOKEN,
    accountId: process.env.CODEX_ACCOUNT_ID,
    authData: null,
  };

  if (fromEnv.refreshToken || !existsSync(AUTH_FILE_PATH)) {
    return fromEnv;
  }

  try {
    const authData = JSON.parse(readFileSync(AUTH_FILE_PATH, 'utf8')) as CodexAuthFile;
    if (!authData?.tokens) {
      return { ...fromEnv, authData };
    }
    return {
      accessToken: authData.tokens.access_token,
      refreshToken: authData.tokens.refresh_token,
      accountId: authData.tokens.account_id,
      authData,
    };
  } catch (err) {
    console.error('[Codex] Erreur lors de la lecture du fichier auth.json:', err);
    return fromEnv;
  }
}

/**
 * Détermine si le jeton d'accès doit être renouvelé.
 *
 * Fail closed : absence de jeton, JWT illisible ou `exp` manquant imposent le
 * rafraîchissement plutôt qu'un appel voué à un 401.
 */
function needsRefresh(accessToken: string | undefined): boolean {
  if (!accessToken) return true;

  const payload = decodeJwt(accessToken);
  if (!payload?.exp) return true;

  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp - nowSec < REFRESH_MARGIN_SECONDS;
}

/**
 * Réécrit `auth.json` avec les jetons renouvelés.
 *
 * L'échec d'écriture n'interrompt pas l'appel en cours : sur un système de
 * fichiers en lecture seule (conteneur), les jetons restent valides en mémoire
 * pour la durée du processus. L'échec est signalé, jamais avalé.
 */
function persistTokens(authData: CodexAuthFile | null, tokens: CodexAuthTokens): void {
  if (!existsSync(AUTH_FILE_PATH) && !authData) return;

  try {
    const updatedAuthData: CodexAuthFile = { ...authData, tokens };
    writeFileSync(AUTH_FILE_PATH, JSON.stringify(updatedAuthData, null, 4), 'utf8');
    console.log('[Codex] Tokens mis à jour sauvegardés dans auth.json.');
  } catch (err) {
    console.warn(
      "[Codex] Échec d'écriture de auth.json (système de fichiers en lecture seule ?) :",
      err,
    );
  }
}

/**
 * Échange le jeton de rafraîchissement contre un nouveau jeton d'accès.
 *
 * INVARIANT : retourne toujours un `accessToken` non vide, ou lève.
 */
async function refreshAccessToken(
  refreshToken: string,
  previousAccountId: string | undefined,
  authData: CodexAuthFile | null,
): Promise<{ accessToken: string; accountId: string | undefined }> {
  console.log("[Codex] Rafraîchissement automatique du jeton d'accès OAuth OpenAI...");

  const res = await fetch('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Échec du rafraîchissement OAuth : ${res.status} ${text}`);
  }

  const data = (await res.json()) as OAuthTokenResponse;
  if (!data.access_token) {
    throw new Error("[Codex] Réponse OAuth sans jeton d'accès.");
  }

  const decoded = decodeJwt(data.access_token);
  const accountId =
    decoded?.['https://api.openai.com/auth']?.chatgpt_account_id || previousAccountId;

  console.log("[Codex] Jeton d'accès OAuth rafraîchi avec succès.");

  persistTokens(authData, {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    account_id: accountId,
  });

  return { accessToken: data.access_token, accountId };
}

/**
 * Récupère ou rafraîchit automatiquement le jeton d'accès OAuth.
 *
 * INVARIANT : retourne un `accessToken` non vide et valide au moins
 * {@link REFRESH_MARGIN_SECONDS} secondes, ou lève une erreur nommée.
 */
async function getOrRefreshTokens(): Promise<{ accessToken: string; accountId: string }> {
  const credentials = loadCredentials();

  if (!credentials.refreshToken) {
    throw new Error(
      'Jeton de rafraîchissement Codex introuvable (ni CODEX_REFRESH_TOKEN ni auth.json).',
    );
  }

  if (!needsRefresh(credentials.accessToken)) {
    // `needsRefresh` a déjà écarté le cas `undefined` : le jeton est utilisable.
    return {
      accessToken: credentials.accessToken as string,
      accountId: credentials.accountId || '',
    };
  }

  const refreshed = await refreshAccessToken(
    credentials.refreshToken,
    credentials.accountId,
    credentials.authData,
  );

  return {
    accessToken: refreshed.accessToken,
    accountId: refreshed.accountId || '',
  };
}

/** Construit le corps de requête du protocole Codex Responses. */
function buildRequestBody(messages: ChatMessage[], model: string): CodexResponsesBody {
  return {
    model,
    store: false,
    stream: true,
    instructions: extractInstructions(messages),
    input: buildResponsesInput(messages),
    text: { verbosity: 'medium' },
    include: ['reasoning.encrypted_content'],
  };
}

/**
 * Lève une erreur nommée à partir d'une réponse HTTP en échec.
 *
 * INVARIANT : cette fonction ne retourne jamais.
 */
async function throwApiError(response: Response): Promise<never> {
  const text = await response.text().catch(() => '');
  let parsed: { error?: { message?: string }; detail?: string } | null;
  try {
    parsed = JSON.parse(text) as { error?: { message?: string }; detail?: string };
  } catch {
    // Corps non-JSON (page HTML d'erreur, texte brut) : le texte sert de message.
    parsed = null;
  }
  const errorMsg = parsed?.error?.message || parsed?.detail || text || 'Erreur API Codex';
  throw new Error(`[Codex API Error] ${response.status} ${response.statusText}: ${errorMsg}`);
}

/** Convertit un `function_call` du flux Responses en `tool_call` format OpenAI. */
function toToolCall(item: { call_id?: string; name?: string; arguments?: unknown }): ToolCall {
  return {
    id: item.call_id || `call_${randomUUID()}`,
    type: 'function',
    function: {
      name: item.name || '',
      arguments:
        typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments),
    },
  };
}

/**
 * Reconstruit la réponse depuis le format plat officiel Codex Responses
 * (`payload.output`).
 */
function readOutputItems(payload: CodexResponsesPayload): {
  content: string;
  toolCalls: ToolCall[];
} {
  let content = '';
  const toolCalls: ToolCall[] = [];

  for (const item of payload.output ?? []) {
    if (item.type === 'function_call') {
      toolCalls.push(toToolCall(item));
      continue;
    }
    if (item.type !== 'message' || item.role !== 'assistant') continue;

    if (typeof item.content === 'string') {
      content += item.content;
      continue;
    }
    for (const part of item.content ?? []) {
      const isText =
        part.type === 'text' || part.type === 'input_text' || part.type === 'output_text';
      if (isText) content += part.text || '';
    }
  }

  return { content, toolCalls };
}

/**
 * Reconstruit la réponse depuis le format compatible OpenAI (`payload.choices`),
 * emprunté quand le backend s'aligne sur `chat/completions`.
 */
function readChoices(payload: CodexResponsesPayload): {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
} {
  const choice = payload.choices?.[0];
  return {
    content: choice?.message?.content || '',
    toolCalls: choice?.message?.tool_calls || [],
    finishReason: choice?.finish_reason || 'stop',
  };
}

export default {
  name: 'codex',

  /**
   * Effectue une chat completion via le backend Codex ChatGPT.
   *
   * Le protocole `codex/responses` répond exclusivement en `text/event-stream` ;
   * le flux est agrégé puis réduit à l'événement final avant retour.
   */
  async chat(messages: ChatMessage[], options: AdapterChatOptions): Promise<AdapterChatResult> {
    const { accessToken, accountId } = await getOrRefreshTokens();
    const body = buildRequestBody(messages, requireModel(options.model, 'Codex Adapter'));

    // Headers d'imitation exacts de codex_cli_rs
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'chatgpt-account-id': accountId,
      'OpenAI-Beta': 'responses=experimental',
      originator: 'codex_cli_rs',
      'Content-Type': 'application/json',
      accept: 'text/event-stream',
    };

    const response = await fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await throwApiError(response);
    }
    if (!response.body) {
      throw new Error('[Codex] La réponse ne contient pas de body lisible.');
    }

    const payload = extractResponsePayload(await readEventStream(response.body));

    const usage: TokenUsage | undefined = payload.usage;
    const hasChoices = (payload.choices?.length ?? 0) > 0;
    const { content, toolCalls, finishReason } = hasChoices
      ? readChoices(payload)
      : { ...readOutputItems(payload), finishReason: 'stop' };

    return {
      content: content || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      finishReason,
      usage,
    };
  },
} satisfies ProviderAdapter;
