import { redis, ensureConnected } from '../redisClient.js';
import { generateId } from '../../utils/helpers.js';
import { eventBus, BotEvents } from '../../core/events.js';

export interface SystemEvent {
  id: string;
  type: string;
  source: string;
  payload: unknown;
  timestamp: number;
}

export const eventInboxService = {
  async pushEvent(type: string, source: string, payload: unknown): Promise<void> {
    await ensureConnected();
    if (!redis.isOpen) return;

    const event: SystemEvent = {
      id: `evt_${generateId()}`,
      type,
      source,
      payload,
      timestamp: Date.now(),
    };

    await redis.lPush('hive:event_inbox', JSON.stringify(event));
    eventBus.publish(BotEvents.EVENT_INBOX, event);
    console.log(`[EventInbox] 📥 Nouvel événement asynchrone : ${type}`);
  },

  async getUnreadEvents(limit: number = 20): Promise<SystemEvent[]> {
    await ensureConnected();
    if (!redis.isOpen) return [];

    const rawEvents = await redis.lRange('hive:event_inbox', 0, limit - 1);
    return rawEvents.map((e) => JSON.parse(e));
  },

  async clearInbox(): Promise<number> {
    await ensureConnected();
    if (!redis.isOpen) return 0;

    const count = await redis.lLen('hive:event_inbox');
    await redis.del('hive:event_inbox');
    return count;
  },
};
