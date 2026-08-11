import { describe, it, beforeEach, jest, expect } from '@jest/globals';

// 1. Mock redis client
const mockRedisDb = new Map<string, string>();
jest.unstable_mockModule('../../../services/redisClient.js', () => ({
  redis: {
    exists: jest.fn(async (key: string) => (mockRedisDb.has(key) ? 1 : 0)),
    get: jest.fn(async (key: string) => mockRedisDb.get(key) || null),
    set: jest.fn(async (key: string, val: string, _options?: unknown) => {
      mockRedisDb.set(key, val);
      return 'OK';
    }),
    isOpen: true,
  },
  ensureConnected: jest.fn(async () => {}),
}));

// 2. Mock EventInboxService
jest.unstable_mockModule('../../../services/events/EventInboxService.js', () => ({
  eventInboxService: {
    pushEvent: jest.fn(async () => {}),
  },
}));

// 3. Mock workingMemory
let mockVelocityMode = 'calm';
jest.unstable_mockModule('../../../services/workingMemory.js', () => ({
  workingMemory: {
    getChatVelocity: jest.fn(async () => ({
      velocity: 0,
      mode: mockVelocityMode,
      uniqueSenders: 0,
    })),
  },
}));

// 4. Mock blueprintManager
const dummyBlueprint = {
  metadata: { id: 'test_agent', name: 'Test Agent', version: '1.0.0' },
  mindos: {
    drives: ['drive_a', 'drive_b'],
  },
  action_space: { allowed_tools: [] as string[] },
  constraints: { read_only_fs: false, max_budget_usd: 1.0, max_iterations: 10 },
};

jest.unstable_mockModule('../../../core/blueprint/AgentBlueprint.js', () => ({
  blueprintManager: {
    loadBlueprint: jest.fn((id: string) => {
      if (id === 'empty_agent') {
        return { ...dummyBlueprint, mindos: { drives: [] } };
      }
      return dummyBlueprint;
    }),
  },
}));

// Imports dynamiques après mocks
const { eventInboxService } = await import('../../../services/events/EventInboxService.js');
const { driverSystem } = await import('../../../services/mindos/DriverSystem.js');

describe('DriverSystem (MindOS Drives)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisDb.clear();
    mockVelocityMode = 'calm';
  });

  it('should trigger drive event when conditions are met (calm chat, no lock)', async () => {
    const result = await driverSystem.evaluateDrives('chat123', 'test_agent');

    expect(result).toBe(true);
    expect(eventInboxService.pushEvent).toHaveBeenCalledWith(
      'spontaneous_thought',
      'driver_system',
      expect.objectContaining({
        chatId: 'chat123',
        drive: 'drive_a',
      }),
    );

    // Verrou posé dans Redis
    expect(mockRedisDb.get('driver_lock:chat123')).toBe('1');

    // Index round-robin incrémenté (prochain index = 0 car premier index sauvé = 0)
    expect(mockRedisDb.get('driver_last_index:chat123')).toBe('0');
  });

  it('should alternate drives round-robin on consecutive triggers', async () => {
    // Premier déclenchement
    await driverSystem.evaluateDrives('chat123', 'test_agent');
    expect(mockRedisDb.get('driver_last_index:chat123')).toBe('0');

    // Retirer le verrou pour pouvoir relancer
    mockRedisDb.delete('driver_lock:chat123');

    // Deuxième déclenchement
    const result = await driverSystem.evaluateDrives('chat123', 'test_agent');
    expect(result).toBe(true);
    expect(eventInboxService.pushEvent).toHaveBeenLastCalledWith(
      'spontaneous_thought',
      'driver_system',
      expect.objectContaining({
        chatId: 'chat123',
        drive: 'drive_b',
      }),
    );
    expect(mockRedisDb.get('driver_last_index:chat123')).toBe('1');
  });

  it('should block execution if driver lock already exists', async () => {
    // Poser le verrou manuellement
    mockRedisDb.set('driver_lock:chat123', '1');

    const result = await driverSystem.evaluateDrives('chat123', 'test_agent');

    expect(result).toBe(false);
    expect(eventInboxService.pushEvent).not.toHaveBeenCalled();
  });

  it('should block execution if chat is active (velocity mode != calm)', async () => {
    mockVelocityMode = 'active';

    const result = await driverSystem.evaluateDrives('chat123', 'test_agent');

    expect(result).toBe(false);
    expect(eventInboxService.pushEvent).not.toHaveBeenCalled();
  });

  it('should do nothing if blueprint has no drives', async () => {
    const result = await driverSystem.evaluateDrives('chat123', 'empty_agent');

    expect(result).toBe(false);
    expect(eventInboxService.pushEvent).not.toHaveBeenCalled();
  });
});
