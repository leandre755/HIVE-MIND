// tests/unit/core/permissionManager.test.ts
// MOD 5 + MOD 7 — HITL Dual-Logic Permission System
import { describe, it, beforeEach, jest, expect } from '@jest/globals';
import type { PermissionManager as PermissionManagerType } from '../../../core/security/PermissionManager.js';

// Use unstable_mockModule for ESM native mocking
jest.unstable_mockModule('../../../core/transport/TransportManager.js', () => ({
  transportManager: {
    sendText: jest.fn(async () => ({})),
  },
}));

jest.unstable_mockModule('../../../services/adminService.js', () => ({
  adminService: {
    isSuperUser: jest.fn(async () => false),
    listAdmins: jest.fn(async () => []),
  },
}));

jest.unstable_mockModule('ink', () => ({
  render: jest.fn(),
}));

jest.unstable_mockModule('../../../core/transport/ink/InkCLIAdapter.js', () => ({
  InkCLIAdapter: {},
}));

jest.unstable_mockModule('fs', () => {
  const actualFs = jest.requireActual('fs') as typeof import('node:fs');
  const realpathSyncMock = jest.fn((p: string, options?: unknown) => {
    if (typeof p === 'string' && p.endsWith('symlink_outside')) {
      return '/etc';
    }
    return actualFs.realpathSync(p, options as { encoding?: BufferEncoding });
  });
  return {
    ...actualFs,
    realpathSync: realpathSyncMock,
    default: {
      ...actualFs,
      realpathSync: realpathSyncMock,
    },
  };
});

// Dynamic import AFTER mock registration
const PMModule = await import('../../../core/security/PermissionManager.js');
const { PermissionManager, BANNED_COMMANDS, SAFE_COMMANDS } = PMModule;

type PendingRequest = {
  id: string;
  numericId: number;
  chatId: string;
  senderJid: string;
  actionDescription: string;
  sourceChannel: string;
  createdAt: number;
  resolve: (value: { granted: boolean; feedback?: string }) => void;
};

type PmInternals = {
  pendingRequests: Map<string, PendingRequest>;
  numericIdMap: Map<number, string>;
};

const setPendingRequest = (
  pm: PermissionManagerType,
  requestId: string,
  numericId: number,
  resolverSpy: jest.Mock<(value: { granted: boolean; feedback?: string }) => void>,
): void => {
  (pm as unknown as PmInternals).pendingRequests.set(requestId, {
    id: requestId,
    numericId,
    chatId: 'chat',
    senderJid: 'user',
    actionDescription: 'test',
    sourceChannel: 'whatsapp',
    createdAt: Date.now(),
    resolve: resolverSpy,
  });
  (pm as unknown as PmInternals).numericIdMap.set(numericId, requestId);
};

describe('PermissionManager (MOD 5 + MOD 7)', () => {
  let pm: PermissionManagerType;

  beforeEach(() => {
    jest.clearAllMocks();
    pm = new PermissionManager();
  });

  // =========================================================================
  // SANDBOX VALIDATION
  // =========================================================================

  describe('isInSandbox', () => {
    it('returns true for paths inside sandboxDir', () => {
      // Arrange
      const target = `${pm.sandboxDir}/src/index.ts`;

      // Act
      const result = pm.isInSandbox(target);

      // Assert
      expect(result).toBe(true);
    });

    it('returns false for paths outside sandboxDir', () => {
      // Act
      const result = pm.isInSandbox('/etc/passwd');

      // Assert
      expect(result).toBe(false);
    });

    it('resolves relative paths against sandboxDir', () => {
      // Act
      const result = pm.isInSandbox('./src/utils.ts', pm.sandboxDir);

      // Assert
      expect(result).toBe(true);
    });

    it('blocks symlink escapes pointing outside sandbox', () => {
      // Arrange
      const fakeSymlink = `${pm.sandboxDir}/symlink_outside`;

      // Act
      const result = pm.isInSandbox(fakeSymlink);

      // Assert
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // BASH COMMAND VALIDATION
  // =========================================================================

  describe('validateBashCommand', () => {
    it('blocks banned commands (sudo, su)', () => {
      for (const cmd of ['sudo rm -rf /', 'su root']) {
        // Act
        const result = pm.validateBashCommand(cmd);

        // Assert
        expect(result.result).toBe(false);
        expect(result.requiresPermission).toBe(false);
      }
    });

    it('allows safe commands without permission', () => {
      for (const cmd of ['pwd', 'ls', 'git status', 'date']) {
        // Act
        const result = pm.validateBashCommand(cmd);

        // Assert
        expect(result.result).toBe(true);
        expect(result.requiresPermission).toBe(false);
      }
    });

    it('requires permission for cd outside sandbox', () => {
      // Act
      const result = pm.validateBashCommand('cd /etc');

      // Assert
      expect(result.result).toBe(false);
      expect(result.requiresPermission).toBe(true);
    });

    it('allows cd inside sandbox without permission', () => {
      // Act
      const result = pm.validateBashCommand(`cd ${pm.sandboxDir}/src`);

      // Assert
      expect(result.result).toBe(true);
      expect(result.requiresPermission).toBe(false);
    });

    it('allows non-banned non-safe commands without permission', () => {
      // Act — npm is not banned and not in SAFE_COMMANDS as exact match
      const result = pm.validateBashCommand('npm run build');

      // Assert
      expect(result.result).toBe(true);
      expect(result.requiresPermission).toBe(false);
    });
  });

  // =========================================================================
  // FILE WRITE VALIDATION
  // =========================================================================

  describe('validateFileWrite', () => {
    it('allows writes inside sandbox', () => {
      // Act
      const result = pm.validateFileWrite(`${pm.sandboxDir}/test.txt`);

      // Assert
      expect(result.result).toBe(true);
      expect(result.requiresPermission).toBe(false);
    });

    it('requires permission for writes outside sandbox', () => {
      // Act
      const result = pm.validateFileWrite('/home/user/secret.txt');

      // Assert
      expect(result.result).toBe(false);
      expect(result.requiresPermission).toBe(true);
    });
  });

  // =========================================================================
  // ADMIN HUB COMMANDS (.approve / .reject)
  // =========================================================================

  describe('handleAdminCommand', () => {
    it('.approve resolves pending request with granted=true', () => {
      // Arrange — create a pending request manually
      const resolverSpy = jest.fn();
      const requestId = 'perm_test_1';
      setPendingRequest(pm, requestId, 1, resolverSpy);

      // Act
      const handled = pm.handleAdminCommand('.approve 1');

      // Assert
      expect(handled).toBe(true);
      expect(resolverSpy).toHaveBeenCalledWith({ granted: true });
    });

    it('.reject resolves pending request with granted=false and feedback', () => {
      // Arrange
      const resolverSpy = jest.fn();
      const requestId = 'perm_test_2';
      setPendingRequest(pm, requestId, 2, resolverSpy);

      // Act
      const handled = pm.handleAdminCommand('.reject 2 utilise npm run build à la place');

      // Assert
      expect(handled).toBe(true);
      expect(resolverSpy).toHaveBeenCalledWith({
        granted: false,
        feedback: 'utilise npm run build à la place',
      });
    });

    it('.reject without feedback sets feedback to undefined', () => {
      // Arrange
      const resolverSpy = jest.fn();
      const requestId = 'perm_test_3';
      setPendingRequest(pm, requestId, 3, resolverSpy);

      // Act
      pm.handleAdminCommand('.reject 3');

      // Assert
      expect(resolverSpy).toHaveBeenCalledWith({ granted: false, feedback: undefined });
    });

    it('.approve with non-existent ID returns false without crash', () => {
      // Act
      const handled = pm.handleAdminCommand('.approve 999');

      // Assert
      expect(handled).toBe(false);
    });

    it('ignores non-command text', () => {
      // Act
      const handled = pm.handleAdminCommand('hello world');

      // Assert
      expect(handled).toBe(false);
    });
  });

  // =========================================================================
  // IN-BAND USER RESPONSE (oui/non/feedback)
  // =========================================================================

  describe('handleUserResponse', () => {
    const setupPending = (): jest.Mock<
      (value: { granted: boolean; feedback?: string }) => void
    > => {
      const resolverSpy = jest.fn();
      const requestId = 'perm_inband_1';
      setPendingRequest(pm, requestId, 10, resolverSpy);
      return resolverSpy;
    };

    it('"oui" grants permission', () => {
      // Arrange
      const spy = setupPending();

      // Act
      const handled = pm.handleUserResponse('oui');

      // Assert
      expect(handled).toBe(true);
      expect(spy).toHaveBeenCalledWith({ granted: true });
    });

    it('"y" / "yes" / "ok" grant permission (case insensitive)', () => {
      for (const response of ['y', 'YES', 'Ok', 'autoriser']) {
        const spy = setupPending();
        const handled = pm.handleUserResponse(response);
        expect(handled).toBe(true);
        expect(spy).toHaveBeenCalledWith({ granted: true });
      }
    });

    it('"non" blocks action', () => {
      // Arrange
      const spy = setupPending();

      // Act
      const handled = pm.handleUserResponse('non');

      // Assert
      expect(handled).toBe(true);
      expect(spy).toHaveBeenCalledWith({ granted: false });
    });

    it('"non, fais plutôt X" blocks with corrective feedback', () => {
      // Arrange
      const spy = setupPending();

      // Act
      const handled = pm.handleUserResponse('non, utilise /tmp plutôt');

      // Assert
      expect(handled).toBe(true);
      expect(spy).toHaveBeenCalledWith({
        granted: false,
        feedback: 'utilise /tmp plutôt',
      });
    });

    it('returns false when no pending requests', () => {
      // Act
      const handled = pm.handleUserResponse('oui');

      // Assert
      expect(handled).toBe(false);
    });

    it('returns false for unrecognized responses', () => {
      // Arrange
      setupPending();

      // Act
      const handled = pm.handleUserResponse('peut-être demain');

      // Assert
      expect(handled).toBe(false);
    });
  });

  // =========================================================================
  // CLEANUP & pendingCount
  // =========================================================================

  describe('pendingCount', () => {
    it('reflects the number of pending requests', () => {
      // Arrange
      const requestId = 'perm_count_1';
      (
        pm as unknown as {
          pendingRequests: Map<
            string,
            { id: string; numericId: number; resolve: (value: { granted: boolean }) => void }
          >;
        }
      ).pendingRequests.set(requestId, { id: requestId, numericId: 50, resolve: jest.fn() });

      // Assert
      expect(pm.pendingCount).toBe(1);
    });

    it('decrements after resolution', () => {
      // Arrange
      const resolverSpy = jest.fn();
      const requestId = 'perm_count_2';
      setPendingRequest(pm, requestId, 51, resolverSpy);

      // Act
      pm.handleAdminCommand('.approve 51');

      // Assert
      expect(pm.pendingCount).toBe(0);
    });
  });

  // =========================================================================
  // BANNED_COMMANDS & SAFE_COMMANDS exports
  // =========================================================================

  describe('exports', () => {
    it('BANNED_COMMANDS includes critical system tools', () => {
      expect(BANNED_COMMANDS).toContain('su');
      expect(BANNED_COMMANDS).toContain('sudo');
    });

    it('SAFE_COMMANDS includes basic read-only commands', () => {
      expect(SAFE_COMMANDS.has('pwd')).toBe(true);
      expect(SAFE_COMMANDS.has('ls')).toBe(true);
      expect(SAFE_COMMANDS.has('git status')).toBe(true);
    });
  });
});
