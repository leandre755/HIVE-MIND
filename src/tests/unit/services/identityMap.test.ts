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
  });

  // ── resolve ──

  describe('resolve', () => {
    it('returns null for null/undefined input', async () => {
      expect(await IdentityMap.resolve(null)).toBeNull();
      expect(await IdentityMap.resolve(undefined)).toBeNull();
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
});
