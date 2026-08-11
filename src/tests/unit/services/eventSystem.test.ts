import { describe, it, beforeEach, afterEach, beforeAll, jest, expect } from '@jest/globals';

// Mock core/events BEFORE importing anything else
jest.unstable_mockModule('../../../core/events.js', () => ({
  eventBus: {
    publish: jest.fn(),
    on: jest.fn(),
    subscribe: jest.fn(),
  },
  BotEvents: {
    SYSTEM_ERROR: 'system:error',
    TOOL_PROGRESS: 'tool:progress',
    EVENT_INBOX: 'event:inbox',
  },
}));

// Mock redis client
jest.unstable_mockModule('../../../services/redisClient.js', () => {
  let mockList: string[] = [];
  return {
    redis: {
      lPush: jest.fn(async (_key: string, val: string) => {
        mockList.unshift(val);
        return mockList.length;
      }),
      lRange: jest.fn(async (_key: string, start: number, stop: number) => {
        return mockList.slice(start, stop + 1);
      }),
      lLen: jest.fn(async (_key: string) => {
        return mockList.length;
      }),
      del: jest.fn(async (_key: string) => {
        mockList = [];
        return 1;
      }),
      isOpen: true,
    },
    ensureConnected: jest.fn(async () => {}),
  };
});

let eventBus: typeof import('../../../core/events.js').eventBus;
let eventInboxService: typeof import('../../../services/events/EventInboxService.js').eventInboxService;
let mailboxWatcher: typeof import('../../../services/events/MailboxWatcher.js').mailboxWatcher;

describe('Event System Unit Tests', () => {
  beforeAll(async () => {
    const eventsMod = await import('../../../core/events.js');
    eventBus = eventsMod.eventBus;
    const inboxMod = await import('../../../services/events/EventInboxService.js');
    eventInboxService = inboxMod.eventInboxService;
    const watcherMod = await import('../../../services/events/MailboxWatcher.js');
    mailboxWatcher = watcherMod.mailboxWatcher;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await eventInboxService.clearInbox();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    mailboxWatcher.stop();
  });

  describe('EventInboxService', () => {
    it('should push events to the queue and publish to eventBus', async () => {
      const publishSpy = jest.spyOn(eventBus, 'publish');

      await eventInboxService.pushEvent('test_type', 'test_source', { foo: 'bar' });

      const queue = await eventInboxService.getUnreadEvents();
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({
        type: 'test_type',
        source: 'test_source',
        payload: { foo: 'bar' },
      });
      expect(queue[0].id).toBeDefined();
      expect(queue[0].timestamp).toBeDefined();

      expect(publishSpy).toHaveBeenCalledWith(
        'event:inbox',
        expect.objectContaining({
          type: 'test_type',
          source: 'test_source',
        }),
      );
    });

    it('should clear the queue correctly', async () => {
      await eventInboxService.pushEvent('t1', 's1', {});
      await eventInboxService.pushEvent('t2', 's2', {});

      expect(await eventInboxService.getUnreadEvents()).toHaveLength(2);

      await eventInboxService.clearInbox();
      expect(await eventInboxService.getUnreadEvents()).toHaveLength(0);
    });
  });

  describe('MailboxWatcher', () => {
    it('should start interval and push simulation events periodically', async () => {
      const pushSpy = jest.spyOn(eventInboxService, 'pushEvent').mockResolvedValue(undefined);

      mailboxWatcher.start();

      // Fast-forward 30 minutes
      await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

      expect(pushSpy).toHaveBeenCalledWith(
        'system_notification',
        'cron_simulator',
        expect.objectContaining({ message: expect.any(String) }),
      );
    });

    it('should stop interval on stop()', async () => {
      const pushSpy = jest.spyOn(eventInboxService, 'pushEvent').mockResolvedValue(undefined);

      mailboxWatcher.start();
      mailboxWatcher.stop();

      // Fast-forward 30 minutes
      await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

      expect(pushSpy).not.toHaveBeenCalled();
    });
  });
});
