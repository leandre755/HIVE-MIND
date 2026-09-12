// tests/unit/services/identityMap.test.ts
// MOD 9 — IdentityMap (LID <-> JID Ghost User Merge)
import { describe, it, beforeEach, jest, expect } from '@jest/globals';

// Mock redis
jest.unstable_mockModule('../../../services/redisClient.js', () => ({
  redis: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    isOpen: true,
  },
}));

// Mock supabase
jest.unstable_mockModule('../../../services/supabase.js', () => ({
  supabase: null, // No DB by default — tests Redis path
  default: { resolveContextFromLegacyId: jest.fn() },
}));

// Mock jidHelper
jest.unstable_mockModule('../../../utils/jidHelper.js', () => ({
  extractNumericId: jest.fn((id: string) => id.split('@')[0]),
}));

// Dynamic import AFTER mock registration
const { IdentityMap } = await import('../../../services/state/IdentityMap.js');
const { redis } = await import('../../../services/redisClient.js');

describe('IdentityMap (MOD 9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    IdentityMap._clearCacheForTesting?.();
  });

  // ── resolve ──

  describe('resolve', () => {
    it('returns null for null/undefined input', async () => {
      expect(await IdentityMap.resolve(null)).toBeNull();
      expect(await IdentityMap.resolve(undefined)).toBeNull();
    });

    it('returns empty string unchanged when given empty string', async () => {
      expect(await IdentityMap.resolve('')).toBe('');
    });

    it('returns group JID unchanged (@g.us)', async () => {
      const jid = '123456789@g.us';
      const result = await IdentityMap.resolve(jid);
      expect(result).toBe(jid);
    });

    it('returns phone JID unchanged (@s.whatsapp.net)', async () => {
      const jid = '33612345678@s.whatsapp.net';
      const result = await IdentityMap.resolve(jid);
      expect(result).toBe(jid);
    });

    it('strips device suffix from JID (colons)', async () => {
      // WhatsApp multi-device: "33612345678:12@s.whatsapp.net"
      const jid = '33612345678:12@s.whatsapp.net';
      const result = await IdentityMap.resolve(jid);
      expect(result).toBe('33612345678@s.whatsapp.net');
    });

    it('resolves LID from Redis cache', async () => {
      const lid = '186101520123456@lid';
      const phoneJid = '33612345678@s.whatsapp.net';
      (redis.get as jest.MockedFunction<typeof redis.get>).mockResolvedValueOnce(phoneJid);

      const result = await IdentityMap.resolve(lid);

      expect(redis.get).toHaveBeenCalledWith(expect.stringContaining('186101520123456'));
      expect(result).toBe(phoneJid);
    });

    it('returns original LID when no cache and no supabase', async () => {
      const lid = '999999999@lid';
      const result = await IdentityMap.resolve(lid);
      expect(result).toBe(lid);
    });
  });

  // ── register ──

  describe('register', () => {
    it('stores LID->JID mapping in Redis', async () => {
      const phoneJid = '33612345678@s.whatsapp.net';
      const lid = '186101520123456@lid';

      await IdentityMap.register(phoneJid, lid);

      expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('186101520123456'), phoneJid);
    });

    it('does nothing when both IDs are same type (no JID+LID pair)', async () => {
      await IdentityMap.register('111@s.whatsapp.net', '222@s.whatsapp.net');
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('does nothing when either ID is null', async () => {
      await IdentityMap.register(null, '222@s.whatsapp.net');
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('handles reversed argument order (LID first, JID second)', async () => {
      const lid = '186101520123456@lid';
      const phoneJid = '33612345678@s.whatsapp.net';

      await IdentityMap.register(lid, phoneJid);

      expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('186101520123456'), phoneJid);
    });
  });

  // ── hydrateLidCache (Symmetric Bidirectional) ──

  describe('hydrateLidCache', () => {
    it('symmetrically hydrates forward and reverse caches from a phone JID', async () => {
      const phoneJid = '33612345678@s.whatsapp.net';
      const lid = '186101520123456@lid';
      (redis.get as jest.MockedFunction<typeof redis.get>).mockResolvedValueOnce(lid);

      await IdentityMap.hydrateLidCache(phoneJid);

      // Reverse lookup is populated
      expect(IdentityMap.getLidForJid(phoneJid)).toBe(lid);

      // Forward resolution is populated symmetrically without further Redis calls
      (redis.get as jest.MockedFunction<typeof redis.get>).mockClear();
      const resolved = await IdentityMap.resolve(lid);
      expect(resolved).toBe(phoneJid);
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('symmetrically hydrates forward and reverse caches from a LID', async () => {
      const phoneJid = '33612345678@s.whatsapp.net';
      const lid = '186101520123456@lid';
      (redis.get as jest.MockedFunction<typeof redis.get>).mockResolvedValueOnce(phoneJid);

      await IdentityMap.hydrateLidCache(lid);

      // Forward resolution is populated
      (redis.get as jest.MockedFunction<typeof redis.get>).mockClear();
      const resolved = await IdentityMap.resolve(lid);
      expect(resolved).toBe(phoneJid);
      expect(redis.get).not.toHaveBeenCalled();

      // Reverse lookup is populated symmetrically
      expect(IdentityMap.getLidForJid(phoneJid)).toBe(lid);
    });
  });

  // ── Bounded cache eviction ──

  describe('bounded cache eviction', () => {
    it('bounds in-memory cache to 1000 entries and evicts oldest items', async () => {
      // Pre-register entry 0
      const firstPhone = '33600000000@s.whatsapp.net';
      const firstLid = '100000000@lid';
      await IdentityMap.register(firstPhone, firstLid);

      expect(IdentityMap.getLidForJid(firstPhone)).toBe(firstLid);

      // Register 1000 additional entries (total 1001 registrations)
      for (let i = 1; i <= 1000; i++) {
        const phone = `3360000${String(i).padStart(4, '0')}@s.whatsapp.net`;
        const lid = `10000${String(i).padStart(4, '0')}@lid`;
        await IdentityMap.register(phone, lid);
      }

      // Oldest entry (index 0) must be evicted from the bounded cache
      expect(IdentityMap.getLidForJid(firstPhone)).toBeNull();

      // Most recent entry must still be present
      const lastPhone = '33600001000@s.whatsapp.net';
      const lastLid = '100001000@lid';
      expect(IdentityMap.getLidForJid(lastPhone)).toBe(lastLid);
    });

    it('refreshes both directional cache entries together when accessed in one direction', async () => {
      const phone0 = '33600000000@s.whatsapp.net';
      const lid0 = '100000000@lid';
      await IdentityMap.register(phone0, lid0);

      // Register 999 other entries (total 1000)
      for (let i = 1; i <= 999; i++) {
        const phone = `3360000${String(i).padStart(4, '0')}@s.whatsapp.net`;
        const lid = `10000${String(i).padStart(4, '0')}@lid`;
        await IdentityMap.register(phone, lid);
      }

      // Refresh entry 0 by reading only reverse direction (getLidForJid)
      expect(IdentityMap.getLidForJid(phone0)).toBe(lid0);

      // Insert 1 more entry (total 1001 registrations, forces eviction of the oldest)
      await IdentityMap.register('33699999999@s.whatsapp.net', '999999999@lid');

      // Entry 0 was refreshed, so it must still be preserved in BOTH directions
      expect(IdentityMap.getLidForJid(phone0)).toBe(lid0);
      (redis.get as jest.MockedFunction<typeof redis.get>).mockClear();
      expect(await IdentityMap.resolve(lid0)).toBe(phone0);
      expect(redis.get).not.toHaveBeenCalled();

      // Entry 1 (the unrefreshed oldest entry) should have been evicted
      const phone1 = '33600000001@s.whatsapp.net';
      expect(IdentityMap.getLidForJid(phone1)).toBeNull();
    });
  });
});
