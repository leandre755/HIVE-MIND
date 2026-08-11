// services/agentMemory.ts
// Mémoire épisodique des actions de l'agent
// Utilise la table Supabase agent_actions pour tracer et apprendre de chaque action

import dbClient, { supabase } from './supabase.js';

/**
 * Service de mémoire épisodique
 * Enregistre toutes les actions de l'agent pour:
 * - Debugging et audit
 * - Apprentissage des erreurs (éviter répétition)
 * - Statistiques d'utilisation
 */

interface AgentActionParams {
  [key: string]: unknown;
}

interface AgentActionResult {
  [key: string]: unknown;
}

interface AgentActionRow {
  tool_name: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface ToolStats {
  success: number;
  error: number;
}

interface LessonLearned {
  tool: string;
  error: string | null;
  when: string;
}

interface HasFailureResult {
  hasFailure: boolean;
  errorMessage: string | null;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function requireSupabase(): NonNullable<typeof supabase> {
  if (!supabase) throw new Error('[AgentMemory] Supabase client not initialized');
  return supabase;
}

export const agentMemory = {
  async logAction(
    chatId: string,
    toolName: string,
    params: AgentActionParams,
    result: AgentActionResult,
    status: 'success' | 'error',
    errorMessage: string | null = null,
  ): Promise<void> {
    try {
      const resolved = await dbClient.resolveContextFromLegacyId(chatId);
      if (!resolved) return;

      const { error } = await requireSupabase().from('agent_actions').insert({
        context_id: resolved.context_id,
        tool_name: toolName,
        params,
        result,
        status,
        error_message: errorMessage,
      });

      if (error) {
        console.warn('[AgentMemory] Erreur log action:', error.message);
      }
    } catch (error: unknown) {
      console.warn('[AgentMemory] Exception log:', extractErrorMessage(error));
    }
  },

  async getRecentActions(chatId: string, limit: number = 5): Promise<AgentActionRow[]> {
    try {
      const resolved = await dbClient.resolveContextFromLegacyId(chatId);
      if (!resolved) return [];

      const { data, error } = await requireSupabase()
        .from('agent_actions')
        .select('tool_name, status, error_message, created_at')
        .eq('context_id', resolved.context_id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data ?? []) as AgentActionRow[];
    } catch (error: unknown) {
      console.warn('[AgentMemory] Erreur getRecentActions:', extractErrorMessage(error));
      return [];
    }
  },

  async hasRecentFailure(
    chatId: string,
    toolName: string,
    withinMinutes: number = 30,
  ): Promise<HasFailureResult> {
    try {
      const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();

      const resolved = await dbClient.resolveContextFromLegacyId(chatId);
      if (!resolved) return { hasFailure: false, errorMessage: null };

      const { data, error } = await requireSupabase()
        .from('agent_actions')
        .select('error_message')
        .eq('context_id', resolved.context_id)
        .eq('tool_name', toolName)
        .eq('status', 'error')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        return {
          hasFailure: true,
          errorMessage: data[0].error_message,
        };
      }

      return { hasFailure: false, errorMessage: null };
    } catch (error: unknown) {
      console.warn('[AgentMemory] Erreur hasRecentFailure:', extractErrorMessage(error));
      return { hasFailure: false, errorMessage: null };
    }
  },

  async getToolStats(chatId: string): Promise<Record<string, ToolStats>> {
    try {
      const resolved = await dbClient.resolveContextFromLegacyId(chatId);
      if (!resolved) return {};

      const { data, error } = await requireSupabase()
        .from('agent_actions')
        .select('tool_name, status')
        .eq('context_id', resolved.context_id);

      if (error) throw error;

      const stats = new Map<string, ToolStats>();
      for (const row of (data ?? []) as AgentActionRow[]) {
        const current = stats.get(row.tool_name) ?? { success: 0, error: 0 };
        if (row.status === 'success') {
          current.success++;
        } else if (row.status === 'error') {
          current.error++;
        }
        stats.set(row.tool_name, current);
      }

      return Object.fromEntries(stats);
    } catch (error: unknown) {
      console.warn('[AgentMemory] Erreur getToolStats:', extractErrorMessage(error));
      return {};
    }
  },

  async getLessonsLearned(chatId: string, limit: number = 3): Promise<LessonLearned[]> {
    try {
      const resolved = await dbClient.resolveContextFromLegacyId(chatId);
      if (!resolved) return [];

      const { data, error } = await requireSupabase()
        .from('agent_actions')
        .select('tool_name, error_message, created_at')
        .eq('context_id', resolved.context_id)
        .eq('status', 'error')
        .not('error_message', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return ((data ?? []) as AgentActionRow[]).map((d) => ({
        tool: d.tool_name,
        error: d.error_message,
        when: d.created_at,
      }));
    } catch (error: unknown) {
      console.warn('[AgentMemory] Erreur getLessonsLearned:', extractErrorMessage(error));
      return [];
    }
  },

  async getGlobalLessonsLearned(limit: number = 10): Promise<LessonLearned[]> {
    try {
      const { data, error } = await requireSupabase()
        .from('agent_actions')
        .select('tool_name, error_message, created_at')
        .eq('status', 'error')
        .not('error_message', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return ((data ?? []) as AgentActionRow[]).map((d) => ({
        tool: d.tool_name,
        error: d.error_message,
        when: d.created_at,
      }));
    } catch (error: unknown) {
      console.warn('[AgentMemory] Erreur getGlobalLessonsLearned:', extractErrorMessage(error));
      return [];
    }
  },
};

export default agentMemory;
