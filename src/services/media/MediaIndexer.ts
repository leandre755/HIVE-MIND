/**
 * services/media/MediaIndexer.ts
 * Index media files (image, video, audio, document) into the local
 * /mediaDB/ via MultimodalEmbeddingService (Gemini Embedding 2 + HNSW).
 * Optional: LLM summary extraction for images, retention policy.
 */

import { safeStatSync, resolveWithinRoot } from '../../utils/safeFs.js';
import { basename } from 'path';
import {
  MultimodalEmbeddingService,
  detectModality,
  detectMimeType,
  type MediaModality,
} from '../ai/MultimodalEmbeddingService.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface IndexingResult {
  fileId: string;
  filePath: string;
  modality: MediaModality;
  success: boolean;
  error?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────

const SUMMARY_MODEL = 'gemini-2.0-flash';
const RETENTION_DAYS = 30;
const MAX_ENTRIES_PER_CONTEXT = 500;

// ─── Helpers ────────────────────────────────────────────────────────────

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

// ─── MediaIndexer ───────────────────────────────────────────────────────

export class MediaIndexer {
  private readonly embeddingService: MultimodalEmbeddingService;
  private readonly geminiKey: string;

  constructor(embeddingService: MultimodalEmbeddingService, geminiKey?: string) {
    this.embeddingService = embeddingService;
    this.geminiKey = geminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  }

  /**
   * Index a single file. Detects modality, embeds, stores metadata.
   * The file MUST exist on disk at the given path.
   */
  async indexFile(contextId: string, filePath: string): Promise<IndexingResult> {
    const modality = detectModality(filePath);

    if (modality === 'text') {
      return {
        fileId: '',
        filePath,
        modality,
        success: false,
        error: `Unsupported modality for: ${basename(filePath)}`,
      };
    }

    try {
      const stat = safeStatSync(filePath);
      const mimeType = detectMimeType(filePath);

      const embedding = await this._embedByModality(modality, filePath);
      if (!embedding) {
        return {
          fileId: '',
          filePath,
          modality,
          success: false,
          error: `Embedding failed for: ${basename(filePath)}`,
        };
      }

      const fileId = this.embeddingService.addEntry(
        {
          contextId,
          filePath,
          fileName: basename(filePath),
          modality,
          mimeType,
          fileSize: stat.size,
          contentSummary: null,
          metadata: {},
        },
        embedding,
      );

      this.embeddingService.save();

      // Fire-and-forget: generate summary for images
      if (modality === 'image' && this.geminiKey) {
        this._extractSummary(fileId, filePath).catch(() => {});
      }

      console.log(`[MediaIndexer] ✅ Indexed ${modality}: ${basename(filePath)} → ${fileId}`);

      return { fileId, filePath, modality, success: true };
    } catch (error: unknown) {
      const msg = extractErrorMessage(error);
      console.error(`[MediaIndexer] ❌ Failed to index ${basename(filePath)}: ${msg}`);
      return { fileId: '', filePath, modality, success: false, error: msg };
    }
  }

  /**
   * Index all indexable files in a directory (non-recursive, max 50 files).
   */
  async indexDirectory(contextId: string, dirPath: string): Promise<IndexingResult[]> {
    const { readdirSync } = await import('fs');
    const files = readdirSync(dirPath)
      .filter((f) => detectModality(f) !== 'text')
      .slice(0, 50);

    const results: IndexingResult[] = [];
    for (const file of files) {
      const result = await this.indexFile(contextId, resolveWithinRoot(dirPath, file));
      results.push(result);
    }

    const indexed = results.filter((r) => r.success).length;
    console.log(`[MediaIndexer] 📁 Directory index: ${indexed}/${results.length} files indexed`);
    return results;
  }

  /**
   * Generate an embedding for a file without storing it (preview/test).
   */
  async previewEmbedding(filePath: string): Promise<number[] | null> {
    const modality = detectModality(filePath);
    if (modality === 'text') return null;
    return this._embedByModality(modality, filePath);
  }

  // ── Retention Policy ─────────────────────────────────────────────

  /**
   * Remove entries older than RETENTION_DAYS, and cap per-context at MAX_ENTRIES.
   * Returns the number of entries removed.
   */
  applyRetention(): number {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
    const oldEntries = this.embeddingService.getEntriesOlderThan(cutoff);
    let removed = 0;

    // Age-based cleanup
    if (oldEntries.length > 0) {
      const ids = oldEntries.map((e) => e.id);
      removed += this.embeddingService.removeEntries(ids);
      console.log(
        `[MediaIndexer] 🧹 Removed ${oldEntries.length} entries older than ${RETENTION_DAYS}d`,
      );
    }

    // Per-context cap
    const contextIds = new Set(
      this.embeddingService.getContextEntries('' as string).map((e) => e.contextId),
    );
    for (const cid of contextIds) {
      const entries = this.embeddingService.getContextEntries(cid);
      if (entries.length > MAX_ENTRIES_PER_CONTEXT) {
        const excess = entries
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .slice(0, entries.length - MAX_ENTRIES_PER_CONTEXT);
        removed += this.embeddingService.removeEntries(excess.map((e) => e.id));
      }
    }

    if (removed > 0) {
      this.embeddingService.save();
      console.log(`[MediaIndexer] 📊 Retention: removed ${removed} entries`);
    }

    return removed;
  }

  // ── Summary Extraction ───────────────────────────────────────────

  /**
   * Extract a summary for an image using Gemini Vision (fire-and-forget).
   */
  private async _extractSummary(fileId: string, filePath: string): Promise<void> {
    if (!this.geminiKey) return;

    try {
      const { readFileSync } = await import('fs');
      const buffer = readFileSync(filePath);
      const base64 = buffer.toString('base64');
      const mimeType = detectMimeType(filePath);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${SUMMARY_MODEL}:generateContent?key=${this.geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: 'Describe this image concisely in 1-2 sentences. Focus on the main subject and context.',
                  },
                  { inlineData: { mimeType, data: base64 } },
                ],
              },
            ],
          }),
        },
      );

      if (!response.ok) return;

      const data = (await response.json()) as Record<string, unknown>;
      const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
      const firstCandidate = candidates?.[0];
      const content = firstCandidate?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, unknown>> | undefined;
      const text = (parts?.[0] as Record<string, unknown> | undefined)?.text as string | undefined;

      if (text) {
        this.embeddingService.updateEntrySummary(fileId, text.trim());
        this.embeddingService.save();
        console.log(
          `[MediaIndexer] 📝 Summary for ${basename(filePath)}: ${text.trim().slice(0, 80)}...`,
        );
      }
    } catch {
      // Summary extraction is best-effort — never crash
    }
  }

  // ── Private ────────────────────────────────────────────────────────

  private async _embedByModality(
    modality: MediaModality,
    filePath: string,
  ): Promise<number[] | null> {
    switch (modality) {
      case 'image':
        return this.embeddingService.embedImage(filePath);
      case 'video':
        return this.embeddingService.embedVideo(filePath);
      case 'audio':
        return this.embeddingService.embedAudio(filePath);
      case 'document':
        return this.embeddingService.embedDocument(filePath);
      default:
        return null;
    }
  }
}
