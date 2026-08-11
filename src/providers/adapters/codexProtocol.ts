/**
 * Protocole `POST https://chatgpt.com/backend-api/codex/responses`.
 *
 * Ce format n'est partagé par aucun autre adapter du dossier : il est décrit
 * ici plutôt que dans `../types.ts` (protocole compatible OpenAI) ou
 * `../geminiTypes.ts` (protocole REST Gemini). Seuls les types de bordure
 * (`ChatMessage`, `ToolCall`) sont empruntés à `../types.ts` : ce sont eux qui
 * transitent par le routeur.
 *
 * Module autonome : aucun import depuis `../index.ts`.
 *
 * Les formes déclarées reproduisent ce que l'adapter émettait déjà. Deux
 * divergences assumées, signalées à leur point d'usage : l'aplatissement d'un
 * contenu multimodal en texte (l'API rejette un tableau là où elle attend une
 * chaîne) et le vidage final du décodeur de flux.
 */

import type { ChatContentPart, ChatMessage, OpenAIResponseChoice, TokenUsage } from '../types.js';
import { randomUUID } from 'node:crypto';

/**
 * Borne du nombre de fragments lus sur le flux SSE. Une réponse complète tient
 * dans quelques centaines de fragments ; la borne empêche une boucle infinie si
 * le serveur maintient la connexion ouverte sans jamais la clore.
 */
const MAX_STREAM_CHUNKS = 100_000;

/** Instructions système appliquées quand l'historique n'en porte pas. */
const DEFAULT_INSTRUCTIONS = 'You are a helpful assistant.';

/** Fragment de contenu d'un item `message`, en entrée comme en sortie. */
export interface CodexContentPart {
  type: string;
  text: string;
}

/** Tour de conversation réinjecté dans `input`. */
export interface CodexMessageItem {
  type: 'message';
  role: string;
  content: CodexContentPart[];
}

/** Appel d'outil émis précédemment par le modèle, réinjecté dans l'historique. */
export interface CodexFunctionCallItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

/** Résultat d'exécution d'outil renvoyé au modèle. */
export interface CodexFunctionCallOutputItem {
  type: 'function_call_output';
  call_id?: string;
  name?: string;
  output: string;
}

/** Élément du tableau `input` de la requête. */
export type CodexResponsesInputItem =
  CodexMessageItem | CodexFunctionCallItem | CodexFunctionCallOutputItem;

/** Corps de requête du protocole Responses, tel qu'émis par `codex_cli_rs`. */
export interface CodexResponsesBody {
  model: string;
  store: boolean;
  stream: boolean;
  instructions: string;
  input: CodexResponsesInputItem[];
  text: { verbosity: string };
  include: string[];
}

/**
 * Élément du tableau `output` de la réponse.
 *
 * Tous les champs sont optionnels : un même tableau mêle des items `message`,
 * `function_call` et `reasoning`, chacun ne portant que ses propres clés.
 */
export interface CodexOutputItem {
  type?: string;
  role?: string;
  content?: string | CodexContentPart[];
  call_id?: string;
  name?: string;
  arguments?: unknown;
}

/**
 * Objet de réponse final.
 *
 * `choices` et `output` sont deux encodages alternatifs du même résultat :
 * l'adapter lit le premier présent. `choices` réutilise le type du protocole
 * compatible OpenAI plutôt que de le redéclarer.
 */
export interface CodexResponsesPayload {
  output?: CodexOutputItem[];
  choices?: OpenAIResponseChoice[];
  usage?: TokenUsage;
}

/** Événement du flux `text/event-stream`. */
interface CodexStreamEvent {
  type?: string;
  response?: CodexResponsesPayload;
}

/**
 * Réduit un contenu de message à du texte.
 *
 * L'API n'accepte qu'une chaîne dans `content[].text` : un contenu multimodal
 * (tableau de fragments) est concaténé, un contenu absent devient une chaîne
 * vide plutôt qu'`undefined`, ce qui produisait un fragment `input_text` sans
 * champ `text` après sérialisation.
 */
function flattenContent(content: string | ChatContentPart[] | null | undefined): string {
  if (Array.isArray(content)) {
    return content.map((part) => part.text || '').join('\n');
  }
  return typeof content === 'string' ? content : '';
}

/**
 * Sérialise un contenu destiné au champ `output` d'un résultat d'outil.
 *
 * INVARIANT : retourne toujours une chaîne ; un contenu non textuel est
 * sérialisé en JSON, comme l'attend le protocole.
 */
function stringifyToolOutput(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

/**
 * Extrait les instructions système de l'historique.
 *
 * Seul le premier message `system` est retenu : le protocole Responses porte
 * les instructions dans un champ scalaire, hors du tableau `input`.
 */
export function extractInstructions(messages: ChatMessage[]): string {
  const systemMessage = messages.find((message) => message.role === 'system');
  if (!systemMessage) return DEFAULT_INSTRUCTIONS;
  return flattenContent(systemMessage.content);
}

/** Convertit un tour `user` ou `developer`. */
function toUserItem(message: ChatMessage): CodexMessageItem {
  return {
    type: 'message',
    role: message.role,
    content: [{ type: 'input_text', text: flattenContent(message.content) }],
  };
}

/**
 * Convertit un tour `assistant` : le texte produit, puis ses appels d'outils.
 *
 * Un tour sans texte mais porteur d'appels d'outils ne produit pas d'item
 * `message` — l'API rejette un contenu vide.
 */
function toAssistantItems(message: ChatMessage): CodexResponsesInputItem[] {
  const items: CodexResponsesInputItem[] = [];

  if (message.content) {
    items.push({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: flattenContent(message.content) }],
    });
  }

  for (const toolCall of message.tool_calls ?? []) {
    items.push({
      type: 'function_call',
      // Un appel sans identifiant ne pourrait pas être apparié à son résultat :
      // `randomUUID` garantit l'unicité, là où `Date.now()` collisionnait pour
      // deux appels émis dans la même milliseconde.
      call_id: toolCall.id || `call_${randomUUID()}`,
      name: toolCall.function.name,
      arguments: stringifyToolOutput(toolCall.function.arguments),
    });
  }

  return items;
}

/** Convertit un tour `tool` en résultat d'exécution. */
function toToolOutputItem(message: ChatMessage): CodexFunctionCallOutputItem {
  return {
    type: 'function_call_output',
    call_id: message.tool_call_id,
    name: message.name,
    output: stringifyToolOutput(message.content),
  };
}

/**
 * Aplatit l'historique au format `input` du protocole Responses.
 *
 * Les messages `system` sont exclus (portés par `instructions`) ainsi que tout
 * rôle inconnu du protocole, plutôt que transmis sous une forme que l'API
 * rejetterait.
 */
export function buildResponsesInput(messages: ChatMessage[]): CodexResponsesInputItem[] {
  const input: CodexResponsesInputItem[] = [];

  for (const message of messages) {
    if (message.role === 'user' || message.role === 'developer') {
      input.push(toUserItem(message));
    } else if (message.role === 'assistant') {
      input.push(...toAssistantItems(message));
    } else if (message.role === 'tool') {
      input.push(toToolOutputItem(message));
    }
  }

  return input;
}

/**
 * Agrège l'intégralité du flux `text/event-stream` en une chaîne.
 *
 * Le décodeur est vidé après la boucle (`decode()` sans argument) : un
 * caractère multi-octets coupé sur une frontière de fragment resterait sinon
 * retenu, tronquant le JSON du dernier événement.
 *
 * INVARIANT : le verrou du lecteur est toujours relâché, y compris sur erreur.
 */
export async function readEventStream(body: NonNullable<Response['body']>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  try {
    for (let chunk = 0; chunk < MAX_STREAM_CHUNKS; chunk += 1) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }
    return fullText + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Isole l'objet de réponse final du flux SSE agrégé.
 *
 * Le dernier événement `response.done` ou `response.completed` fait foi : le
 * flux porte aussi des événements incrémentaux, écartés ici.
 *
 * @throws {Error} Si aucun événement final n'est présent — un flux interrompu
 * ne doit pas produire une réponse vide silencieuse.
 */
export function extractResponsePayload(rawStream: string): CodexResponsesPayload {
  let payload: CodexResponsesPayload | null = null;

  for (const line of rawStream.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;

    const braceIndex = trimmed.indexOf('{');
    if (braceIndex === -1) continue;

    let event: CodexStreamEvent;
    try {
      event = JSON.parse(trimmed.substring(braceIndex)) as CodexStreamEvent;
    } catch {
      // Fragment non-JSON (`data: [DONE]`, ligne de garde) : attendu sur un
      // flux SSE, ce n'est pas une erreur de protocole.
      continue;
    }

    if (event.type === 'response.done' || event.type === 'response.completed') {
      payload = event.response ?? null;
    }
  }

  if (!payload) {
    throw new Error('[Codex] Aucun événement final de réponse trouvé dans le flux SSE.');
  }

  return payload;
}
