// WHY: Sticker sending plugin with auto-discovery from storage_hm/stickers/.
// The catalog is built at init() by scanning filenames. The tool description
// includes a dynamic tag cloud so the LLM knows available emotions without
// listing every sticker (scales to 100+ stickers in ~400 chars).
// Two modes: search (intent → top 3) and send (sticker_name → direct send).

import { join, resolve, extname } from 'path';
import { safeReaddir, safeReadFileBuffer, resolveWithinRoot } from '../../../utils/safeFs.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface StickerEntry {
  readonly id: string;
  readonly tags: readonly string[];
  readonly description: string;
  readonly filePath: string;
}

interface SendStickerArgs {
  intent?: string;
  sticker_name?: string;
}

interface StickerSearchResult {
  readonly id: string;
  readonly tags: string;
  readonly description: string;
  readonly score: number;
}

interface SendStickerResult {
  success: boolean;
  message: string;
  matches?: readonly StickerSearchResult[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STICKERS_DIR = resolve(
  process.env.STORAGE_DIR || join(process.cwd(), 'storage_hm'),
  'stickers',
);
const SUPPORTED_EXTENSIONS = new Set(['.webp', '.png', '.gif']);
const TOP_MATCHES_COUNT = 3;

// ─── Catalog ────────────────────────────────────────────────────────────────

const catalog: Map<string, StickerEntry> = new Map();
let tagCloud = '';

/**
 * Invariant: after parseFileName returns, every field is a non-empty string
 * and tags has at least 1 element.
 *
 * Naming convention: {id}__{tag1_tag2_tag3}__{description}.webp
 * Fallback: if no __ separator, the entire basename becomes both id and tag.
 */
function parseFileName(fileName: string): StickerEntry | null {
  const ext = extname(fileName).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) return null;

  const baseName = fileName.slice(0, -ext.length);
  const segments = baseName.split('__');

  const id = segments[0]?.trim();
  if (!id) return null;

  const rawTags = segments[1]?.trim() || id;
  const tags = rawTags.split('_').filter(Boolean);
  if (tags.length === 0) return null;

  const description = (segments[2]?.trim() || id).replace(/_/g, ' ');

  return {
    id,
    tags,
    description,
    filePath: resolveWithinRoot(STICKERS_DIR, fileName),
  };
}

/**
 * Invariant: after scanStickers completes, catalog contains only entries
 * whose filePath points to a real file, and tagCloud is a sorted,
 * comma-separated list of all unique tags across the catalog.
 */
async function scanStickers(): Promise<void> {
  catalog.clear();
  tagCloud = '';

  let files: string[];
  try {
    files = (await safeReaddir(STICKERS_DIR)) as string[];
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[send_sticker] Cannot read stickers directory: ${errMsg}`);
    return;
  }

  const uniqueTags = new Set<string>();

  for (const file of files) {
    const entry = parseFileName(file);
    if (!entry) continue;

    catalog.set(entry.id, entry);
    for (const tag of entry.tags) {
      uniqueTags.add(tag);
    }
  }

  tagCloud = Array.from(uniqueTags).sort().join(', ');
  console.log(
    `[send_sticker] 📦 Catalog loaded: ${catalog.size} stickers, ${uniqueTags.size} unique tags`,
  );
}

/**
 * Invariant: returns an array sorted by descending score, length <= limit.
 * Score = number of query tokens that appear in the entry's tags or id.
 */
function searchStickers(intent: string, limit: number = TOP_MATCHES_COUNT): StickerSearchResult[] {
  const queryTokens = intent
    .toLowerCase()
    .replace(/[^a-z0-9àâäéèêëïîôùûüÿçæœ\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  if (queryTokens.length === 0) return [];

  const scored: StickerSearchResult[] = [];

  for (const entry of catalog.values()) {
    let score = 0;
    const allSearchable = [entry.id, ...entry.tags, ...entry.description.toLowerCase().split(' ')];

    for (const token of queryTokens) {
      for (const field of allSearchable) {
        if (field.includes(token) || token.includes(field)) {
          score++;
          break;
        }
      }
    }

    if (score > 0) {
      scored.push({
        id: entry.id,
        tags: entry.tags.join(', '),
        description: entry.description,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

function buildToolDefinition(): object {
  const availableHint = tagCloud ? `Available moods: ${tagCloud}.` : 'No stickers loaded yet.';

  return {
    type: 'function' as const,
    function: {
      name: 'send_sticker',
      description:
        'Send a sticker to react emotionally or complement your reply. ' +
        'Step 1: call with "intent" to find matching stickers (returns top 3). ' +
        'Step 2: call again with "sticker_name" to send the chosen one. ' +
        availableHint,
      parameters: {
        type: 'object',
        properties: {
          intent: {
            type: 'string',
            description:
              'Emotion or action to search (e.g. "bravo", "rire", "triste"). Returns top 3 matches.',
          },
          sticker_name: {
            type: 'string',
            description: 'Exact sticker ID to send (from a previous search result).',
          },
        },
        required: [],
      },
    },
  };
}

export default {
  name: 'send_sticker',
  description: 'Use to react with a sticker or complement your reply in moments that call for it.',
  version: '1.0.0',
  enabled: true,

  // Built dynamically at init — starts with a placeholder
  toolDefinition: buildToolDefinition(),

  async init(): Promise<void> {
    await scanStickers();
    // Rebuild the tool definition with the updated tag cloud
    this.toolDefinition = buildToolDefinition();
  },

  async _handleDirectSend(
    entry: StickerEntry,
    transport: { sendSticker: (chatId: string, buffer: Buffer) => Promise<unknown> },
    chatId: string,
  ): Promise<SendStickerResult> {
    try {
      const buffer = await safeReadFileBuffer(entry.filePath);
      await transport.sendSticker(chatId, buffer);
      return {
        success: true,
        message: `Sticker "${entry.id}" sent (${entry.description}).`,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[send_sticker] Error sending sticker "%s":', entry.id, errMsg);
      return { success: false, message: `Failed to send sticker: ${errMsg}` };
    }
  },

  async execute(args: unknown, context: unknown): Promise<SendStickerResult> {
    const { intent, sticker_name } = args as SendStickerArgs;
    const ctx = context as {
      transport?: { sendSticker: (chatId: string, buffer: Buffer) => Promise<unknown> };
      chatId?: string;
    };

    if (!ctx?.transport || !ctx?.chatId) {
      return { success: false, message: 'Transport or chatId missing from context.' };
    }

    // ── Mode 2: Direct send ──
    if (sticker_name) {
      const entry = catalog.get(sticker_name);
      if (!entry) {
        // Attempt fuzzy recovery: search with sticker_name as intent
        const fallbackMatches = searchStickers(sticker_name, TOP_MATCHES_COUNT);
        if (fallbackMatches.length > 0) {
          return {
            success: false,
            message: `Sticker "${sticker_name}" not found. Did you mean one of these?`,
            matches: fallbackMatches,
          };
        }
        return {
          success: false,
          message: `Sticker "${sticker_name}" not found and no similar stickers available.`,
        };
      }

      return await this._handleDirectSend(entry, ctx.transport, ctx.chatId);
    }

    // ── Mode 1: Search ──
    if (intent) {
      if (catalog.size === 0) {
        return { success: false, message: 'No stickers available in the library.' };
      }

      const matches = searchStickers(intent, TOP_MATCHES_COUNT);
      if (matches.length === 0) {
        return {
          success: false,
          message: `No stickers match "${intent}". Available moods: ${tagCloud}`,
        };
      }

      return {
        success: true,
        message: `Found ${matches.length} sticker(s) matching "${intent}". Pick one and call send_sticker with its sticker_name.`,
        matches,
      };
    }

    // ── No input ──
    return {
      success: false,
      message: 'Provide either "intent" (to search) or "sticker_name" (to send).',
    };
  },
};
