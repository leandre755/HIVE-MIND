// services/workingMemory.ts
// Service de mémoire de travail (Working Memory) avec Redis Cloud
// Utilise le client Redis partagé pour éviter les connexions multiples

import { redis, ensureConnected, checkHealth as redisCheckHealth } from './redisClient.js';

interface WorkingMemoryMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface StoredMessage {
  sender?: string;
  senderName?: string;
  text?: string;
  mediaType?: string;
  timestamp?: number;
  storedAt: number;
}

interface DeletedMessageEntry {
  messageId: string;
  sender?: string;
  senderName?: string;
  text?: string;
  mediaType?: string;
  timestamp?: number;
  deletedAt: number;
}

interface ChatVelocity {
  velocity: number;
  mode: 'calm' | 'solo' | 'active' | 'chaos';
  uniqueSenders: number;
}

interface ReplyStrategy {
  useQuote: boolean;
  useMention: boolean;
  reason: string;
}

interface LastInteraction {
  user: string;
  timestamp: number;
}

interface UserPassport {
  name: string;
  lang: string;
  tz: string;
  topFacts: string[];
}

interface ActionTrace {
  turn: number;
  user_query: string;
  tools_used: Array<{ name: string; args_summary: string; result_summary: string }>;
  response_preview: string;
  timestamp?: number;
}

interface ToolUsage {
  name: string;
  args_summary: string;
  result_summary: string;
}

interface ActionHistoryEntry {
  turn: number;
  user_query: string;
  tools_used: ToolUsage[];
  response_preview: string;
  timestamp: number;
}

type AudioPermission = 'all' | 'admins_only' | 'none';

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export const workingMemory = {
  async addMessage(
    chatId: string,
    role: 'user' | 'assistant',
    content: string,
    speakerHash: string | null = null,
    speakerName: string | null = null,
  ): Promise<void> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return;

      let formattedContent = content;
      if (role === 'user' && speakerHash && speakerName) {
        formattedContent = `[${speakerName}] [${speakerHash}]: ${content}`;
      }

      const key = `chat:${chatId}:context`;
      const message = JSON.stringify({ role, content: formattedContent, timestamp: Date.now() });

      await redis.rPush(key, message);
      await redis.lTrim(key, -15, -1);
      await redis.expire(key, 86400); // 24h — prevents amnesia on sleep >15min
    } catch (error: unknown) {
      console.error('[WorkingMemory] addMessage error:', extractErrorMessage(error));
    }
  },

  async getContext(chatId: string, limit = 15): Promise<WorkingMemoryMessage[]> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return [];

      const key = `chat:${chatId}:context`;
      const start = limit ? -limit : 0;
      const logs = await redis.lRange(key, start, -1);

      return logs.map((log: string) => JSON.parse(log) as WorkingMemoryMessage);
    } catch (error: unknown) {
      console.error('[WorkingMemory] getContext error:', extractErrorMessage(error));
      return [];
    }
  },

  async clearContext(chatId: string): Promise<void> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return;
      await redis.del(`chat:${chatId}:context`);
    } catch (error: unknown) {
      console.error('[WorkingMemory] clearContext error:', extractErrorMessage(error));
    }
  },

  async checkHealth(): Promise<ReturnType<typeof redisCheckHealth>> {
    try {
      await ensureConnected();
    } catch {
      /* Ignore error here, checkHealth will report it */
    }
    return await redisCheckHealth();
  },

  async muteUser(groupJid: string, userJid: string, durationMinutes: number): Promise<void> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return;
      const key = `mute:${groupJid}:${userJid}`;
      await redis.set(key, '1', { EX: durationMinutes * 60 });
    } catch (error: unknown) {
      console.error('[WorkingMemory] muteUser error:', extractErrorMessage(error));
    }
  },

  async isMuted(groupJid: string, userJid: string): Promise<boolean> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return false;
      const key = `mute:${groupJid}:${userJid}`;
      return (await redis.exists(key)) === 1;
    } catch (error: unknown) {
      console.error('[WorkingMemory] isMuted error:', extractErrorMessage(error));
      return false;
    }
  },

  async setAudioPermission(groupJid: string, permission: AudioPermission): Promise<void> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return;
      const key = `audio_perm:${groupJid}`;
      await redis.set(key, permission);
      console.log(`[WorkingMemory] Audio permission set: ${groupJid} → ${permission}`);
    } catch (error: unknown) {
      console.error('[WorkingMemory] setAudioPermission error:', extractErrorMessage(error));
    }
  },

  async getAudioPermission(groupJid: string): Promise<AudioPermission> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return 'all';
      const key = `audio_perm:${groupJid}`;
      const perm = await redis.get(key);
      return (perm as AudioPermission) || 'all';
    } catch (error: unknown) {
      console.error('[WorkingMemory] getAudioPermission error:', extractErrorMessage(error));
      return 'all';
    }
  },

  async isPvAudioDisabled(): Promise<boolean> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return false;
      const key = 'global:pv_audio_disabled';
      const val = await redis.get(key);
      return val === '1';
    } catch (error: unknown) {
      console.error('[WorkingMemory] isPvAudioDisabled error:', extractErrorMessage(error));
      return false;
    }
  },

  async setPvAudioDisabled(disabled: boolean): Promise<void> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return;
      const key = 'global:pv_audio_disabled';
      if (disabled) {
        await redis.set(key, '1');
      } else {
        await redis.del(key);
      }
      console.log(`[WorkingMemory] PV Audio: ${disabled ? 'DISABLED' : 'ENABLED'} globally`);
    } catch (error: unknown) {
      console.error('[WorkingMemory] setPvAudioDisabled error:', extractErrorMessage(error));
    }
  },

  async storeMessage(
    chatId: string,
    messageId: string,
    messageData: Omit<StoredMessage, 'storedAt'>,
  ): Promise<void> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return;

      const key = `msg:${chatId}:${messageId}`;
      const data = JSON.stringify({
        ...messageData,
        storedAt: Date.now(),
      });

      await redis.set(key, data, { EX: 86400 });
    } catch (error: unknown) {
      console.error('[WorkingMemory] storeMessage error:', extractErrorMessage(error));
    }
  },

  async getStoredMessage(chatId: string, messageId: string): Promise<StoredMessage | null> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return null;

      const key = `msg:${chatId}:${messageId}`;
      const data = await redis.get(key);
      return data ? (JSON.parse(data) as StoredMessage) : null;
    } catch (error: unknown) {
      console.error('[WorkingMemory] getStoredMessage error:', extractErrorMessage(error));
      return null;
    }
  },

  async trackDeletedMessage(
    chatId: string,
    messageId: string,
    messageData: Omit<DeletedMessageEntry, 'messageId' | 'deletedAt'>,
  ): Promise<void> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return;

      const listKey = `deleted:${chatId}`;
      const entry = JSON.stringify({
        messageId,
        ...messageData,
        deletedAt: Date.now(),
      });

      await redis.lPush(listKey, entry);
      await redis.lTrim(listKey, 0, 49);
      await redis.expire(listKey, 604800);

      console.log(`[AntiDelete] Message ${messageId.substring(0, 10)}... tracked as deleted`);
    } catch (error: unknown) {
      console.error('[WorkingMemory] trackDeletedMessage error:', extractErrorMessage(error));
    }
  },

  async getDeletedMessages(chatId: string, limit = 10): Promise<DeletedMessageEntry[]> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return [];

      const listKey = `deleted:${chatId}`;
      const entries = await redis.lRange(listKey, 0, limit - 1);

      return entries.map((e: string) => JSON.parse(e) as DeletedMessageEntry);
    } catch (error: unknown) {
      console.error('[WorkingMemory] getDeletedMessages error:', extractErrorMessage(error));
      return [];
    }
  },

  async setAntiDeleteEnabled(chatId: string, enabled: boolean): Promise<void> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return;
      const key = `antidelete:${chatId}`;
      await redis.set(key, enabled ? '1' : '0');
    } catch (error: unknown) {
      console.error('[WorkingMemory] setAntiDeleteEnabled error:', extractErrorMessage(error));
    }
  },

  async isAntiDeleteEnabled(chatId: string): Promise<boolean> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return false;
      const key = `antidelete:${chatId}`;
      const val = await redis.get(key);
      return val === '1';
    } catch (error: unknown) {
      console.error('[WorkingMemory] isAntiDeleteEnabled error:', extractErrorMessage(error));
      return false;
    }
  },

  async trackMessage(chatId: string, senderId: string): Promise<void> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return;

      const now = Date.now();
      const velocityKey = `velocity:${chatId}`;
      const sendersKey = `velocity:${chatId}:senders`;

      await redis.zAdd(velocityKey, { score: now, value: `${now}:${senderId}` });
      await redis.sAdd(sendersKey, senderId);

      await redis.expire(velocityKey, 120);
      await redis.expire(sendersKey, 120);

      const oneMinuteAgo = now - 60000;
      await redis.zRemRangeByScore(velocityKey, '-inf', oneMinuteAgo);
    } catch (error: unknown) {
      console.error('[WorkingMemory] trackMessage error:', extractErrorMessage(error));
    }
  },

  async getChatVelocity(chatId: string): Promise<ChatVelocity> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return { velocity: 0, mode: 'calm', uniqueSenders: 0 };

      const velocityKey = `velocity:${chatId}`;
      const sendersKey = `velocity:${chatId}:senders`;

      const messageCount = await redis.zCard(velocityKey);
      const uniqueSenders = await redis.sCard(sendersKey);

      let mode: ChatVelocity['mode'] = 'calm';
      if (uniqueSenders <= 1) {
        mode = 'solo';
      } else if (messageCount > 10) {
        mode = 'chaos';
      } else if (messageCount > 2) {
        mode = 'active';
      }

      return { velocity: messageCount, mode, uniqueSenders };
    } catch (error: unknown) {
      console.error('[WorkingMemory] getChatVelocity error:', extractErrorMessage(error));
      return { velocity: 0, mode: 'calm', uniqueSenders: 0 };
    }
  },

  async getReplyStrategy(
    chatId: string,
    _originalMessage: WorkingMemoryMessage | null = null,
  ): Promise<ReplyStrategy> {
    const { velocity, mode, uniqueSenders } = await this.getChatVelocity(chatId);

    const strategy: ReplyStrategy = {
      useQuote: false,
      useMention: false,
      reason: `Mode: ${mode} (${velocity} msg/min, ${uniqueSenders} utilisateurs)`,
    };

    switch (mode) {
      case 'solo':
        strategy.useQuote = false;
        strategy.useMention = false;
        strategy.reason = '🧘 Solo: conversation directe';
        break;

      case 'calm':
        strategy.useQuote = false;
        strategy.useMention = false;
        strategy.reason = `🧘 Calme: ${velocity} msg/min`;
        break;

      case 'active':
        strategy.useQuote = true;
        strategy.useMention = false;
        strategy.reason = `💬 Actif: ${velocity} msg/min - Citation activée`;
        break;

      case 'chaos':
        strategy.useQuote = true;
        strategy.useMention = true;
        strategy.reason = `🔥 Chaos: ${velocity} msg/min - Citation + Mention`;
        break;
    }

    console.log(`[Velocity] ${chatId.substring(0, 15)}... → ${strategy.reason}`);
    return strategy;
  },

  async setLastInteraction(chatId: string, userJid: string): Promise<void> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return;

      const key = `chat:${chatId}:last_interaction`;
      const data = JSON.stringify({
        user: userJid,
        timestamp: Date.now(),
      });

      await redis.set(key, data, { EX: 180 });
    } catch (error: unknown) {
      console.error('[WorkingMemory] setLastInteraction error:', extractErrorMessage(error));
    }
  },

  async getLastInteraction(chatId: string): Promise<LastInteraction | null> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return null;

      const key = `chat:${chatId}:last_interaction`;
      const data = await redis.get(key);

      return data ? (JSON.parse(data) as LastInteraction) : null;
    } catch (error: unknown) {
      console.error('[WorkingMemory] getLastInteraction error:', extractErrorMessage(error));
      return null;
    }
  },

  async trackGroupActivity(chatId: string): Promise<void> {
    if (!chatId.endsWith('@g.us')) return;
    try {
      await ensureConnected();
      if (!redis.isOpen) return;
      await redis.zAdd('groups:activity', [
        {
          score: Date.now(),
          value: chatId,
        },
      ]);
    } catch (e: unknown) {
      console.error('[WorkingMemory] Erreur trackGroupActivity:', extractErrorMessage(e));
    }
  },

  async getInactiveGroups(thresholdMinutes = 180): Promise<string[]> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return [];

      const now = Date.now();
      const cutoff = now - thresholdMinutes * 60 * 1000;

      return await redis.zRangeByScore('groups:activity', '-inf', cutoff);
    } catch (e: unknown) {
      console.error('[WorkingMemory] Erreur getInactiveGroups:', extractErrorMessage(e));
      return [];
    }
  },

  async updateAnnoyance(_chatId: string, _userId: string, _delta: number): Promise<number> {
    throw new Error(
      '[WorkingMemory] updateAnnoyance is DEPRECATED — use consciousnessService.updateAnnoyance() instead',
    );
  },

  async getAnnoyance(_chatId: string, _userId: string): Promise<number> {
    throw new Error(
      '[WorkingMemory] getAnnoyance is DEPRECATED — use consciousnessService.getAnnoyance() instead',
    );
  },

  async getActiveGroups(withinMinutes = 30): Promise<string[]> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return [];

      const cutoff = Date.now() - withinMinutes * 60 * 1000;
      return await redis.zRangeByScore('groups:activity', cutoff, '+inf');
    } catch (error: unknown) {
      console.error('[WorkingMemory] getActiveGroups error:', extractErrorMessage(error));
      return [];
    }
  },

  async getPassport(sender: string): Promise<UserPassport | null> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return null;

      const key = `passport:${sender}`;
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as UserPassport) : null;
    } catch (error: unknown) {
      console.error('[WorkingMemory] getPassport error:', extractErrorMessage(error));
      return null;
    }
  },

  async setPassport(sender: string, passport: UserPassport): Promise<void> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return;

      const key = `passport:${sender}`;
      await redis.set(key, JSON.stringify(passport), { EX: 3600 });
    } catch (error: unknown) {
      console.error('[WorkingMemory] setPassport error:', extractErrorMessage(error));
    }
  },

  formatPassport(passport: UserPassport | null): string {
    if (!passport) return '(Unknown user)';

    const parts: string[] = [];
    if (passport.name) parts.push(`Name: ${passport.name}`);
    if (passport.lang) parts.push(`Language: ${passport.lang}`);
    if (passport.tz) parts.push(`TZ: ${passport.tz}`);
    if (passport.topFacts && passport.topFacts.length > 0) {
      parts.push(passport.topFacts.join(', '));
    }

    return parts.join(' | ') || '(No data)';
  },

  async getScratchpad(chatId: string): Promise<string> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return '';

      const key = `scratchpad:${chatId}`;
      return (await redis.get(key)) || '';
    } catch (error: unknown) {
      console.error('[WorkingMemory] getScratchpad error:', extractErrorMessage(error));
      return '';
    }
  },

  async setScratchpad(chatId: string, text: string): Promise<void> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return;

      const key = `scratchpad:${chatId}`;
      const truncated = typeof text === 'string' ? text.substring(0, 500) : '';
      await redis.set(key, truncated, { EX: 86400 });
    } catch (error: unknown) {
      console.error('[WorkingMemory] setScratchpad error:', extractErrorMessage(error));
    }
  },

  async addActionTrace(chatId: string, trace: ActionTrace): Promise<void> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return;

      const key = `action_history:${chatId}`;
      const entry = JSON.stringify({
        ...trace,
        timestamp: Date.now(),
      });

      await redis.rPush(key, entry);
      await redis.lTrim(key, -6, -1);
      await redis.expire(key, 86400); // 24h — preserves action traces across sleep cycles
    } catch (error: unknown) {
      console.error('[WorkingMemory] addActionTrace error:', extractErrorMessage(error));
    }
  },

  async getActionHistory(chatId: string, limit = 6): Promise<ActionHistoryEntry[]> {
    try {
      await ensureConnected();
      if (!redis.isOpen) return [];

      const key = `action_history:${chatId}`;
      const entries = await redis.lRange(key, -limit, -1);
      return entries.map((e: string) => JSON.parse(e) as ActionHistoryEntry);
    } catch (error: unknown) {
      console.error('[WorkingMemory] getActionHistory error:', extractErrorMessage(error));
      return [];
    }
  },

  formatActionHistory(history: ActionHistoryEntry[]): string {
    if (!history || history.length === 0) return '(No recent actions)';

    return history
      .map((h: ActionHistoryEntry) => {
        const toolsList = (h.tools_used || [])
          .map((t: ToolUsage) => `${t.name}(${t.args_summary || ''}) → ${t.result_summary || 'OK'}`)
          .join('; ');

        return `[Turn] User: "${h.user_query || '?'}" → ${toolsList || 'No tools'} → Agent: "${h.response_preview || '...'}"`;
      })
      .join('\n');
  },
};

export default workingMemory;
