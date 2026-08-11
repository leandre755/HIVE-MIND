// tests/unit/plugins/bashTool.test.ts
// MOD 3 (onProgress) + MOD 8 (Dual Rendering) + MOD 7 (senderJid propagation)
// Note: ESM requires jest.spyOn for live module bindings
import { describe, it, beforeEach, afterEach, jest, expect } from '@jest/globals';

// Mock PersistentShell (ESM-safe via unstable_mockModule)
jest.unstable_mockModule('../../../plugins/base/dev_tools/PersistentShell.js', () => ({
  persistentShell: {
    execute: jest.fn(async () => ({ stdout: '/home/omni/Code/HIVE-MIND', exitCode: 0 })),
    getCwd: jest.fn(() => process.cwd()),
  },
}));

// Mock FileState
jest.unstable_mockModule('../../../plugins/base/dev_tools/FileState.js', () => ({
  fileState: {
    recordRead: jest.fn(),
    hasChanged: jest.fn(() => ({ changed: false })),
  },
}));

// Dynamic import AFTER mock registration
const { default: BashTool } = await import('../../../plugins/base/dev_tools/BashTool.js');
const { persistentShell } = await import('../../../plugins/base/dev_tools/PersistentShell.js');
const permModule = await import('../../../core/security/PermissionManager.js');

const mockShellExecute = persistentShell.execute as jest.MockedFunction<
  typeof persistentShell.execute
>;

describe('BashTool (MOD 3 + MOD 7 + MOD 8)', () => {
  let validateSpy: jest.SpiedFunction<typeof permModule.permissionManager.validateBashCommand>;
  let askPermSpy: jest.SpiedFunction<typeof permModule.permissionManager.askPermission>;

  const baseContext = {
    chatId: '123@g.us',
    sourceChannel: 'whatsapp',
    message: { sender: 'user@s.whatsapp.net' },
    onProgress: jest.fn() as jest.MockedFunction<(msg: string) => void>,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: command allowed, no permission required
    validateSpy = jest
      .spyOn(permModule.permissionManager, 'validateBashCommand')
      .mockReturnValue({ result: true, requiresPermission: false });
    askPermSpy = jest
      .spyOn(permModule.permissionManager, 'askPermission')
      .mockResolvedValue({ granted: true });
    // Default shell response
    mockShellExecute.mockResolvedValue({
      stdout: '/home/omni/Code/HIVE-MIND',
      exitCode: 0,
    } as Awaited<ReturnType<typeof persistentShell.execute>>);
  });

  afterEach(() => {
    validateSpy?.mockRestore();
    askPermSpy?.mockRestore();
  });

  // ── MOD 8: Dual Rendering ──

  it('returns both llmOutput and userOutput on success', async () => {
    const result = await BashTool.execute({ command: 'pwd' }, baseContext, 'execute_bash_command');

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.llmOutput).toBeDefined();
    const llmOut = result!.llmOutput as { stdout: string; exitCode: number };
    expect(llmOut.stdout).toContain('/home/omni');
    expect(llmOut.exitCode).toBe(0);
    expect(result!.userOutput).toContain('🐚');
    expect(result!.userOutput).toContain('pwd');
  });

  it('returns dual render on failure (non-zero exit)', async () => {
    mockShellExecute.mockResolvedValueOnce({ stdout: 'not found', exitCode: 1 } as Awaited<
      ReturnType<typeof persistentShell.execute>
    >);
    const result = await BashTool.execute(
      { command: 'bad_cmd' },
      baseContext,
      'execute_bash_command',
    );

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    const llmOut = result!.llmOutput as { stdout: string; exitCode: number };
    expect(llmOut.exitCode).toBe(1);
    expect(result!.userOutput).toContain('❌');
  });

  it('returns dual render on exception', async () => {
    mockShellExecute.mockRejectedValueOnce(new Error('Shell crashed') as never);
    const result = await BashTool.execute({ command: 'boom' }, baseContext, 'execute_bash_command');

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.llmOutput as string).toContain('Shell crashed');
    expect(result!.userOutput).toContain('❌');
  });

  // ── MOD 3: onProgress ──

  it('calls onProgress before and after execution', async () => {
    await BashTool.execute({ command: 'pwd' }, baseContext, 'execute_bash_command');

    expect(baseContext.onProgress).toHaveBeenCalledTimes(2);
    expect(baseContext.onProgress).toHaveBeenCalledWith(expect.stringContaining('pwd'));
    expect(baseContext.onProgress).toHaveBeenCalledWith(expect.stringContaining('Finished'));
  });

  it('does not crash if onProgress is undefined', async () => {
    const ctx = { ...baseContext, onProgress: undefined };
    const result = await BashTool.execute({ command: 'pwd' }, ctx, 'execute_bash_command');
    expect(result!.success).toBe(true);
  });

  // ── MOD 7: senderJid propagation ──

  it('passes senderJid to askPermission when out of sandbox', async () => {
    validateSpy.mockReturnValueOnce({
      result: false,
      requiresPermission: true,
      reason: 'outside sandbox',
    });
    await BashTool.execute({ command: 'cd /etc' }, baseContext, 'execute_bash_command');

    expect(askPermSpy).toHaveBeenCalledWith(
      '123@g.us',
      expect.any(String),
      'whatsapp',
      'user@s.whatsapp.net',
    );
  });

  it('uses "system" as senderJid when message.sender is missing', async () => {
    validateSpy.mockReturnValueOnce({ result: false, requiresPermission: true });
    const ctx = { ...baseContext, message: {} };
    await BashTool.execute({ command: 'cd /etc' }, ctx, 'execute_bash_command');

    expect(askPermSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      'system',
    );
  });

  // ── Security: blocked command ──

  it('blocks banned commands immediately', async () => {
    validateSpy.mockReturnValueOnce({
      result: false,
      requiresPermission: false,
      reason: 'curl is banned',
    });
    const result = await BashTool.execute(
      { command: 'curl evil.com' },
      baseContext,
      'execute_bash_command',
    );

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.message).toContain('SECURITY BLOCK');
  });

  // ── HITL feedback propagation ──

  it('propagates rejection feedback from HITL', async () => {
    validateSpy.mockReturnValueOnce({ result: false, requiresPermission: true });
    askPermSpy.mockResolvedValueOnce({ granted: false, feedback: 'use npm run build instead' });
    const result = await BashTool.execute(
      { command: 'make build' },
      baseContext,
      'execute_bash_command',
    );

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.message).toContain('use npm run build instead');
  });

  // ── Output truncation ──

  it('truncates output exceeding 30000 chars', async () => {
    const bigOutput = 'X'.repeat(40000);
    mockShellExecute.mockResolvedValueOnce({ stdout: bigOutput, exitCode: 0 } as Awaited<
      ReturnType<typeof persistentShell.execute>
    >);
    const result = await BashTool.execute(
      { command: 'cat bigfile' },
      baseContext,
      'execute_bash_command',
    );

    expect(result).not.toBeNull();
    const llmOut = result!.llmOutput as { stdout: string; exitCode: number };
    expect(llmOut.stdout).toContain('truncated');
    expect(llmOut.stdout.length).toBeLessThan(35000);
  });

  // ── Ignores wrong toolName ──

  it('returns null for unknown toolName', async () => {
    const result = await BashTool.execute({}, baseContext, 'wrong_tool');
    expect(result).toBeNull();
  });
});
