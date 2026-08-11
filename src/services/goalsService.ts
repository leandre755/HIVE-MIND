// services/goalsService.js
// Service de gestion des objectifs autonomes du bot

import { supabase } from './supabase.js';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

type GoalTriggerType = 'TIME' | 'EVENT';
type GoalOrigin = 'self' | 'user' | 'system';
type GoalStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

interface GoalCondition {
  readonly from_user?: string;
  readonly contains?: string;
}

interface GoalRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: GoalStatus;
  readonly target_chat_id: string | null;
  readonly priority: number;
  readonly origin: GoalOrigin;
  readonly trigger_type: GoalTriggerType;
  readonly trigger_event: string | null;
  readonly trigger_condition: GoalCondition | null;
  readonly execute_at: string;
  readonly created_at: string;
  readonly result: string | null;
}

interface CreateGoalParams {
  title: string;
  description: string;
  executeAt: string;
  targetChatId?: string | null;
  priority?: number;
  origin?: GoalOrigin;
  triggerType?: GoalTriggerType;
  triggerEvent?: string | null;
  triggerCondition?: GoalCondition;
}

interface TriggerMessage {
  sender?: string;
  senderName?: string;
  text?: string;
  chatId?: string;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function requireSupabase(): NonNullable<typeof supabase> {
  if (!supabase) throw new Error('[GoalsService] Supabase client not initialized');
  return supabase;
}

/**
 * Goals Service - Permet au bot de s'auto-assigner des tâches persistantes
 */
export const goalsService = {
  async createGoal({
    title,
    description,
    executeAt,
    targetChatId = null,
    priority = 5,
    origin = 'self',
    triggerType = 'TIME',
    triggerEvent = null,
    triggerCondition = {},
  }: CreateGoalParams): Promise<GoalRow> {
    try {
      const { data, error } = await requireSupabase()
        .from('autonomous_goals')
        .insert({
          title,
          description,
          execute_at: executeAt,
          target_chat_id: targetChatId,
          priority,
          origin,
          trigger_type: triggerType,
          trigger_event: triggerEvent,
          trigger_condition: triggerCondition,
        })
        .select()
        .single();

      if (error) throw error;
      console.log(`[GoalsService] ✅ Objectif créé: "${title}"`);
      return data as GoalRow;
    } catch (error: unknown) {
      console.error('[GoalsService] Erreur createGoal:', extractErrorMessage(error));
      throw error;
    }
  },

  async getPendingGoals(): Promise<GoalRow[]> {
    try {
      const { data, error } = await requireSupabase()
        .from('autonomous_goals')
        .select('*')
        .eq('status', 'pending')
        .lte('execute_at', new Date().toISOString())
        .order('priority', { ascending: false })
        .order('execute_at', { ascending: true });

      if (error) throw error;
      return (data as GoalRow[]) || [];
    } catch (error: unknown) {
      console.error('[GoalsService] Erreur getPendingGoals:', extractErrorMessage(error));
      return [];
    }
  },

  async getDueGoals(): Promise<GoalRow[]> {
    return this.getPendingGoals();
  },

  async markInProgress(goalId: string): Promise<void> {
    try {
      const { error } = await requireSupabase()
        .from('autonomous_goals')
        .update({ status: 'in_progress' })
        .eq('id', goalId);

      if (error) throw error;
    } catch (error: unknown) {
      console.error('[GoalsService] Erreur markInProgress:', extractErrorMessage(error));
    }
  },

  async completeGoal(goalId: string, result: unknown): Promise<void> {
    try {
      const { error } = await requireSupabase()
        .from('autonomous_goals')
        .update({
          status: 'completed',
          result: typeof result === 'object' ? JSON.stringify(result) : String(result),
        })
        .eq('id', goalId);

      if (error) throw error;
      console.log(`[GoalsService] ✅ Objectif complété: ${goalId}`);
    } catch (error: unknown) {
      console.error('[GoalsService] Erreur completeGoal:', extractErrorMessage(error));
    }
  },

  async cancelGoal(goalId: string): Promise<void> {
    try {
      const { error } = await requireSupabase()
        .from('autonomous_goals')
        .update({ status: 'cancelled' })
        .eq('id', goalId);

      if (error) throw error;
      console.log(`[GoalsService] ⚠️ Objectif annulé: ${goalId}`);
    } catch (error: unknown) {
      console.error('[GoalsService] Erreur cancelGoal:', extractErrorMessage(error));
    }
  },

  _isGoalTriggered(goal: GoalRow, message: TriggerMessage): boolean {
    if (goal.trigger_event !== 'WAIT_FOR_MESSAGE') return false;

    const condition: GoalCondition = goal.trigger_condition || {};
    if (condition.from_user) {
      const sender = message.sender || '';
      const name = message.senderName || '';
      if (!sender.includes(condition.from_user) && !name.includes(condition.from_user)) {
        return false;
      }
    }

    if (condition.contains) {
      const text = (message.text || '').toLowerCase();
      const keyword = condition.contains.toLowerCase();
      if (!text.includes(keyword)) {
        return false;
      }
    }

    if (goal.target_chat_id && message.chatId !== goal.target_chat_id) {
      return false;
    }

    return true;
  },

  async checkEventTriggers(message: TriggerMessage): Promise<GoalRow[]> {
    try {
      const { data: eventGoals, error } = await requireSupabase()
        .from('autonomous_goals')
        .select('*')
        .eq('status', 'pending')
        .eq('trigger_type', 'EVENT');

      if (error) throw error;
      if (!eventGoals || eventGoals.length === 0) return [];

      const triggeredGoals: GoalRow[] = [];
      for (const rawGoal of eventGoals) {
        const goal = rawGoal as GoalRow;
        if (this._isGoalTriggered(goal, message)) {
          triggeredGoals.push(goal);
        }
      }

      return triggeredGoals;
    } catch (error: unknown) {
      console.error('[GoalsService] Erreur checkEventTriggers:', extractErrorMessage(error));
      return [];
    }
  },

  async getChatGoals(chatId: string): Promise<GoalRow[]> {
    try {
      const { data, error } = await requireSupabase()
        .from('autonomous_goals')
        .select('*')
        .eq('target_chat_id', chatId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data as GoalRow[]) || [];
    } catch (error: unknown) {
      console.error('[GoalsService] Erreur getChatGoals:', extractErrorMessage(error));
      return [];
    }
  },

  parseDuration(duration: string): Date {
    const now = new Date();

    const hourMatch = duration.match(/^(\d+)h$/);
    if (hourMatch) {
      now.setHours(now.getHours() + parseInt(hourMatch[1]));
      return now;
    }

    const dayMatch = duration.match(/^(\d+)d$/);
    if (dayMatch) {
      now.setDate(now.getDate() + parseInt(dayMatch[1]));
      return now;
    }

    const minMatch = duration.match(/^(\d+)m(?:in)?$/);
    if (minMatch) {
      now.setMinutes(now.getMinutes() + parseInt(minMatch[1]));
      return now;
    }

    if (duration.toLowerCase().includes('tomorrow')) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow;
    }

    now.setHours(now.getHours() + 1);
    return now;
  },
};

export default goalsService;
