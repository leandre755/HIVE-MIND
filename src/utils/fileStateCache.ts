import { safeStatSync } from './safeFs.js';
import * as crypto from 'crypto';

export interface CachedFileState {
  mtimeMs: number;
  contentHash: string;
  size: number;
}

export class FileStateCache {
  private cache = new Map<string, CachedFileState>();
  private maxCapacity: number;

  constructor(maxCapacity = 200) {
    this.maxCapacity = maxCapacity;
  }

  set(filePath: string, state: CachedFileState): void {
    if (this.cache.has(filePath)) {
      this.cache.delete(filePath);
    } else if (this.cache.size >= this.maxCapacity) {
      // Delete the oldest entry (first key in iteration order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(filePath, state);
  }

  get(filePath: string): CachedFileState | undefined {
    const value = this.cache.get(filePath);
    if (value) {
      // Move key to the end to maintain LRU order
      this.cache.delete(filePath);
      this.cache.set(filePath, value);
    }
    return value;
  }

  has(filePath: string): boolean {
    return this.cache.has(filePath);
  }

  delete(filePath: string): boolean {
    return this.cache.delete(filePath);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * Helper to compute state of a file and add it to cache.
   */
  recordFile(filePath: string, content: string): CachedFileState | null {
    try {
      const stats = safeStatSync(filePath);
      const contentHash = crypto.createHash('sha256').update(content).digest('hex');
      const state: CachedFileState = {
        mtimeMs: stats.mtimeMs,
        contentHash,
        size: stats.size,
      };
      this.set(filePath, state);
      return state;
    } catch {
      return null;
    }
  }
}

export const fileStateCache = new FileStateCache(200);
