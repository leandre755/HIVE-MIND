import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { PermissionManager as PermissionManagerType } from '../../core/security/PermissionManager.js';
import * as path from 'path';

// Mocks explicites (ESM)
jest.unstable_mockModule('../../core/transport/TransportManager.js', () => ({
  transportManager: {
    sendText: jest.fn(() => Promise.resolve(true)),
  },
}));

jest.unstable_mockModule('../../services/adminService.js', () => ({
  adminService: {
    isSuperUser: jest.fn(),
    getOwnerJid: jest.fn(),
  },
}));

const { PermissionManager } = await import('../../core/security/PermissionManager.js');
const { transportManager } = await import('../../core/transport/TransportManager.js');
const { adminService } = await import('../../services/adminService.js');

describe('PermissionManager', () => {
  let permissionManager: PermissionManagerType;

  beforeEach(() => {
    jest.clearAllMocks();
    // Arrange: Injecter des paths déterministes pour la sandbox
    process.env.SANDBOX_DIR = path.resolve(process.cwd(), 'Sandbox1');
    process.env.STORAGE_DIR = path.resolve(process.cwd(), 'storage_hm');
    permissionManager = new PermissionManager();
  });

  describe('validateBashCommand', () => {
    it('cas nominal — autorise les commandes sûres', () => {
      // Arrange
      const command = 'cat /etc/os-release';

      // Act
      const validation = permissionManager.validateBashCommand(command);

      // Assert
      expect(validation.result).toBe(true);
      expect(validation.requiresPermission).toBe(false);
    });

    it("cas d'erreur — bloque strictement les commandes interdites directes", () => {
      // Arrange
      const command = 'sudo ls';

      // Act
      const validation = permissionManager.validateBashCommand(command);

      // Assert
      expect(validation.result).toBe(false);
      expect(validation.reason).toMatch(/privilege escalation/);
    });

    it("cas d'erreur — bloque les patterns d'évasion inline", () => {
      // Arrange
      const command = 'node -e "process.exit()"';

      // Act
      const validation = permissionManager.validateBashCommand(command);

      // Assert
      expect(validation.result).toBe(false);
      expect(validation.reason).toMatch(/inline execution outside sandbox/);
    });

    it('cas limite — autorise cd dans la Sandbox, mais bloque cd /root', () => {
      // Arrange
      const safeCommand = `cd ${permissionManager.sandboxDir}`;
      const unsafeCommand = 'cd /root';

      // Act
      const validationSafe = permissionManager.validateBashCommand(safeCommand);
      const validationUnsafe = permissionManager.validateBashCommand(unsafeCommand);

      // Assert
      expect(validationSafe.result).toBe(true);
      expect(validationUnsafe.result).toBe(false);
      expect(validationUnsafe.requiresPermission).toBe(true);
    });
  });

  describe('validateFileWrite', () => {
    it("cas nominal — autorise l'écriture dans la sandbox", () => {
      // Arrange
      const safePath = path.resolve(permissionManager.sandboxDir, 'test.txt');

      // Act
      const validation = permissionManager.validateFileWrite(safePath);

      // Assert
      expect(validation.result).toBe(true);
    });

    it("cas d'erreur — refuse l'écriture en dehors de la sandbox", () => {
      // Arrange
      const unsafePath = '/etc/passwd';

      // Act
      const validation = permissionManager.validateFileWrite(unsafePath);

      // Assert
      expect(validation.result).toBe(false);
      expect(validation.requiresPermission).toBe(true);
    });
  });

  describe('askPermission (HITL)', () => {
    it("cas nominal — escalade la demande In-Band au créateur si ce n'est pas un admin", async () => {
      // Arrange
      (
        adminService.isSuperUser as jest.MockedFunction<typeof adminService.isSuperUser>
      ).mockResolvedValue(false);
      (
        adminService.getOwnerJid as jest.MockedFunction<typeof adminService.getOwnerJid>
      ).mockResolvedValue('owner@s.whatsapp.net');

      // Act: appel sans await direct pour pouvoir interagir avec la réponse en cours
      const promise = permissionManager.askPermission(
        'chat123',
        'action dangereuse',
        'whatsapp',
        'user1',
      );

      // Attendre un cycle pour que les promises internes (escalade) se résolvent
      await new Promise((r) => setTimeout(r, 20));

      // Assert
      expect(transportManager.sendText).toHaveBeenCalledWith(
        'owner@s.whatsapp.net',
        expect.stringContaining('ALERTE SÉCURITÉ'),
        expect.any(Object),
        'whatsapp',
      );

      // Cleanup: Forcer la résolution pour éviter que le test ne timeout
      permissionManager.handleUserResponse('non');
      await promise;
    });
  });
});
