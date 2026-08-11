/**
 * services/memory/SemanticMemory.ts
 * Long-term semantic memory (RAG) using vector search.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { IEmbeddingsService } from '../ai/EmbeddingsService.js';

export interface IMemoryLogger {
  warn(msg: string): void;
  debug(tag: string, msg: string): void;
  error(msg: string): void;
}

export interface SemanticMemoryDependencies {
  supabase: SupabaseClient;
  embeddings: IEmbeddingsService;
  logger?: IMemoryLogger;
}

export interface MemoryRecord {
  id?: number;
  content: string;
  role: string;
  similarity: number;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

interface DbMemoryRow {
  id: number;
  content: string;
  role: string;
  similarity: number;
}

export class SemanticMemory {
  private readonly supabase: SupabaseClient;
  private readonly embeddings: IEmbeddingsService;
  private readonly logger?: IMemoryLogger;

  constructor(dependencies: SemanticMemoryDependencies) {
    this.supabase = dependencies.supabase;
    this.embeddings = dependencies.embeddings;
    this.logger = dependencies.logger;
  }

  async store(chatId: string, content: string, role: string): Promise<void> {
    if (!content || !this.supabase) return;

    try {
      // 0. Resolve Omni-Channel UUID
      const { default: db } = await import('../supabase.js');
      const resolved = await db.resolveContextFromLegacyId(chatId);
      if (!resolved) {
        this.logger?.warn(`[Memory] Could not resolve context ID for ${chatId}`);
        return;
      }

      // 1. Deduplication: Prevent storing exact duplicates (solves retry/reconnection duplication)
      const { data: existing } = await this.supabase
        .from('memories')
        .select('id')
        .eq('context_id', resolved.context_id)
        .eq('content', content)
        .eq('role', role)
        .limit(1);

      if (existing && existing.length > 0) {
        this.logger?.debug('memory', `Memory already exists for ${chatId}, skipping duplicate.`);
        return;
      }

      // 2. Vectorization
      const vector = await this.embeddings.embed(content);
      if (!vector) {
        this.logger?.warn('[Memory] Vectorization failed, memory not stored.');
        return;
      }

      // 3. Database Storage
      const { error } = await this.supabase.from('memories').insert({
        context_id: resolved.context_id,
        content,
        role,
        embedding: vector,
      });

      if (error) throw error;
      this.logger?.debug('memory', `Memory stored for ${chatId} (Role: ${role})`);
    } catch (error: unknown) {
      this.logger?.error(`[Memory] Store Error: ${extractErrorMessage(error)}`);
    }
  }

  async recall(chatId: string, query: string, limit: number = 5): Promise<MemoryRecord[]> {
    if (!this.supabase || !query) return [];

    try {
      // 0. Resolve Omni-Channel UUID
      const { default: db } = await import('../supabase.js');
      const resolved = await db.resolveContextFromLegacyId(chatId);
      if (!resolved) return [];

      // 1. Vectorize the current query
      const queryVector = await this.embeddings.embed(query);
      if (!queryVector) return [];

      // 2. RPC call to SQL search function
      const { data, error } = await this.supabase.rpc('match_memories', {
        query_embedding: queryVector,
        match_threshold: 0.7,
        match_count: limit,
        match_context_id: resolved.context_id,
      });

      if (error) throw error;

      const results = (data as DbMemoryRow[]).map((m: DbMemoryRow) => ({
        id: m.id,
        content: m.content,
        role: m.role,
        similarity: m.similarity,
      }));

      // [CMA] RETRIEVAL-DRIVEN MUTATION (NON-BLOQUANT)
      if (results.length > 0) {
        const idsToBoost = results.map((r) => r.id).filter((id) => id !== undefined && id !== null);
        if (idsToBoost.length > 0) {
          setImmediate(async () => {
            try {
              await this.supabase.rpc('cma_boost_memory', { memory_ids: idsToBoost });
              this.logger?.debug('memory', `[CMA] Renforcement de ${idsToBoost.length} souvenirs.`);
            } catch (e: unknown) {
              this.logger?.error(`[CMA] Error boosting memories: ${extractErrorMessage(e)}`);
            }
          });
        }
      }

      return results;
    } catch (error: unknown) {
      this.logger?.error(`[Memory] Recall Error: ${extractErrorMessage(error)}`);
      return [];
    }
  }

  async prune(chatId: string, keepLast: number = 50): Promise<void> {
    if (!this.supabase) return;

    try {
      const { default: db } = await import('../supabase.js');
      const resolved = await db.resolveContextFromLegacyId(chatId);
      if (!resolved) return;

      // Get IDs to keep
      const { data: keepIds } = await this.supabase
        .from('memories')
        .select('id')
        .eq('context_id', resolved.context_id)
        .order('created_at', { ascending: false })
        .limit(keepLast);

      if (!keepIds || keepIds.length === 0) return;

      const ids = keepIds.map((k: { id: number }) => k.id);

      // Delete everything else
      await this.supabase
        .from('memories')
        .delete()
        .eq('context_id', resolved.context_id)
        .not('id', 'in', `(${ids.join(',')})`);
    } catch (error: unknown) {
      this.logger?.error(`[Memory] Prune Error: ${extractErrorMessage(error)}`);
    }
  }

  /**
   * Compatibility alias for prune.
   */
  async cleanup(chatId: string, keepLast: number = 50): Promise<void> {
    return this.prune(chatId, keepLast);
  }

  /**
   * Placeholder for future LLM summarization.
   */
  async summarize(_chatId: string, _limit: number = 50): Promise<null> {
    this.logger?.warn('[Memory] Summarization not implemented in V2 RAG. Skipping.');
    return null;
  }
}
