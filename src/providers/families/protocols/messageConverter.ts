/**
 * Stratégies de conversion des messages entre le format pivot OpenAI
 * (`ChatMessage`) et les quatre dialectes wire cibles (OpenAI, Anthropic,
 * Gemini, Cohere).
 *
 * Format pivot : `ChatMessage` de `../../types.ts` — forme OpenAI standard.
 * Chaque dialecte cible projette son propre format wire via `WireMessage`
 * (messages entrants) ou `ResponseConversion` (réponses API).
 *
 * Module autonome : n'importe que les types partagés et `randomUUID` de
 * `node:crypto` — aucun import depuis `src/providers/index.ts`.
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, ToolCall } from '../../types.js';

/** Contenu d'un message wire : chaîne, tableau de parties, ou null. */
type WireContent = string | unknown[] | null;

/** Message wire universel : chaque dialecte y projette son format natif. */
export interface WireMessage {
  role: string;
  content: WireContent;
  [key: string]: unknown;
}

/** Résultat de conversion d'une réponse API vers le format pivot. */
export interface ResponseConversion {
  content: string | null;
  toolCalls: ToolCall[] | null;
  reasoningContent?: string | null;
  thought?: string | null;
}

// ────────────────────────────────────────────────────────────
//  Type guards & helpers partagés
// ────────────────────────────────────────────────────────────

/** Vrai si la valeur est un objet non-null, non-array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Résultat vide réutilisé comme repli fail-open. */
const EMPTY_RESPONSE: ResponseConversion = { content: null, toolCalls: null };

/**
 * Retourne EMPTY_RESPONSE avec un warning (fail-open observables).
 * @param dialect Nom du dialecte (OpenAI, Anthropic, etc.)
 * @param reason Raison de l'échec structurel
 */
function emptyWithWarning(dialect: string, reason: string): ResponseConversion {
  console.warn(
    `[MessageConverter] ${dialect}: réponse structurellement invalide (${reason}), retour vide.`,
  );
  return { ...EMPTY_RESPONSE };
}

/**
 * Extrait et normalise un tableau de `ToolCall` depuis une valeur inconnue.
 *
 * Retourne `null` si l'entrée n'est pas un tableau, est vide, ou ne contient
 * aucun élément conforme au contrat `ToolCall`.
 */
function extractToolCalls(value: unknown): ToolCall[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const valid = value
    .filter(isRecord)
    .filter((tc) => typeof tc['id'] === 'string' && isRecord(tc['function']));

  if (valid.length === 0) {
    return null;
  }

  return valid.map((tc) => {
    const fn = tc['function'] as Record<string, unknown>;
    return {
      id: tc['id'] as string,
      type: typeof tc['type'] === 'string' ? tc['type'] : 'function',
      function: {
        name: typeof fn['name'] === 'string' ? fn['name'] : '',
        arguments: typeof fn['arguments'] === 'string' ? fn['arguments'] : '{}',
      },
    };
  });
}

/** Résolution sécurisée d'un contenu `ChatMessage` en valeur wire. */
function resolveContent(content: ChatMessage['content']): string | unknown[] | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content as unknown[];
  return null;
}

/**
 * Désérialise des arguments JSON, retombe sur un objet vide en cas d'erreur.
 * Log un warning si le JSON est malformé (fail-open observables).
 */
function parseJsonArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.warn(
      '[MessageConverter] parseJsonArgs: JSON malformé, fallback {}. Détail:',
      (err as Error).message,
    );
    return {};
  }
}

/** Extrait le texte d'un contenu multimodal ou chaîne. */
function extractTextFromContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        isRecord(p) && typeof p['text'] === 'string' ? (p['text'] as string) : JSON.stringify(p),
      )
      .join('');
  }
  return '';
}

// ────────────────────────────────────────────────────────────
//  CONVERSION MESSAGES (4 dialectes)
// ────────────────────────────────────────────────────────────

/**
 * Convertit les messages pivot vers le format wire OpenAI.
 *
 * Pass-through fidèle avec propagation conditionnelle de `tool_calls`,
 * `tool_call_id`, `reasoning_content` et `name`.
 *
 * @param messages Historique au format pivot `ChatMessage`.
 */
export function convertMessagesForOpenAI(messages: ChatMessage[]): WireMessage[] {
  return messages.map((m) => {
    const wire: WireMessage = { role: m.role, content: resolveContent(m.content) };
    if (m.tool_calls) wire['tool_calls'] = m.tool_calls;
    if (m.tool_call_id) wire['tool_call_id'] = m.tool_call_id;
    if (m.reasoning_content) wire['reasoning_content'] = m.reasoning_content;
    if (m.name) wire['name'] = m.name;
    return wire;
  });
}

// ── Anthropic (messages) ────────────────────────────────────

/** Bloc `tool_use` Anthropic, contenu d'un message assistant. */
interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

/** Bloc `text` Anthropic. */
interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

/** Bloc `tool_result` Anthropic, contenu d'un message user. */
interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

/**
 * Transforme un `ToolCall` pivot en bloc `tool_use` Anthropic.
 *
 * Les arguments JSON sont désérialisés : l'API Anthropic attend `input`
 * comme un objet, jamais une chaîne.
 */
function toAnthropicToolUseBlock(tc: ToolCall): AnthropicToolUseBlock {
  return {
    type: 'tool_use',
    id: tc.id,
    name: tc.function.name,
    input: parseJsonArgs(tc.function.arguments),
  };
}

/**
 * Construit le WireMessage assistant Anthropic avec blocs text + tool_use.
 */
function toAnthropicAssistantWire(m: ChatMessage): WireMessage {
  const blocks: (AnthropicTextBlock | AnthropicToolUseBlock)[] = [];
  if (typeof m.content === 'string' && m.content.length > 0) {
    blocks.push({ type: 'text', text: m.content });
  }
  for (const tc of m.tool_calls ?? []) {
    blocks.push(toAnthropicToolUseBlock(tc));
  }
  return { role: 'assistant', content: blocks };
}

/** Bloc `image` Anthropic, source base64. */
interface AnthropicImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

/**
 * Convertit une partie `ChatContentPart` OpenAI en bloc Anthropic.
 *
 * - `text` → `{ type: 'text', text }`
 * - `image_url.url` (data:) → `{ type: 'image', source: { type: 'base64', media_type, data } }`
 * - Autres → JSON.stringify
 */
function toAnthropicContentPart(part: unknown): AnthropicTextBlock | AnthropicImageBlock | unknown {
  if (!isRecord(part)) return part;

  const partType = part['type'];
  if (partType === 'text' && typeof part['text'] === 'string') {
    return { type: 'text', text: part['text'] as string };
  }

  if (partType === 'image_url') {
    const imageUrl = part['image_url'] as Record<string, unknown> | undefined;
    const url = typeof imageUrl?.['url'] === 'string' ? (imageUrl['url'] as string) : '';
    if (url.startsWith('data:')) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(url);
      if (match) {
        return {
          type: 'image',
          source: { type: 'base64', media_type: match[1], data: match[2] },
        };
      }
    }
  }

  return part;
}

/**
 * Résout le contenu d'un message user Anthropic.
 * Convertit les parties multimodal OpenAI (text, image_url) en blocs Anthropic.
 */
function resolveAnthropicContent(content: ChatMessage['content']): string | unknown[] | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(toAnthropicContentPart);
  return null;
}

/** Construit le WireMessage tool Anthropic (role user + tool_result). */
function toAnthropicToolWire(m: ChatMessage): WireMessage {
  const textContent = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
  const block: AnthropicToolResultBlock = {
    type: 'tool_result',
    tool_use_id: m.tool_call_id ?? '',
    content: textContent,
  };
  return { role: 'user', content: [block] };
}

/**
 * Convertit les messages pivot vers le format wire Anthropic.
 *
 * - `system` filtré (extrait séparément en `system_prompt` par l'appelant).
 * - `assistant` + `tool_calls` → blocs `tool_use` dans `content[]`.
 * - `tool` → `role: 'user'` avec bloc `tool_result` (`tool_use_id = tool_call_id`).
 * - Autres : pass-through `role` + `content`.
 *
 * @param messages Historique au format pivot `ChatMessage`.
 */
export function convertMessagesForAnthropic(messages: ChatMessage[]): WireMessage[] {
  const result: WireMessage[] = [];

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      result.push(toAnthropicAssistantWire(m));
      continue;
    }

    if (m.role === 'tool') {
      result.push(toAnthropicToolWire(m));
      continue;
    }

    // Messages user : convertir les parties multimodal OpenAI → blocs Anthropic
    result.push({ role: m.role, content: resolveAnthropicContent(m.content) });
  }

  return result;
}

// ── Gemini (messages) ───────────────────────────────────────

/** Construit les parts d'un message assistant Gemini (role model). */
function toGeminiModelParts(m: ChatMessage): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = [];

  if (typeof m.content === 'string' && m.content.length > 0) {
    parts.push({ text: m.content });
  }
  if (typeof m.thought === 'string' && m.thought.length > 0) {
    parts.push({ thought: m.thought });
  }

  for (const tc of m.tool_calls ?? []) {
    const part: Record<string, unknown> = {
      functionCall: { name: tc.function.name, args: parseJsonArgs(tc.function.arguments) },
    };
    if (tc.thought_signature) {
      part['thoughtSignature'] = tc.thought_signature;
    }
    parts.push(part);
  }

  if (parts.length === 0) {
    parts.push({ text: '' });
  }
  return parts;
}

/** Construit les parts d'un message tool Gemini (role function). */
function toGeminiFunctionParts(m: ChatMessage): Record<string, unknown>[] {
  const textContent = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
  return [
    {
      functionResponse: {
        name: m.name ?? '',
        response: { name: m.name ?? '', content: textContent },
      },
    },
  ];
}

/** Construit les parts d'un message user Gemini. */
function toGeminiUserParts(m: ChatMessage): Record<string, unknown>[] {
  return [{ text: extractTextFromContent(m.content) }];
}

/**
 * Convertit les messages pivot vers le format wire Gemini.
 *
 * - `system` filtré (Gemini utilise `systemInstruction` séparément).
 * - `assistant` → `role: 'model'` avec parts (text, thought, functionCall).
 * - `tool` → `role: 'function'` avec `functionResponse`.
 * - Autres → `role: 'user'` avec parts text.
 * - IDs générés via `randomUUID()` de `node:crypto`.
 *
 * @param messages Historique au format pivot `ChatMessage`.
 */
export function convertMessagesForGemini(messages: ChatMessage[]): WireMessage[] {
  const result: WireMessage[] = [];

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'assistant') {
      result.push({ role: 'model', content: toGeminiModelParts(m) });
      continue;
    }

    if (m.role === 'tool') {
      result.push({ role: 'function', content: toGeminiFunctionParts(m) });
      continue;
    }

    result.push({ role: 'user', content: toGeminiUserParts(m) });
  }

  return result;
}

// ── Cohere (messages) ───────────────────────────────────────

/**
 * Convertit les messages pivot vers le format wire Cohere.
 *
 * - `system` filtré (extrait séparément en `system` par l'appelant).
 * - `tool_calls` et `tool_call_id` propagés via spread conditionnel.
 * - Pass-through `role` + `content` pour les autres rôles.
 *
 * @param messages Historique au format pivot `ChatMessage`.
 */
export function convertMessagesForCohere(messages: ChatMessage[]): WireMessage[] {
  const result: WireMessage[] = [];

  for (const m of messages) {
    if (m.role === 'system') continue;

    const wire: WireMessage = { role: m.role, content: resolveContent(m.content) };
    if (m.tool_calls) wire['tool_calls'] = m.tool_calls;
    if (m.tool_call_id) wire['tool_call_id'] = m.tool_call_id;
    result.push(wire);
  }

  return result;
}

// ────────────────────────────────────────────────────────────
//  CONVERSION RÉPONSES (4 dialectes)
// ────────────────────────────────────────────────────────────

/**
 * Convertit une réponse API OpenAI brute vers le format pivot.
 *
 * Extrait `choices[0].message.content`, `tool_calls` et
 * `reasoning_content`. Retourne un résultat vide si la structure
 * est inattendue (fail-open côté conversion, l'appelant décide).
 *
 * @param data Réponse JSON brute de l'API OpenAI (`unknown`).
 */
export function convertResponseForOpenAI(data: unknown): ResponseConversion {
  if (!isRecord(data)) return emptyWithWarning('OpenAI', 'data non-objet');

  const choices = data['choices'];
  if (!Array.isArray(choices) || choices.length === 0)
    return emptyWithWarning('OpenAI', 'choices vide/absent');

  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) return emptyWithWarning('OpenAI', 'choice[0] non-objet');

  const message = firstChoice['message'];
  if (!isRecord(message)) return emptyWithWarning('OpenAI', 'message non-objet');

  const content = typeof message['content'] === 'string' ? (message['content'] as string) : null;
  const toolCalls = extractToolCalls(message['tool_calls']);
  const result: ResponseConversion = { content, toolCalls };

  if (typeof message['reasoning_content'] === 'string') {
    result.reasoningContent = message['reasoning_content'] as string;
  }

  return result;
}

// ── Anthropic (réponse) ─────────────────────────────────────

/** Accumulateur interne pour le parcours des blocs Anthropic. */
interface AnthropicAccumulator {
  content: string | null;
  toolCalls: ToolCall[] | null;
  reasoningContent: string | null;
  thought: string | null;
}

/** Traite un bloc `text` ou `tool_use` de la réponse Anthropic. */
function processAnthropicTextOrToolUse(
  block: Record<string, unknown>,
  acc: AnthropicAccumulator,
): void {
  const blockType = block['type'];

  if (blockType === 'text') {
    acc.content = typeof block['text'] === 'string' ? (block['text'] as string) : null;
    return;
  }

  if (blockType === 'tool_use') {
    acc.toolCalls = acc.toolCalls ?? [];
    acc.toolCalls.push({
      id: typeof block['id'] === 'string' ? (block['id'] as string) : '',
      type: 'function',
      function: {
        name: typeof block['name'] === 'string' ? (block['name'] as string) : '',
        arguments: JSON.stringify(block['input'] ?? {}),
      },
    });
  }
}

/** Traite un bloc `thinking` ou `redacted_thinking` de la réponse Anthropic. */
function processAnthropicThinking(block: Record<string, unknown>, acc: AnthropicAccumulator): void {
  const blockType = block['type'];

  if (blockType === 'thinking') {
    const thinking = block['thinking'];
    acc.reasoningContent = typeof thinking === 'string' ? thinking : null;
    return;
  }

  if (blockType === 'redacted_thinking') {
    acc.thought = typeof block['text'] === 'string' ? (block['text'] as string) : null;
  }
}

/**
 * Convertit une réponse API Anthropic brute vers le format pivot.
 *
 * Parcourt les blocs `content[]` et extrait :
 * - `text` → `content`
 * - `tool_use` → `toolCalls`
 * - `thinking` → `reasoningContent`
 * - `redacted_thinking` → `thought`
 *
 * @param data Réponse JSON brute de l'API Anthropic (`unknown`).
 */
export function convertResponseForAnthropic(data: unknown): ResponseConversion {
  if (!isRecord(data)) return emptyWithWarning('Anthropic', 'data non-objet');

  const blocks = data['content'];
  if (!Array.isArray(blocks)) return emptyWithWarning('Anthropic', 'content non-array');

  const acc: AnthropicAccumulator = {
    content: null,
    toolCalls: null,
    reasoningContent: null,
    thought: null,
  };

  for (const raw of blocks) {
    if (!isRecord(raw)) continue;
    processAnthropicTextOrToolUse(raw, acc);
    processAnthropicThinking(raw, acc);
  }

  const result: ResponseConversion = { content: acc.content, toolCalls: acc.toolCalls };
  if (acc.reasoningContent !== null) result.reasoningContent = acc.reasoningContent;
  if (acc.thought !== null) result.thought = acc.thought;
  return result;
}

// ── Gemini (réponse) ────────────────────────────────────────

/** Accumulateur interne pour le parcours des parts Gemini. */
interface GeminiAccumulator {
  textParts: string[];
  toolCalls: ToolCall[] | null;
  thought: string | null;
}

/** Extrait un ToolCall depuis un part Gemini functionCall. */
function extractGeminiToolCall(
  part: Record<string, unknown>,
  fc: Record<string, unknown>,
): ToolCall {
  const tc: ToolCall = {
    id: `call_${randomUUID()}`,
    type: 'function',
    function: {
      name: typeof fc['name'] === 'string' ? (fc['name'] as string) : '',
      arguments: JSON.stringify(fc['args'] ?? {}),
    },
  };
  const sig = part['thoughtSignature'] ?? part['thought_signature'];
  if (typeof sig === 'string') {
    tc.thought_signature = sig;
  }
  return tc;
}

/** Traite un part Gemini : text, functionCall ou thought. */
function processGeminiPart(part: Record<string, unknown>, acc: GeminiAccumulator): void {
  if (typeof part['text'] === 'string' && (part['text'] as string).length > 0) {
    acc.textParts.push(part['text'] as string);
  }

  const fc = part['functionCall'];
  if (isRecord(fc)) {
    acc.toolCalls = acc.toolCalls ?? [];
    acc.toolCalls.push(extractGeminiToolCall(part, fc));
  }

  if (typeof part['thought'] === 'string' && (part['thought'] as string).length > 0) {
    acc.thought = part['thought'] as string;
  }
}

/**
 * Extrait le tableau de parts depuis la structure imbriquée Gemini.
 *
 * Retourne `null` si `candidates[0].content.parts` est absent ou invalide.
 */
function extractGeminiParts(data: unknown): unknown[] | null {
  const candidates = (data as Record<string, unknown>)['candidates'];
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const candidate = candidates[0];
  if (!isRecord(candidate)) return null;

  const contentObj = candidate['content'];
  if (!isRecord(contentObj)) return null;

  const parts = contentObj['parts'];
  return Array.isArray(parts) ? parts : null;
}

/**
 * Convertit une réponse API Gemini brute vers le format pivot.
 *
 * Extrait `candidates[0].content.parts` : fragments `text` (concaténés),
 * `functionCall` (→ `toolCalls` avec IDs `randomUUID()`), et `thought`
 * (→ `thought`). Les signatures de pensée sont préservées.
 *
 * @param data Réponse JSON brute de l'API Gemini (`unknown`).
 */
export function convertResponseForGemini(data: unknown): ResponseConversion {
  if (!isRecord(data)) return emptyWithWarning('Gemini', 'data non-objet');

  const parts = extractGeminiParts(data);
  if (parts === null)
    return emptyWithWarning('Gemini', 'candidates[0].content.parts absent/invalide');

  const acc: GeminiAccumulator = { textParts: [], toolCalls: null, thought: null };

  for (const raw of parts) {
    if (isRecord(raw)) processGeminiPart(raw, acc);
  }

  const result: ResponseConversion = {
    content: acc.textParts.join('\n').trim() || null,
    toolCalls: acc.toolCalls,
  };
  if (acc.thought !== null) result.thought = acc.thought;
  return result;
}

// ── Cohere (réponse) ────────────────────────────────────────

/** Extrait le contenu textuel de la réponse Cohere (tableau ou chaîne). */
function extractCohereContent(rawContent: unknown): string | null {
  if (typeof rawContent === 'string') return rawContent;

  if (Array.isArray(rawContent)) {
    const texts = rawContent
      .filter(isRecord)
      .map((c) => (typeof c['text'] === 'string' ? (c['text'] as string) : ''))
      .filter((t) => t.length > 0);
    return texts.length > 0 ? texts.join('') : null;
  }

  return null;
}

/**
 * Convertit une réponse API Cohere brute vers le format pivot.
 *
 * Extrait `message.content` (tableau de fragments `{ text }` ou chaîne
 * directe) et `message.tool_calls`.
 *
 * @param data Réponse JSON brute de l'API Cohere (`unknown`).
 */
export function convertResponseForCohere(data: unknown): ResponseConversion {
  if (!isRecord(data)) return emptyWithWarning('Cohere', 'data non-objet');

  const message = data['message'];
  if (!isRecord(message)) return emptyWithWarning('Cohere', 'message non-objet');

  return {
    content: extractCohereContent(message['content']),
    toolCalls: extractToolCalls(message['tool_calls']),
  };
}
