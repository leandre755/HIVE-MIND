/**
 * services/memory/ActionMemory.ts
 * Dynamic action memory service.
 * Allows the bot to remember ongoing actions when the conversation subject changes.
 */

import { redis } from '../redisClient.js';
import dbClient, { supabase } from '../supabase.js';

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export interface ActionStep {
  step: string;
  timestamp: number;
}

export interface OngoingAction {
  id: string;
  chatId: string;
  type: string;
  goal: string;
  context: Record<string, unknown>;
  priority: number;
  status: 'active' | 'completed' | 'interrupted';
  steps: ActionStep[];
  startedAt: number;
  updatedAt?: number;
  expiresAt?: number;
}

interface ActionData {
  [key: string]: string;
}

interface ResumableAction {
  id: string;
  chatId: string;
  type: string;
  params: Record<string, unknown>;
  steps: ActionStep[];
  createdAt: number;
}

export class ActionMemory {
  private readonly keyPrefix = 'action:';
  private readonly defaultTTL = 3600; // 1 hour
  private initialized = false;

  constructor() {
    this.startOrphanCleanup();
  }

  /**
   * Initializes the service.
   */
  public init(): void {
    this.initialized = true;
  }

  /**
   * Starts a new action.
   * @param chatId Chat ID.
   * @param action { type, goal, context, priority }
   * @returns Action ID.
   */
  async startAction(
    chatId: string,
    { type, goal, context = {}, priority = 5 }: Partial<OngoingAction>,
  ): Promise<string | null> {
    const actionId = `${chatId}:${Date.now()}`;
    const actionData: ActionData = {
      id: actionId,
      chatId,
      type: type || '',
      goal: goal || '',
      context: JSON.stringify(context),
      priority: priority.toString(),
      status: 'active',
      steps: JSON.stringify([]),
      startedAt: Date.now().toString(),
      expiresAt: (Date.now() + this.defaultTTL * 1000).toString(),
    };

    try {
      // Store in Redis with TTL
      const key = `${this.keyPrefix}${chatId}`;
      await redis.hSet(key, actionData);
      await redis.expire(key, this.defaultTTL);

      // Log in Supabase for history
      if (supabase) {
        const resolved = await dbClient.resolveContextFromLegacyId(chatId);
        if (resolved) {
          await supabase.from('agent_actions').insert({
            context_id: resolved.context_id,
            tool_name: type,
            params: JSON.stringify({ goal, context }),
            status: 'active',
          });
        }
      }

      console.log(`[ActionMemory] 🎬 Action started: ${type} (${goal})`);
      return actionId;
    } catch (error: unknown) {
      console.error('[ActionMemory] Error startAction:', extractErrorMessage(error));
      return null;
    }
  }

  /**
   * Retrieves the active action for a chat.
   * @param chatId Chat ID.
   * @returns Action object or null.
   */
  async getActiveAction(chatId: string): Promise<OngoingAction | null> {
    try {
      const key = `${this.keyPrefix}${chatId}`;
      const data = await redis.hGetAll(key);

      if (!data || Object.keys(data).length === 0) {
        return null;
      }

      // Reconstruct action object from Redis hash
      return {
        id: data.id,
        chatId: data.chatId,
        type: data.type,
        goal: data.goal,
        steps: JSON.parse(data.steps || '[]'),
        status: (data.status as 'active' | 'completed' | 'interrupted') || 'active',
        startedAt: parseInt(data.startedAt),
        updatedAt: data.updatedAt ? parseInt(data.updatedAt) : undefined,
        context: JSON.parse(data.context || '{}'),
        priority: parseInt(data.priority),
      };
    } catch (error: unknown) {
      console.error('[ActionMemory] Error getActiveAction %s:', chatId, extractErrorMessage(error));
      return null;
    }
  }

  /**
   * Automatic cleanup of orphan actions (every hour).
   * @private
   */
  private startOrphanCleanup(): void {
    setInterval(
      async () => {
        // We don't block cleanup even if not "initialized" as long as clients are ready
        try {
          console.log('[ActionMemory] 🧹 Starting orphan actions cleanup...');
          await this._cleanupRedisOrphans();
          await this._cleanupSupabaseOrphans();
          console.log('[ActionMemory] ✅ Cleanup completed');
        } catch (error: unknown) {
          console.error('[ActionMemory] ❌ Cleanup error:', extractErrorMessage(error));
        }
      },
      60 * 60 * 1000,
    );
  }

  private async _cleanupRedisOrphans(): Promise<void> {
    try {
      const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24h
      const pattern = 'action:*';
      const keys = await redis.keys(pattern);

      let cleaned = 0;
      for (const key of keys) {
        const data = await redis.hGetAll(key);
        if (!data || Object.keys(data).length === 0) continue;

        const updatedAt = data.updatedAt ? parseInt(data.updatedAt) : parseInt(data.startedAt);
        if (data.status === 'active' && updatedAt < cutoffTime) {
          await redis.del(key);
          cleaned++;
          console.log(`[ActionMemory] 🗑️ Orphan action removed from Redis: ${key}`);
        }
      }

      if (cleaned > 0) {
        console.log(`[ActionMemory] Cleaned ${cleaned} orphan Redis actions`);
      }
    } catch (error: unknown) {
      console.error('[ActionMemory] Redis cleanup error:', extractErrorMessage(error));
    }
  }

  private async _cleanupSupabaseOrphans(): Promise<void> {
    if (!supabase) return;
    try {
      const cutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

      const { count } = await supabase
        .from('agent_actions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .lt('created_at', cutoffTime);

      if (count && count > 0) {
        console.log(`[ActionMemory] Removing ${count} orphan Supabase actions...`);
        const { error } = await supabase
          .from('agent_actions')
          .delete()
          .eq('status', 'active')
          .lt('created_at', cutoffTime);

        if (error) {
          console.error('[ActionMemory] Supabase cleanup error:', error.message);
        } else {
          console.log(`[ActionMemory] ✅ ${count} orphan Supabase actions removed`);
        }
      }
    } catch (error: unknown) {
      console.error('[ActionMemory] Supabase cleanup error:', extractErrorMessage(error));
    }
  }

  /**
   * Updates an action step.
   * @param chatId Chat ID.
   * @param step Step description.
   */
  async updateStep(chatId: string, step: string): Promise<boolean> {
    try {
      const action = await this.getActiveAction(chatId);
      if (!action) return false;

      action.steps.push({
        step,
        timestamp: Date.now(),
      });

      const key = `${this.keyPrefix}${chatId}`;
      await redis.hSet(key, 'steps', JSON.stringify(action.steps));
      await redis.hSet(key, 'updatedAt', Date.now().toString());

      if (supabase) {
        const resolved = await dbClient.resolveContextFromLegacyId(chatId);
        if (resolved) {
          await supabase
            .from('agent_actions')
            .update({ steps: JSON.stringify(action.steps) })
            .eq('context_id', resolved.context_id)
            .eq('status', 'active');
        }
      }

      return true;
    } catch (error: unknown) {
      console.error('[ActionMemory] updateStep error:', extractErrorMessage(error));
      return false;
    }
  }

  /**
   * Completes an action.
   * @param chatId Chat ID.
   * @param result Action result.
   */
  async completeAction(chatId: string, result: unknown): Promise<boolean> {
    try {
      const action = await this.getActiveAction(chatId);
      if (!action) return false;

      const key = `${this.keyPrefix}${chatId}`;
      await redis.hSet(key, 'status', 'completed');
      await redis.hSet(key, 'result', JSON.stringify(result));
      await redis.hSet(key, 'updatedAt', Date.now().toString());

      if (supabase) {
        const resolved = await dbClient.resolveContextFromLegacyId(chatId);
        if (resolved) {
          await supabase
            .from('agent_actions')
            .update({
              status: 'completed',
              result: JSON.stringify(result),
            })
            .eq('context_id', resolved.context_id)
            .eq('tool_name', action.type)
            .is('result', null)
            .order('created_at', { ascending: false })
            .limit(1);
        }
      }

      // Expire from Redis after 60s
      await redis.expire(key, 60);

      console.log(`[ActionMemory] ✅ Action completed: ${action.type}`);
      return true;
    } catch (error: unknown) {
      console.error('[ActionMemory] completeAction error:', extractErrorMessage(error));
      return false;
    }
  }

  /**
   * Interrupts an ongoing action.
   * @param chatId Chat ID.
   * @param reason Reason for interruption.
   */
  async interruptAction(chatId: string, reason: string): Promise<boolean> {
    try {
      const action = await this.getActiveAction(chatId);
      if (!action) return false;

      const key = `${this.keyPrefix}${chatId}`;
      await redis.hSet(key, 'status', 'interrupted');
      await redis.hSet(key, 'interruptReason', reason);
      await redis.hSet(key, 'updatedAt', Date.now().toString());

      console.log(`[ActionMemory] ⏸️ Action interrupted: ${action.type} (${reason})`);
      await redis.expire(key, 300); // 5 minutes

      return true;
    } catch (error: unknown) {
      console.error('[ActionMemory] interruptAction error:', extractErrorMessage(error));
      return false;
    }
  }

  async hasActiveAction(chatId: string): Promise<boolean> {
    const action = await this.getActiveAction(chatId);
    return action !== null && action.status === 'active';
  }

  async cleanupChatActions(chatId: string): Promise<void> {
    try {
      console.log(`[ActionMemory] 🧹 Cleaning up actions for chat: ${chatId}`);

      const key = `${this.keyPrefix}${chatId}`;
      await redis.del(key);

      if (supabase) {
        const resolved = await dbClient.resolveContextFromLegacyId(chatId);
        if (resolved) {
          const { error } = await supabase
            .from('agent_actions')
            .update({ status: 'interrupted', completed_at: new Date().toISOString() })
            .eq('context_id', resolved.context_id)
            .eq('status', 'active');

          if (error) {
            console.error('[ActionMemory] Supabase cleanup error for %s:', chatId, error.message);
          }
        }
      }
    } catch (error: unknown) {
      console.error(
        '[ActionMemory] cleanupChatActions error for %s:',
        chatId,
        extractErrorMessage(error),
      );
    }
  }

  async formatForPrompt(chatId: string): Promise<string> {
    const action = await this.getActiveAction(chatId);
    if (!action) return '';

    const elapsed = Math.floor((Date.now() - action.startedAt) / 1000);
    const stepsText =
      action.steps.length > 0
        ? action.steps.map((s: ActionStep) => `  - ${s.step}`).join('\n')
        : '  (No steps completed)';

    return `
### 🎯 ONGOING ACTION
- **Type**: ${action.type}
- **Goal**: ${action.goal}
- **Started**: ${elapsed}s ago
- **Steps**:
${stepsText}

**IMPORTANT**: An action is currently in progress. You can:
1. Continue this action if the user message is related.
2. Pause it and return later if the subject changed.
3. Abandon it if the user explicitly asks to stop.
`;
  }

  async getResumableActions(limit: number = 10): Promise<ResumableAction[]> {
    if (!supabase) return [];
    try {
      const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('agent_actions')
        .select('*')
        .eq('status', 'active')
        .gt('created_at', cutoffTime)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      const actions: ResumableAction[] = [];
      for (const row of data as Record<string, unknown>[]) {
        const legacyId = await dbClient.resolveLegacyIdFromContext(row.context_id as string);
        actions.push({
          id: row.id as string,
          chatId: legacyId || (row.context_id as string),
          type: row.tool_name as string,
          params:
            typeof row.params === 'string'
              ? JSON.parse(row.params as string)
              : (row.params as Record<string, unknown>) || {},
          steps:
            typeof row.steps === 'string'
              ? JSON.parse(row.steps as string)
              : (row.steps as ActionStep[]) || [],
          createdAt: new Date(row.created_at as string).getTime(),
        });
      }
      return actions;
    } catch (error: unknown) {
      console.error('[ActionMemory] getResumableActions error:', extractErrorMessage(error));
      return [];
    }
  }

  async rehydrateAction(_chatId: string, actionId: string): Promise<boolean> {
    if (!supabase) return false;
    try {
      const { data, error } = await supabase
        .from('agent_actions')
        .select('*')
        .eq('id', actionId)
        .single();

      if (error || !data) throw new Error('Action not found in Supabase');

      const legacyId = await dbClient.resolveLegacyIdFromContext(data.context_id);
      const resolvedChatId = legacyId || data.context_id;

      const params = typeof data.params === 'string' ? JSON.parse(data.params) : data.params;
      const actionData: ActionData = {
        id: data.id.toString(),
        chatId: resolvedChatId,
        type: data.tool_name,
        goal: params.goal || '',
        context:
          typeof data.params === 'string'
            ? JSON.parse(data.params).context
            : JSON.stringify(params.context || {}),
        priority: '5',
        status: 'active',
        steps: typeof data.steps === 'string' ? data.steps : JSON.stringify(data.steps || []),
        startedAt: new Date(data.created_at).getTime().toString(),
        expiresAt: (Date.now() + this.defaultTTL * 1000).toString(),
      };

      const key = `${this.keyPrefix}${resolvedChatId}`;
      await redis.hSet(key, actionData);
      await redis.expire(key, this.defaultTTL);

      console.log(`[ActionMemory] 💧 Action rehydrated in Redis: ${data.tool_name}`);
      return true;
    } catch (error: unknown) {
      console.error('[ActionMemory] rehydrateAction error:', extractErrorMessage(error));
      return false;
    }
  }

  /**
   * Updates the heartbeat (pulse) of an ongoing action.
   */
  async pulseAction(chatId: string): Promise<void> {
    try {
      const key = `${this.keyPrefix}${chatId}`;
      await redis.hSet(key, 'updatedAt', Date.now().toString());
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ActionMemory] pulseAction error:', msg);
    }
  }

  /**
   * Retrieves actions that haven't pulsed recently (Crashed/Stalled).
   */
  async getStalledActions(
    stalledThresholdMs: number = 5 * 60 * 1000,
  ): Promise<Record<string, string>[]> {
    try {
      const keys = await redis.keys('action:*');
      const stalled: Record<string, string>[] = [];
      const now = Date.now();

      for (const key of keys) {
        const data = await redis.hGetAll(key);
        if (data && data.status === 'active') {
          const lastUpdate = parseInt(data.updatedAt || data.startedAt);
          if (now - lastUpdate > stalledThresholdMs) {
            stalled.push(data);
          }
        }
      }
      return stalled;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ActionMemory] getStalledActions error:', msg);
      return [];
    }
  }
}

export const actionMemory = new ActionMemory();
export default actionMemory;
