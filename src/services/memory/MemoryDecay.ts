/**
 * services/memory/MemoryDecay.ts
 * Intellectual forgetting management system.
 * Implements a memory aging system based on recency, frequency, and importance.
 */

import { supabase } from '../supabase.js';

export interface MemoryRecord {
  id: string;
  context_id: string;
  content: string;
  created_at: string;
  role: string;
  recall_count?: number;
  decay_score?: number;
  archived_at?: string | null;
}

export interface DecayResult {
  processed: number;
  archived: number;
  kept: number;
  error?: string;
}

export interface DecayStats {
  total: number;
  active: number;
  archived: number;
  avgScore: string;
  retention: string;
}

interface ScoreComponents {
  recency: number;
  frequency: number;
  importance: number;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

export class MemoryDecaySystem {
  private readonly tau = 24;
  private readonly scoreThreshold = 0.3;
  private readonly importanceKeywords = [
    'promis',
    'engagement',
    'rdv',
    'rendez-vous',
    'deadline',
    'important',
    'critique',
    'urgent',
    'préfère',
    'déteste',
    'aime',
    'jamais',
    'toujours',
    'rappelle-moi',
    'note',
  ];

  async scoreMemory(
    memory: MemoryRecord,
  ): Promise<{ score: number; components: ScoreComponents; keep: boolean; ageHours: number }> {
    const now = Date.now();
    const createdAt = new Date(memory.created_at).getTime();
    const ageHours = (now - createdAt) / (1000 * 60 * 60);

    const recency = Math.exp(-ageHours / this.tau);
    const recallCount = memory.recall_count || 0;
    const frequency = Math.min(recallCount / 10, 1);
    const importance = await this._detectImportance(memory.content);
    const score = recency * 0.4 + frequency * 0.3 + importance * 0.3;

    return {
      score,
      components: { recency, frequency, importance },
      keep: score > this.scoreThreshold,
      ageHours: Math.round(ageHours),
    };
  }

  private async _detectImportance(content: string): Promise<number> {
    const lowerContent = content.toLowerCase();
    let keywordScore = 0;

    for (const keyword of this.importanceKeywords) {
      if (lowerContent.includes(keyword)) {
        keywordScore += 0.2;
      }
    }

    return Math.min(keywordScore, 1.0);
  }

  async decay(chatId: string): Promise<DecayResult> {
    console.log(`[MemoryDecay] 🧹 Starting decay cycle for ${chatId}...`);

    try {
      if (!supabase) throw new Error('Supabase client not initialized');

      const { default: db } = await import('../supabase.js');
      const resolved = await db.resolveContextFromLegacyId(chatId);
      const contextId = resolved ? resolved.context_id : chatId;

      const { data: memories, error } = await supabase
        .from('memories')
        .select('*')
        .eq('context_id', contextId)
        .eq('role', 'assistant')
        .is('archived_at', null);

      if (error) throw error;
      if (!memories || memories.length === 0) {
        console.log(`[MemoryDecay] No memories to process for ${chatId}`);
        return { processed: 0, archived: 0, kept: 0 };
      }

      let archivedCount = 0;
      let keptCount = 0;
      const memoriesToArchive: MemoryRecord[] = [];
      const updatePromises: PromiseLike<unknown>[] = [];

      for (const memory of memories as MemoryRecord[]) {
        const { score, keep, ageHours } = await this.scoreMemory(memory);

        if (!keep) {
          const p = supabase
            .from('memories')
            .update({
              archived_at: new Date().toISOString(),
              decay_score: score,
            })
            .eq('id', memory.id);
          updatePromises.push(p);

          archivedCount++;
          memoriesToArchive.push(memory);
          console.log(
            `[MemoryDecay] ⚰️ Archived: ID ${memory.id} (age=${ageHours}h, score=${score.toFixed(2)})`,
          );
        } else {
          const p = supabase.from('memories').update({ decay_score: score }).eq('id', memory.id);
          updatePromises.push(p);

          keptCount++;
        }
      }

      await Promise.all(updatePromises);

      console.log(
        `[MemoryDecay] ✅ ${chatId}: ${archivedCount} archived, ${keptCount} kept (${memories.length} total)`,
      );

      if (memoriesToArchive.length >= 5) {
        setImmediate(() => {
          this._consolidateMemories(chatId, memoriesToArchive);
        });
      }

      return {
        processed: memories.length,
        archived: archivedCount,
        kept: keptCount,
      };
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      console.error('[MemoryDecay] Error:', errorMessage);
      return { processed: 0, archived: 0, kept: 0, error: errorMessage };
    }
  }

  private async _consolidateMemories(chatId: string, oldMemories: MemoryRecord[]): Promise<void> {
    console.log(
      `[CMA] 💤 Consolidation de ${oldMemories.length} souvenirs archivés pour ${chatId}...`,
    );
    const transcript = oldMemories.map((m) => m.content).join('\n---\n');

    const prompt = `Synthesize these old, archived memories into ONE dense, high-level factual statement (a "Gist") about the user or session. Discard conversational noise, pleasantries, and logs. Max 2 sentences.\n\nMemories to consolidate:\n${transcript}`;

    try {
      const { providerRouter } = await import('../../providers/index.js');

      const systemPrompt = `You are a high-level cognitive synthesizer of HIVE-MIND.
Your mission is to consolidate archived memories into a single high-level Gist.

<output_format>
Format: A single dense factual sentence or maximum 2 sentences. No greetings, no introductions, no explanations.

Few-shot examples:
- The user is troubleshooting a Node.js project deployment on Railway using GitHub actions.
- The administrator configured sticker generation capabilities for group members.
</output_format>`;

      const response = await providerRouter.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        { category: 'FAST_CHAT', temperature: 0.2 },
      );

      if (response && response.content) {
        const { default: memoryService } = await import('../memory.js');
        const semanticMemory = memoryService.semanticMemory;

        await semanticMemory.store(chatId, `[CONSOLIDATED GIST] ${response.content}`, 'assistant');
        console.log(`[CMA] 🌠 Gist créé et stocké : ${response.content.substring(0, 80)}...`);
      }
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      console.error('[CMA] Erreur lors de la consolidation des souvenirs :', errorMessage);
    }
  }

  async decayAll(): Promise<{ chats: number; archived: number; kept: number; error?: string }> {
    console.log('[MemoryDecay] 🌍 Starting global decay cycle...');

    try {
      if (!supabase) throw new Error('Supabase client not initialized');

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data: activeChats, error } = await supabase
        .from('memories')
        .select('context_id')
        .gte('created_at', sevenDaysAgo)
        .is('archived_at', null);

      if (error) throw error;

      const uniqueContexts: string[] = [
        ...new Set(
          (activeChats || [])
            .map((m: { context_id: string | null }) => m.context_id)
            .filter((id): id is string => id !== null && id !== undefined),
        ),
      ];

      console.log(`[MemoryDecay] ${uniqueContexts.length} active contexts detected`);

      let totalArchived = 0;
      let totalKept = 0;

      for (const contextId of uniqueContexts) {
        const result = await this.decay(contextId);
        totalArchived += result.archived;
        totalKept += result.kept;
      }

      console.log(
        `[MemoryDecay] ✅ Global cycle completed: ${totalArchived} archived, ${totalKept} kept`,
      );

      return {
        chats: uniqueContexts.length,
        archived: totalArchived,
        kept: totalKept,
      };
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      console.error('[MemoryDecay] Global cycle error:', errorMessage);
      return { chats: 0, archived: 0, kept: 0, error: errorMessage };
    }
  }

  async getStats(chatId: string | null = null): Promise<DecayStats | null> {
    try {
      if (!supabase) return null;

      let query = supabase.from('memories').select('decay_score, archived_at, created_at');

      if (chatId) {
        const { default: db } = await import('../supabase.js');
        const resolved = await db.resolveContextFromLegacyId(chatId);
        const contextId = resolved ? resolved.context_id : chatId;
        query = query.eq('context_id', contextId);
      }

      const { data: memories } = await query;

      if (!memories) return null;

      const active = memories.filter((m) => !m.archived_at);
      const archivedMemories = memories.filter((m) => m.archived_at);

      const avgScoreActive =
        active.length > 0
          ? active.reduce((sum, m) => sum + (m.decay_score || 0), 0) / active.length
          : 0;

      return {
        total: memories.length,
        active: active.length,
        archived: archivedMemories.length,
        avgScore: avgScoreActive.toFixed(3),
        retention: ((active.length / memories.length) * 100).toFixed(1) + '%',
      };
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      console.error('[MemoryDecay] Stats error:', errorMessage);
      return null;
    }
  }
}

export const memoryDecay = new MemoryDecaySystem();
export default memoryDecay;
