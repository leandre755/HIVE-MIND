// services/anchor/AnchorStateManager.ts
// ============================================================================
// ANCHOR STATE MANAGER — Stateful reconciliation engine for hash-anchored edits
//
// WHY THIS EXISTS:
// Line numbers are fragile: any insertion/deletion shifts all subsequent lines.
// Content-based search-and-replace is ambiguous: identical lines can't be
// distinguished. This system assigns a STABLE, UNIQUE word-anchor to each line
// that persists across file mutations. When a file changes, Myers Diff on
// content hashes determines which lines are unchanged (keep their anchors),
// which are new (get fresh anchors), and which are deleted (anchors freed).
//
// ARCHITECTURE:
// - Storage is scoped per task (LRU, max 50 tasks) → per file (LRU, max 1024)
// - Each file tracks: FNV-1a hashes, anchor words, used words set, available pool
// - Reconciliation runs in O(n) via diffArrays on integer hashes
// - Dictionary is embedded (no FS dependency) from hashDictionary.ts
// ============================================================================

import { randomInt } from 'crypto';
import { diffArrays } from 'diff';
import { ANCHOR_WORDS } from './hashDictionary.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface TrackedDocument {
  /** FNV-1a hashes per line, for fast change detection */
  readonly hashes: Uint32Array;
  /** Word anchors per line, 1:1 mapping with hashes */
  readonly anchors: readonly string[];
  /** All words currently assigned in this file */
  readonly usedWords: Set<string>;
  /** Remaining available words (pre-shuffled) */
  availablePool: string[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_TRACKED_LINES = 50_000;
const MAX_TRACKED_FILES = 1024;
const MAX_TRACKED_TASKS = 50;

// ── AnchorStateManager (Singleton) ─────────────────────────────────────────

/**
 * Manages per-file, per-task anchor assignments with LRU eviction.
 *
 * Invariant: After reconcile() returns, every line in the file has exactly
 * one unique anchor word, and that word is stable across mutations for
 * unchanged lines.
 */
export class AnchorStateManager {
  /** Task → (FilePath → TrackedDocument) */
  private static storage = new Map<string, Map<string, TrackedDocument>>();

  // ── FNV-1a Hashing ─────────────────────────────────────────────────────

  /**
   * Computes FNV-1a hashes for every line.
   * WHY Uint32Array: ~4x smaller than string[] and comparison is O(1) per element.
   */
  private static computeHashes(lines: readonly string[]): Uint32Array {
    const hashes = new Uint32Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      const line = lines.at(i) ?? '';
      let h = 2166136261; // FNV-1a offset basis
      for (let j = 0; j < line.length; j++) {
        h = Math.imul(h ^ line.charCodeAt(j), 16777619); // FNV-1a prime
      }
      Reflect.set(hashes, i, h >>> 0);
    }
    return hashes;
  }

  // ── Pool Management ────────────────────────────────────────────────────

  /**
   * Generates a batch of unique two-word combinations from the dictionary.
  private static refill(usedWords: Set<string>, pool: string[]): void {
    const dict = ANCHOR_WORDS;
    const dictLen = dict.length;
    const newWords: string[] = [];

    let attempts = 0;
    while (newWords.length < 10_000 && attempts < 50_000) {
      const w1 = dict.at(randomInt(0, dictLen)) ?? '';
      const w2 = dict.at(randomInt(0, dictLen)) ?? '';
      const word = `${w1}${w2}`;
      if (word && !usedWords.has(word)) {
        newWords.push(word);
      }
      attempts++;
    }

    // Fallback: three-word combinations if two-word space is exhausted
    if (newWords.length < 100) {
      for (let i = 0; i < 100; i++) {
        const w1 = dict.at(randomInt(0, dictLen)) ?? '';
        const w2 = dict.at(randomInt(0, dictLen)) ?? '';
        const w3 = dict.at(randomInt(0, dictLen)) ?? '';
        const word = `${w1}${w2}${w3}`;
        if (word && !usedWords.has(word)) {
          newWords.push(word);
        }
      }
    }

    // Fisher-Yates shuffle
    for (let i = newWords.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      const tempI = newWords.at(i) ?? '';
      const tempJ = newWords.at(j) ?? '';
      newWords[i] = tempJ;
      newWords[j] = tempI;
    }
    pool.push(...newWords);
  }

  /**
   * Pops a guaranteed-unique word from the pool, refilling if empty.
   */
  private static getUniqueWord(usedWords: Set<string>, pool: string[]): string {
    let word: string | undefined;
    while (!word) {
      if (pool.length === 0) {
        AnchorStateManager._ensurePoolRefilled(usedWords, pool);
      }
      const candidate = pool.pop();
      if (candidate && !usedWords.has(candidate)) {
        word = candidate;
      }
    }
    return word;
  }

  // ── Task/File State ────────────────────────────────────────────────────

  /**
   * Gets or creates the per-task state Map with LRU eviction.
   */
  private static getTaskState(taskId = 'default'): Map<string, TrackedDocument> {
    let state = AnchorStateManager.storage.get(taskId);
    if (!state) {
      state = new Map<string, TrackedDocument>();
      AnchorStateManager.storage.set(taskId, state);

      // LRU eviction for tasks
      if (AnchorStateManager.storage.size > MAX_TRACKED_TASKS) {
        const oldestTaskId = AnchorStateManager.storage.keys().next().value;
        if (oldestTaskId !== undefined) {
          AnchorStateManager.storage.delete(oldestTaskId);
        }
      }
    } else {
      // Refresh LRU position
      AnchorStateManager.storage.delete(taskId);
      AnchorStateManager.storage.set(taskId, state);
    }
    return state;
  }

  /**
   * Updates the tracked document in state with LRU eviction for files.
   */
  private static updateState(
    absolutePath: string,
    document: TrackedDocument,
    taskId?: string,
  ): void {
    const state = AnchorStateManager.getTaskState(taskId);
    // LRU: delete then re-insert
    state.delete(absolutePath);
    state.set(absolutePath, document);

    if (state.size > MAX_TRACKED_FILES) {
      const oldestKey = state.keys().next().value;
      if (oldestKey !== undefined) {
        state.delete(oldestKey);
      }
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * CORE METHOD: Reconciles current file content with saved state.
   *
   * Algorithm:
   * 1. Hash all current lines (FNV-1a → Uint32Array)
   * 2. If no prior state → assign fresh unique words to every line
   * 3. If hashes identical → return cached anchors (fast path)
   * 4. Otherwise → Myers Diff on hashes:
   *    - Unchanged lines: KEEP existing anchor words
   *    - Added lines: ASSIGN new unique words
   *    - Removed lines: advance old index (words freed implicitly)
   *
   * @param absolutePath - Full path to the file
   * @param currentLines - Array of current file lines (split by \n)
   * @param taskId       - Optional task scoping
   * @returns Array of anchor words, 1:1 with currentLines
   */
  private static _reconcileFirstTime(
    absolutePath: string,
    currentLines: readonly string[],
    currentHashes: Uint32Array,
    taskId?: string,
  ): string[] {
    const usedWords = new Set<string>();
    const pool = [...ANCHOR_WORDS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      const tempI = pool.at(i) ?? '';
      const tempJ = pool.at(j) ?? '';
      Reflect.set(pool, i, tempJ);
      Reflect.set(pool, j, tempI);
    }

    const anchors = currentLines.map(() => {
      const w = AnchorStateManager.getUniqueWord(usedWords, pool);
      usedWords.add(w);
      return w;
    });

    const tracked = { hashes: currentHashes, anchors, usedWords, availablePool: pool };
    AnchorStateManager.updateState(absolutePath, tracked, taskId);
    return anchors;
  }

  private static _ensurePoolRefilled(newUsedWords: Set<string>, pool: string[]): void {
    if (pool.length > 0 || newUsedWords.size >= ANCHOR_WORDS.length) return;
    for (const word of ANCHOR_WORDS) {
      if (!newUsedWords.has(word)) {
        pool.push(word);
      }
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      const tempI = pool.at(i) ?? '';
      const tempJ = pool.at(j) ?? '';
      Reflect.set(pool, i, tempJ);
      Reflect.set(pool, j, tempI);
    }
  }

  private static _applyDiffChange(
    change: import('diff').ChangeObject<number[]>,
    tracked: TrackedDocument,
    newUsedWords: Set<string>,
    pool: string[],
    newAnchors: string[],
    state: { oldIdx: number },
  ): void {
    const count = change.count || 0;
    if (change.added) {
      for (let i = 0; i < count; i++) {
        const word = AnchorStateManager.getUniqueWord(newUsedWords, pool);
        newAnchors.push(word);
        newUsedWords.add(word);
      }
    } else if (change.removed) {
      state.oldIdx += count;
    } else {
      for (let i = 0; i < count; i++) {
        const preservedWord = tracked.anchors.at(state.oldIdx) ?? '';
        newAnchors.push(preservedWord);
        newUsedWords.add(preservedWord);
        state.oldIdx++;
      }
    }
  }

  private static _reconcileDiff(
    absolutePath: string,
    currentHashes: Uint32Array,
    tracked: TrackedDocument,
    taskId?: string,
  ): string[] {
    const changes = diffArrays(Array.from(tracked.hashes), Array.from(currentHashes));
    const newAnchors: string[] = [];
    const newUsedWords = new Set<string>(tracked.usedWords);
    const pool = tracked.availablePool || [];

    AnchorStateManager._ensurePoolRefilled(newUsedWords, pool);

    const diffState = { oldIdx: 0 };
    for (const change of changes) {
      AnchorStateManager._applyDiffChange(
        change,
        tracked,
        newUsedWords,
        pool,
        newAnchors,
        diffState,
      );
    }

    const newTracked: TrackedDocument = {
      hashes: currentHashes,
      anchors: newAnchors,
      usedWords: newUsedWords,
      availablePool: pool,
    };
    AnchorStateManager.updateState(absolutePath, newTracked, taskId);
    return newAnchors;
  }

  private static _areHashesIdentical(h1: Uint32Array, h2: Uint32Array): boolean {
    if (h1.length !== h2.length) return false;
    for (let i = 0; i < h1.length; i++) {
      if (h1.at(i) !== h2.at(i)) return false;
    }
    return true;
  }

  public static reconcile(
    absolutePath: string,
    currentLines: readonly string[],
    taskId?: string,
  ): string[] {
    if (currentLines.length > MAX_TRACKED_LINES) {
      return currentLines.map((_, i) => `L${i + 1}`);
    }

    const state = AnchorStateManager.getTaskState(taskId);
    const currentHashes = AnchorStateManager.computeHashes(currentLines);
    const tracked = state.get(absolutePath);

    if (tracked && AnchorStateManager._areHashesIdentical(tracked.hashes, currentHashes)) {
      AnchorStateManager.updateState(absolutePath, tracked, taskId);
      return [...tracked.anchors];
    }

    if (!tracked) {
      return AnchorStateManager._reconcileFirstTime(
        absolutePath,
        currentLines,
        currentHashes,
        taskId,
      );
    }

    return AnchorStateManager._reconcileDiff(absolutePath, currentHashes, tracked, taskId);
  }

  /**
   * Returns true if the file is currently being tracked.
   */
  public static isTracking(absolutePath: string, taskId?: string): boolean {
    return AnchorStateManager.getTaskState(taskId).has(absolutePath);
  }

  /**
   * Gets current anchors for a tracked file, or null if untracked.
   */
  public static getAnchors(absolutePath: string, taskId?: string): string[] | null {
    const doc = AnchorStateManager.getTaskState(taskId).get(absolutePath);
    return doc ? [...doc.anchors] : null;
  }

  /**
   * Clears tracking state for a specific file.
   */
  public static clearState(absolutePath: string, taskId?: string): void {
    AnchorStateManager.getTaskState(taskId).delete(absolutePath);
  }

  /**
   * Resets all anchors for a specific task, or all tasks if no taskId given.
   */
  public static reset(taskId?: string): void {
    if (taskId) {
      AnchorStateManager.storage.delete(taskId);
    } else {
      AnchorStateManager.storage.clear();
    }
  }
}
