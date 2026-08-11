/**
 * services/ai/MultimodalEmbeddingService.ts
 * Gemini Embedding 2 — multimodal embeddings (text, image, video, audio, PDF)
 * with local HNSW index + JSON metadata storage in /mediaDB/.
 */

import {
  safeReadFileSync,
  safeReadFileSyncBuffer,
  safeWriteFileSync,
  safeRenameSync,
  safeMkdirSync,
  safeExistsSync,
  resolveWithinRoot,
} from '../../utils/safeFs.js';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { HierarchicalNSW } from 'hnswlib-node';

// ─── Config ────────────────────────────────────────────────────────────

export interface MultimodalEmbeddingConfig {
  geminiKey: string;
  dimensions?: number;
  dbPath?: string;
}

// ─── Media Input ───────────────────────────────────────────────────────

export type MediaModality = 'image' | 'video' | 'audio' | 'document' | 'text';

export interface MediaInput {
  type: MediaModality;
  data: string;
  mimeType?: string;
}

// ─── Stored Entry (metadata only — no vector) ─────────────────────────

export interface MediaEntry {
  id: string;
  contextId: string;
  filePath: string;
  fileName: string;
  modality: MediaModality;
  mimeType: string;
  fileSize: number;
  contentSummary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ─── Search Result ─────────────────────────────────────────────────────

export interface MediaSearchResult {
  id: string;
  filePath: string;
  fileName: string;
  modality: string;
  mimeType: string;
  contentSummary: string | null;
  metadata: Record<string, unknown>;
  similarity: number;
}

// ─── Index File Format ─────────────────────────────────────────────────

interface MediaIndexFile {
  version: number;
  dimensions: number;
  entries: MediaEntry[];
}

// ─── Gemini API types ──────────────────────────────────────────────────

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

interface GeminiEmbedResponse {
  embedding?: { values?: number[] };
}

interface GeminiErrorResponse {
  error?: { message?: string };
}

// ─── Constants ─────────────────────────────────────────────────────────

const DEFAULT_DIMENSIONS = 3072;
const GEMINI_EMBEDDING_2_MODEL = 'gemini-embedding-2';
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

// ─── MIME type detection ───────────────────────────────────────────────

const IMAGE_MIMES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

const VIDEO_MIMES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
};

const AUDIO_MIMES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};

const DOC_MIMES: Record<string, string> = {
  '.pdf': 'application/pdf',
};

function lookupMime(map: Record<string, string>, ext: string): string | undefined {
  if (Object.hasOwn(map, ext)) {
    return Reflect.get(map, ext) as string;
  }
  return undefined;
}

export function detectModality(filePath: string): MediaModality {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  if (lookupMime(IMAGE_MIMES, ext)) return 'image';
  if (lookupMime(VIDEO_MIMES, ext)) return 'video';
  if (lookupMime(AUDIO_MIMES, ext)) return 'audio';
  if (lookupMime(DOC_MIMES, ext)) return 'document';
  return 'text';
}

export function detectMimeType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return (
    lookupMime(IMAGE_MIMES, ext) ||
    lookupMime(VIDEO_MIMES, ext) ||
    lookupMime(AUDIO_MIMES, ext) ||
    lookupMime(DOC_MIMES, ext) ||
    'application/octet-stream'
  );
}

// ─── Main Service ──────────────────────────────────────────────────────

export class MultimodalEmbeddingService {
  private static readonly activeInstances = new Set<MultimodalEmbeddingService>();
  private static shutdownHooksRegistered = false;

  private readonly dimensions: number;
  private readonly dbPath: string;
  private readonly jsonPath: string;
  private readonly hnswPath: string;
  private readonly geminiKey: string;

  private entries: MediaEntry[] = [];
  private entryIndex: Map<string, number> = new Map();
  private hnsw: HierarchicalNSW | null = null;
  private hnswCapacity = 0;
  private dirty = false;

  constructor(config: MultimodalEmbeddingConfig) {
    this.geminiKey = config.geminiKey;
    this.dimensions = config.dimensions || DEFAULT_DIMENSIONS;
    this.dbPath = config.dbPath || join(process.cwd(), 'mediaDB');
    this.jsonPath = resolveWithinRoot(this.dbPath, 'media_embeddings.json');
    this.hnswPath = resolveWithinRoot(this.dbPath, 'media_vectors.dat');
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  init(): void {
    if (!safeExistsSync(this.dbPath)) {
      safeMkdirSync(this.dbPath, { recursive: true });
    }
    this._loadJson();
    this._initHnsw();
    this._registerShutdownHook();
    console.log(
      `[MediaDB] Ready at ${this.dbPath} (${this.entries.length} entries, ${this.dimensions}d)`,
    );
  }

  save(): void {
    this._saveJson();
    this._saveHnsw();
    this.dirty = false;
  }

  getEntryCount(): number {
    return this.entries.length;
  }

  // ── Embedding API calls ───────────────────────────────────────────

  async embedText(text: string): Promise<number[] | null> {
    if (!text || !text.trim()) return null;
    return this._callGeminiEmbed([{ text: text.replace(/\n/g, ' ') }]);
  }

  async embedImage(imagePath: string): Promise<number[] | null> {
    const parts = this._fileToParts(imagePath);
    return parts ? this._callGeminiEmbed(parts) : null;
  }

  async embedVideo(videoPath: string): Promise<number[] | null> {
    const parts = this._fileToParts(videoPath);
    return parts ? this._callGeminiEmbed(parts) : null;
  }

  async embedAudio(audioPath: string): Promise<number[] | null> {
    const parts = this._fileToParts(audioPath);
    return parts ? this._callGeminiEmbed(parts) : null;
  }

  async embedDocument(docPath: string): Promise<number[] | null> {
    const parts = this._fileToParts(docPath);
    return parts ? this._callGeminiEmbed(parts) : null;
  }

  async embedInterleaved(inputs: MediaInput[]): Promise<number[] | null> {
    if (inputs.length === 0) return null;

    const parts: GeminiPart[] = [];
    for (const input of inputs) {
      if (input.type === 'text') {
        parts.push({ text: input.data });
      } else {
        const fileParts = this._fileToParts(input.data, input.mimeType);
        if (fileParts) parts.push(fileParts[0]);
      }
    }

    return parts.length > 0 ? this._callGeminiEmbed(parts) : null;
  }

  // ── Index management ──────────────────────────────────────────────

  addEntry(entry: Omit<MediaEntry, 'id' | 'createdAt'>, embedding: number[]): string {
    const id = randomUUID();
    const fullEntry: MediaEntry = {
      ...entry,
      id,
      createdAt: new Date().toISOString(),
    };

    const vectorIndex = this.entries.length;
    this.entries.push(fullEntry);
    this.entryIndex.set(id, vectorIndex);

    this._ensureHnswCapacity(this.entries.length);
    this.hnsw!.addPoint(embedding, vectorIndex);

    this.dirty = true;
    return id;
  }

  search(
    queryEmbedding: number[],
    contextId: string,
    limit = 10,
    threshold = 0.5,
  ): MediaSearchResult[] {
    if (!this.hnsw || this.hnsw.getCurrentCount() === 0) return [];

    const k = Math.min(limit * 3, this.hnsw.getCurrentCount());
    const results = this.hnsw.searchKnn(queryEmbedding, k);

    const searchResults: MediaSearchResult[] = [];
    for (let i = 0; i < results.neighbors.length; i++) {
      const label = results.neighbors.at(i);
      const distance = results.distances.at(i);
      if (label === undefined || distance === undefined) continue;

      const similarity = 1 - distance;
      if (similarity < threshold) continue;

      const entry = this.entries.at(label);
      if (!entry || entry.contextId !== contextId) continue;

      searchResults.push({
        id: entry.id,
        filePath: entry.filePath,
        fileName: entry.fileName,
        modality: entry.modality,
        mimeType: entry.mimeType,
        contentSummary: entry.contentSummary,
        metadata: entry.metadata,
        similarity,
      });

      if (searchResults.length >= limit) break;
    }

    return searchResults;
  }

  getEntry(id: string): MediaEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  removeEntry(id: string): boolean {
    const idx = this.entryIndex.get(id);
    if (idx === undefined) return false;

    this.entries.splice(idx, 1);
    this.entryIndex.delete(id);
    this._rebuildEntryIndex();
    this.dirty = true;
    return true;
  }

  getContextEntries(contextId: string): MediaEntry[] {
    return this.entries.filter((e) => e.contextId === contextId);
  }

  updateEntrySummary(id: string, summary: string): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;
    entry.contentSummary = summary;
    this.dirty = true;
    return true;
  }

  getEntriesOlderThan(dateISO: string): MediaEntry[] {
    return this.entries.filter((e) => e.createdAt < dateISO);
  }

  removeEntries(ids: string[]): number {
    let removed = 0;
    for (const id of ids) {
      if (this.removeEntry(id)) removed++;
    }
    return removed;
  }

  // ── Private: Gemini API ──────────────────────────────────────────

  private async _callGeminiEmbed(parts: GeminiPart[]): Promise<number[] | null> {
    if (!this.geminiKey) {
      console.error('[MediaDB] Gemini API key missing');
      return null;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_2_MODEL}:embedContent?key=${this.geminiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${GEMINI_EMBEDDING_2_MODEL}`,
          content: { parts },
          outputDimensionality: this.dimensions,
        }),
      });

      if (!response.ok) {
        const err: GeminiErrorResponse = await response.json();
        console.error(`[MediaDB] Gemini Embedding 2 error: ${err.error?.message}`);
        return null;
      }

      const data: GeminiEmbedResponse = await response.json();
      return data.embedding?.values || null;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[MediaDB] Gemini Embedding 2 request failed: ${msg}`);
      return null;
    }
  }

  // ── Private: File helpers ────────────────────────────────────────

  private _readFileBuffer(filePath: string): Buffer | null {
    try {
      const buffer = safeReadFileSyncBuffer(filePath);
      if (buffer.length > MAX_INLINE_BYTES) {
        console.warn(`[MediaDB] File too large: ${filePath} (${buffer.length} bytes)`);
        return null;
      }
      return buffer;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[MediaDB] Failed to read ${filePath}: ${msg}`);
      return null;
    }
  }

  private _fileToParts(filePath: string, overrideMime?: string): GeminiPart[] | null {
    const buffer = this._readFileBuffer(filePath);
    if (!buffer) return null;
    const mimeType = overrideMime || detectMimeType(filePath);
    return [{ inlineData: { mimeType, data: buffer.toString('base64') } }];
  }

  // ── Private: JSON storage ────────────────────────────────────────

  private _loadJson(): void {
    try {
      if (!safeExistsSync(this.jsonPath)) {
        this.entries = [];
        this.entryIndex = new Map();
        return;
      }

      const raw = safeReadFileSync(this.jsonPath);
      const index: MediaIndexFile = JSON.parse(raw);

      this.entries = index.entries || [];
      this.entryIndex = new Map();
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries.at(i);
        if (entry) {
          this.entryIndex.set(entry.id, i);
        }
      }
    } catch (error: unknown) {
      console.error(
        `[MediaDB] Failed to load JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.entries = [];
      this.entryIndex = new Map();
    }
  }

  private _saveJson(): void {
    try {
      const index: MediaIndexFile = {
        version: 1,
        dimensions: this.dimensions,
        entries: this.entries,
      };

      const tmpPath = this.jsonPath + '.tmp';
      safeWriteFileSync(tmpPath, JSON.stringify(index, null, 2));
      safeRenameSync(tmpPath, this.jsonPath);
    } catch (error: unknown) {
      console.error(
        `[MediaDB] Failed to save JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Private: HNSW index ──────────────────────────────────────────

  private _initHnsw(): void {
    try {
      this.hnsw = new HierarchicalNSW('l2', this.dimensions);

      if (safeExistsSync(this.hnswPath)) {
        this.hnsw.readIndexSync(this.hnswPath);
        this.hnswCapacity = this.hnsw.getCurrentCount();
        console.log(`[MediaDB] Loaded HNSW: ${this.hnswCapacity} vectors`);
      } else {
        this.hnswCapacity = Math.max(100, this.entries.length * 2);
        this.hnsw.initIndex(this.hnswCapacity);
        console.log(`[MediaDB] Created HNSW (capacity: ${this.hnswCapacity})`);
      }
    } catch (error: unknown) {
      console.error(
        `[MediaDB] HNSW init failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.hnsw = null;
    }
  }

  private _saveHnsw(): void {
    if (!this.hnsw) return;
    try {
      this.hnsw.writeIndexSync(this.hnswPath);
    } catch (error: unknown) {
      console.error(
        `[MediaDB] Failed to save HNSW: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private _ensureHnswCapacity(needed: number): void {
    if (!this.hnsw) return;
    if (needed <= this.hnswCapacity) return;

    const newCapacity = Math.max(needed, this.hnswCapacity * 2);
    const newHnsw = new HierarchicalNSW('l2', this.dimensions);
    newHnsw.initIndex(newCapacity);

    const count = this.hnsw.getCurrentCount();
    for (let i = 0; i < count; i++) {
      const vector = this.hnsw.getPoint(i);
      newHnsw.addPoint(vector, i);
    }

    this.hnsw = newHnsw;
    this.hnswCapacity = newCapacity;
  }

  private _rebuildEntryIndex(): void {
    this.entryIndex = new Map();
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries.at(i);
      if (entry) this.entryIndex.set(entry.id, i);
    }
  }

  // ── Private: Shutdown hook ───────────────────────────────────────

  private _registerShutdownHook(): void {
    MultimodalEmbeddingService.activeInstances.add(this);
    if (MultimodalEmbeddingService.shutdownHooksRegistered) return;

    const saveDirtyInstances = () => {
      for (const instance of MultimodalEmbeddingService.activeInstances) {
        if (instance.dirty) instance.save();
      }
    };

    process.on('exit', saveDirtyInstances);
    process.on('SIGINT', () => {
      saveDirtyInstances();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      saveDirtyInstances();
      process.exit(0);
    });
    MultimodalEmbeddingService.shutdownHooksRegistered = true;
  }
}
