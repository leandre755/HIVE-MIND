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
  targetChat?: string;
  allowedApproverJid?: string;
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
    targetChat: 'chat',
    allowedApproverJid: 'user',
    actionDescription: 'test',
    sourceChannel: 'whatsapp',
    createdAt: Date.now(),
    resolve: resolverSpy,
  });
  (pm as unknown as PmInternals).numericIdMap.set(numericId, requestId);
};

// =========================================================================
// 1. SANDBOX & FILE WRITE VALIDATION
// =========================================================================

describe('PermissionManager - Sandbox & FileWrite Validation', () => {
  let pm: PermissionManagerType;

  beforeEach(() => {
    jest.clearAllMocks();
    pm = new PermissionManager();
  });

  describe('isInSandbox', () => {
    it('returns true for paths inside sandboxDir', () => {
      const target = `${pm.sandboxDir}/src/index.ts`;
      const result = pm.isInSandbox(target);
      expect(result).toBe(true);
    });

    it('returns false for paths outside sandboxDir', () => {
      const result = pm.isInSandbox('/etc/passwd');
      expect(result).toBe(false);
    });

    it('resolves relative paths against sandboxDir', () => {
      const result = pm.isInSandbox('./src/utils.ts', pm.sandboxDir);
      expect(result).toBe(true);
    });

    it('blocks symlink escapes pointing outside sandbox', () => {
      const fakeSymlink = `${pm.sandboxDir}/symlink_outside`;
      const result = pm.isInSandbox(fakeSymlink);
      expect(result).toBe(false);
    });
  });

  describe('validateFileWrite', () => {
    it('allows writes inside sandbox', () => {
      const result = pm.validateFileWrite(`${pm.sandboxDir}/test.txt`);
      expect(result.result).toBe(true);
      expect(result.requiresPermission).toBe(false);
    });

    it('requires permission for writes outside sandbox', () => {
      const result = pm.validateFileWrite('/home/user/secret.txt');
      expect(result.result).toBe(false);
      expect(result.requiresPermission).toBe(true);
    });
  });
});

// =========================================================================
// 2. BASH COMMAND SECURITY (ESCALATION & FLAGS)
// =========================================================================

describe('PermissionManager - Bash Command Security (Escalation & Flags)', () => {
  let pm: PermissionManagerType;

  beforeEach(() => {
    jest.clearAllMocks();
    pm = new PermissionManager();
  });

  describe('banned commands and privilege escalation', () => {
    it('blocks banned commands (sudo, su, pkexec, doas)', () => {
      for (const cmd of ['sudo rm -rf /', 'su root', 'pkexec id', 'doas id']) {
        const result = pm.validateBashCommand(cmd);
        expect(result.result).toBe(false);
        expect(result.requiresPermission).toBe(false);
      }
    });

    it('blocks sudo et su avec chemin absolu (/usr/bin/sudo)', () => {
      const res = pm.validateBashCommand('/usr/bin/sudo ls -la');
      expect(res.result).toBe(false);
      expect(res.requiresPermission).toBe(false);
      expect(res.reason).toContain('strictly forbidden');
    });

    it('blocks chaining operators attacks (;, &&, ||, |)', () => {
      const resSemi = pm.validateBashCommand('echo "safe"; sudo rm -rf /');
      expect(resSemi.result).toBe(false);

      const resAnd = pm.validateBashCommand('git status && sudo id');
      expect(resAnd.result).toBe(false);

      const resOr = pm.validateBashCommand('false || /bin/su root');
      expect(resOr.result).toBe(false);

      const resPipe = pm.validateBashCommand('cat file.txt | sudo tee /etc/hosts');
      expect(resPipe.result).toBe(false);
    });

    it('blocks newly added banned commands (eval, exec, sudoedit)', () => {
      const resEval = pm.validateBashCommand('eval "whoami"');
      expect(resEval.result).toBe(false);

      const resExec = pm.validateBashCommand('exec id');
      expect(resExec.result).toBe(false);

      const resSudoedit = pm.validateBashCommand('sudoedit /etc/sudoers');
      expect(resSudoedit.result).toBe(false);
    });

    it('blocks eval and exec as commands but allows eval/exec as arguments in safe commands', () => {
      expect(pm.validateBashCommand('eval "whoami"').result).toBe(false);
      expect(pm.validateBashCommand('exec /bin/sh').result).toBe(false);

      const grepEval = pm.validateBashCommand('grep eval file.txt');
      expect(grepEval.result).toBe(true);

      const echoExec = pm.validateBashCommand('echo exec');
      expect(echoExec.result).toBe(true);

      const grepSudo = pm.validateBashCommand('grep sudo /var/log/auth.log');
      expect(grepSudo.result).toBe(true);
      expect(grepSudo.requiresPermission).toBe(false);
    });

    it('blocks glob pattern tokens resolving to banned commands', () => {
      expect(pm.validateBashCommand('/usr/bin/sud? id').result).toBe(false);
      expect(pm.validateBashCommand('sud* id').result).toBe(false);
      expect(pm.validateBashCommand('s[u]do id').result).toBe(false);
      expect(pm.validateBashCommand('[s]u root').result).toBe(false);
      expect(pm.validateBashCommand('{sudo,id}').result).toBe(false);
      expect(pm.validateBashCommand('sh -c {sudo,id}').result).toBe(false);
    });
  });

  describe('inline execution flags and subshells', () => {
    it('blocks inline execution flags (python3 -c, node -e, bash -c)', () => {
      const resPy = pm.validateBashCommand('python3 -u -c "import os; os.system(\'id\')"');
      expect(resPy.result).toBe(false);

      const resNode = pm.validateBashCommand('node --trace-warnings -e "process.exit(1)"');
      expect(resNode.result).toBe(false);

      const resBash = pm.validateBashCommand('bash -c "id"');
      expect(resBash.result).toBe(false);
    });

    it('blocks subshells and backticks with banned constructs or inline flags', () => {
      const resSubshellSudo = pm.validateBashCommand('echo $(sudo whoami)');
      expect(resSubshellSudo.result).toBe(false);

      const resSubshellBash = pm.validateBashCommand('echo $(bash -c id)');
      expect(resSubshellBash.result).toBe(false);

      const resBacktick = pm.validateBashCommand('echo `node -e id`');
      expect(resBacktick.result).toBe(false);
    });

    it('blocks env var prefix before banned commands', () => {
      const res = pm.validateBashCommand('ENV_VAR=1 bash -c whoami');
      expect(res.result).toBe(false);
    });

    it('blocks multi-line commands with sensitive instructions', () => {
      const res = pm.validateBashCommand('echo safe\nbash -c id');
      expect(res.result).toBe(false);
    });

    it('blocks process substitution <(...) and >(...)', () => {
      const resProcSubIn = pm.validateBashCommand('cat <(sudo whoami)');
      expect(resProcSubIn.result).toBe(false);

      const resProcSubOut = pm.validateBashCommand('diff <(ls) >(sudo tee /etc/hosts)');
      expect(resProcSubOut.result).toBe(false);
    });

    it('blocks combined inline flags (bash -lc, sh -ec, python3 -uc)', () => {
      const resBashLc = pm.validateBashCommand('bash -lc "whoami"');
      expect(resBashLc.result).toBe(false);

      const resShEc = pm.validateBashCommand('sh -ec "echo hi"');
      expect(resShEc.result).toBe(false);

      const resPyUc = pm.validateBashCommand('python3 -uc "print(1)"');
      expect(resPyUc.result).toBe(false);
    });

    it('blocks command wrappers like env, nohup, nice with inline flags and versioned interpreters', () => {
      expect(pm.validateBashCommand('env bash -c "whoami"').result).toBe(false);
      expect(pm.validateBashCommand('nohup python3 -c "import os"').result).toBe(false);
      expect(pm.validateBashCommand('/usr/bin/env python3.11 -c "import os"').result).toBe(false);
      expect(pm.validateBashCommand('nice nodejs -e "console.log(1)"').result).toBe(false);
      expect(pm.validateBashCommand('timeout 10s bash -c "whoami"').result).toBe(false);
      expect(pm.validateBashCommand('env -u FOO python3 -c "import os"').result).toBe(false);
      expect(pm.validateBashCommand('stdbuf -oL sh -c "id"').result).toBe(false);
    });

    it('blocks command grouping { ... } and wrappers with inline interpreters', () => {
      expect(pm.validateBashCommand('{ bash -c "whoami"; }').result).toBe(false);
      expect(pm.validateBashCommand('{ python3 -c "import os"; }').result).toBe(false);
      expect(pm.validateBashCommand('setsid bash -c "id"').result).toBe(false);
      expect(pm.validateBashCommand('taskset 1 python3 -c "id"').result).toBe(false);
    });
  });
});

// =========================================================================
// 3. BASH COMMAND SECURITY (REDIRECTIONS & NAVIGATION)
// =========================================================================

describe('PermissionManager - Bash Command Security (Redirections & Navigation)', () => {
  let pm: PermissionManagerType;

  beforeEach(() => {
    jest.clearAllMocks();
    pm = new PermissionManager();
  });

  describe('brace expansion and interpreters', () => {
    it('blocks brace expansion when combinations exceed MAX_BRACE_BRANCHES (DoS prevention)', () => {
      const res = pm.validateBashCommand('echo x > {a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}');
      expect(res.result).toBe(false);
      expect(res.requiresPermission).toBe(true);
      expect(res.reason).toContain("expansion d'accolades dépasse la limite autorisée");
    });

    it('requires permission for interpreters capable of executing commands (awk, sed)', () => {
      const resAwk = pm.validateBashCommand('awk \'BEGIN{system("id")}\'');
      expect(resAwk.result).toBe(false);
      expect(resAwk.requiresPermission).toBe(true);
      expect(resAwk.reason).toContain('awk');

      const resSed = pm.validateBashCommand("sed 's/a/b/' file.txt");
      expect(resSed.result).toBe(false);
      expect(resSed.requiresPermission).toBe(true);
      expect(resSed.reason).toContain('sed');
    });

    it('allows awk and sed as arguments of read-only commands (grep, find, echo)', () => {
      const resGrepAwk = pm.validateBashCommand('grep awk src/main.c');
      expect(resGrepAwk.result).toBe(true);
      expect(resGrepAwk.requiresPermission).toBe(false);

      const resGrepSed = pm.validateBashCommand('grep -rn sed /var/log/auth.log');
      expect(resGrepSed.result).toBe(true);
      expect(resGrepSed.requiresPermission).toBe(false);

      const resEcho = pm.validateBashCommand('echo "processing with awk and sed"');
      expect(resEcho.result).toBe(true);
      expect(resEcho.requiresPermission).toBe(false);
    });
  });

  describe('directory navigation (cd & pushd)', () => {
    it('requires permission for cd without args, cd ~, and pushd outside sandbox', () => {
      const resBareCd = pm.validateBashCommand('cd');
      expect(resBareCd.result).toBe(false);
      expect(resBareCd.requiresPermission).toBe(true);

      const resTildeCd = pm.validateBashCommand('cd ~');
      expect(resTildeCd.result).toBe(false);
      expect(resTildeCd.requiresPermission).toBe(true);

      const resPushd = pm.validateBashCommand('pushd /etc');
      expect(resPushd.result).toBe(false);
      expect(resPushd.requiresPermission).toBe(true);

      const resPushdTilde = pm.validateBashCommand('pushd ~');
      expect(resPushdTilde.result).toBe(false);
      expect(resPushdTilde.requiresPermission).toBe(true);
    });

    it('requires permission for cd with flags outside sandbox (cd -P /etc)', () => {
      const res = pm.validateBashCommand('cd -P /etc');
      expect(res.result).toBe(false);
      expect(res.requiresPermission).toBe(true);
    });

    it('requires permission for cd with dynamic variables or expansions', () => {
      const resVar = pm.validateBashCommand('cd $TARGET');
      expect(resVar.requiresPermission).toBe(true);
      expect(resVar.reason).toContain('dynamic variables or expansions used in path');

      const resSub = pm.validateBashCommand('cd `pwd`');
      expect(resSub.requiresPermission).toBe(true);
      expect(resSub.reason).toContain('dynamic variables or expansions used in path');
    });

    it('validates multi-line commands and allows them if all lines are safe', () => {
      const res = pm.validateBashCommand('echo "line 1"\ngit status');
      expect(res.result).toBe(true);
      expect(res.requiresPermission).toBe(false);
    });

    it('allows safe commands without permission', () => {
      for (const cmd of ['pwd', 'ls', 'git status', 'date']) {
        const result = pm.validateBashCommand(cmd);
        expect(result.result).toBe(true);
        expect(result.requiresPermission).toBe(false);
      }
    });

    it('requires permission for cd outside sandbox', () => {
      const result = pm.validateBashCommand('cd /etc');
      expect(result.result).toBe(false);
      expect(result.requiresPermission).toBe(true);
    });

    it('allows cd inside sandbox without permission', () => {
      const result = pm.validateBashCommand(`cd ${pm.sandboxDir}/src`);
      expect(result.result).toBe(true);
      expect(result.requiresPermission).toBe(false);
    });

    it('allows non-banned non-safe commands without permission', () => {
      const result = pm.validateBashCommand('npm run build');
      expect(result.result).toBe(true);
      expect(result.requiresPermission).toBe(false);
    });
  });
});

// =========================================================================
// 4. ADMIN HUB COMMANDS (.approve / .reject)
// =========================================================================

describe('PermissionManager - Admin Hub Commands', () => {
  let pm: PermissionManagerType;

  beforeEach(() => {
    jest.clearAllMocks();
    pm = new PermissionManager();
  });

  describe('handleAdminCommand', () => {
    it('.approve resolves pending request with granted=true', async () => {
      const resolverSpy = jest.fn();
      const requestId = 'perm_test_1';
      setPendingRequest(pm, requestId, 1, resolverSpy);

      const handled = await pm.handleAdminCommand('.approve 1', 'chat', 'user');
      expect(handled).toBe(true);
      expect(resolverSpy).toHaveBeenCalledWith({ granted: true });
    });

    it('.reject resolves pending request with granted=false and feedback', async () => {
      const resolverSpy = jest.fn();
      const requestId = 'perm_test_2';
      setPendingRequest(pm, requestId, 2, resolverSpy);

      const handled = await pm.handleAdminCommand(
        '.reject 2 utilise npm run build à la place',
        'chat',
        'user',
      );
      expect(handled).toBe(true);
      expect(resolverSpy).toHaveBeenCalledWith({
        granted: false,
        feedback: 'utilise npm run build à la place',
      });
    });

    it('.reject without feedback sets feedback to undefined', async () => {
      const resolverSpy = jest.fn();
      const requestId = 'perm_test_3';
      setPendingRequest(pm, requestId, 3, resolverSpy);

      await pm.handleAdminCommand('.reject 3', 'chat', 'user');
      expect(resolverSpy).toHaveBeenCalledWith({ granted: false, feedback: undefined });
    });

    it('.approve with non-existent ID returns false without crash', async () => {
      const handled = await pm.handleAdminCommand('.approve 999', 'chat', 'user');
      expect(handled).toBe(false);
    });

    it('.approve rejects command from unauthorized chat or sender', async () => {
      const resolverSpy = jest.fn();
      const requestId = 'perm_test_admin_auth';
      (pm as unknown as PmInternals).pendingRequests.set(requestId, {
        id: requestId,
        numericId: 77,
        chatId: 'hub_channel',
        targetChat: 'hub_channel',
        allowedApproverJid: 'admin_user',
        senderJid: 'normal_user',
        actionDescription: 'format c:',
        sourceChannel: 'whatsapp',
        createdAt: Date.now(),
        resolve: resolverSpy,
      });
      (pm as unknown as PmInternals).numericIdMap.set(77, requestId);

      expect(await pm.handleAdminCommand('.approve 77', 'attacker_chat', 'attacker')).toBe(false);
      expect(resolverSpy).not.toHaveBeenCalled();

      expect(await pm.handleAdminCommand('.approve 77', 'hub_channel', 'unauthorized_user')).toBe(
        false,
      );
      expect(resolverSpy).not.toHaveBeenCalled();

      expect(await pm.handleAdminCommand('.approve 77', 'hub_channel', 'other_user')).toBe(false);
      expect(resolverSpy).not.toHaveBeenCalled();

      expect(await pm.handleAdminCommand('.approve 77', 'hub_channel', 'admin_user')).toBe(true);
      expect(resolverSpy).toHaveBeenCalledWith({ granted: true });
    });

    it('.approve in HUB_ADMIN_ONLY mode verifies superuser status via adminService.isSuperUser', async () => {
      const originalHubId = (pm as unknown as { SECURITY_HUB_ID: string }).SECURITY_HUB_ID;
      try {
        const { adminService } = await import('../../../services/adminService.js');
        const resolverSpy = jest.fn();
        const requestId = 'perm_test_hub_admin';
        (pm as unknown as PmInternals).pendingRequests.set(requestId, {
          id: requestId,
          numericId: 88,
          chatId: 'hub_channel',
          targetChat: 'hub_channel',
          allowedApproverJid: 'HUB_ADMIN_ONLY',
          senderJid: 'requester_jid',
          actionDescription: 'rm -rf /',
          sourceChannel: 'whatsapp',
          createdAt: Date.now(),
          resolve: resolverSpy,
        });
        (pm as unknown as PmInternals).numericIdMap.set(88, requestId);
        (pm as unknown as { SECURITY_HUB_ID: string }).SECURITY_HUB_ID = 'hub_channel';

        (
          adminService.isSuperUser as unknown as jest.MockedFunction<
            (jid: string) => Promise<boolean>
          >
        ).mockResolvedValueOnce(false);
        expect(await pm.handleAdminCommand('.approve 88', 'hub_channel', 'non_super_user')).toBe(
          false,
        );
        expect(resolverSpy).not.toHaveBeenCalled();

        (
          adminService.isSuperUser as unknown as jest.MockedFunction<
            (jid: string) => Promise<boolean>
          >
        ).mockRejectedValueOnce(new Error('network down'));
        expect(await pm.handleAdminCommand('.approve 88', 'hub_channel', 'super_admin_user')).toBe(
          false,
        );
        expect(resolverSpy).not.toHaveBeenCalled();

        (
          adminService.isSuperUser as unknown as jest.MockedFunction<
            (jid: string) => Promise<boolean>
          >
        ).mockResolvedValueOnce(true);
        expect(await pm.handleAdminCommand('.approve 88', 'hub_channel', 'super_admin_user')).toBe(
          true,
        );
        expect(resolverSpy).toHaveBeenCalledWith({ granted: true });
      } finally {
        (pm as unknown as { SECURITY_HUB_ID: string }).SECURITY_HUB_ID = originalHubId;
      }
    });

    it('ignores non-command text', async () => {
      const handled = await pm.handleAdminCommand('hello world', 'chat', 'user');
      expect(handled).toBe(false);
    });
  });
});

// =========================================================================
// 5. IN-BAND USER RESPONSES
// =========================================================================

describe('PermissionManager - In-Band User Responses', () => {
  let pm: PermissionManagerType;

  beforeEach(() => {
    jest.clearAllMocks();
    pm = new PermissionManager();
  });

  const setupPending = (): jest.Mock<(value: { granted: boolean; feedback?: string }) => void> => {
    const resolverSpy = jest.fn();
    const requestId = 'perm_inband_1';
    setPendingRequest(pm, requestId, 10, resolverSpy);
    return resolverSpy;
  };

  describe('basic user responses', () => {
    it('"oui" grants permission', () => {
      const spy = setupPending();
      const handled = pm.handleUserResponse('oui', 'chat', 'user');
      expect(handled).toBe(true);
      expect(spy).toHaveBeenCalledWith({ granted: true });
    });

    it('"y" / "yes" / "ok" grant permission (case insensitive)', () => {
      for (const response of ['y', 'YES', 'Ok', 'autoriser']) {
        const spy = setupPending();
        const handled = pm.handleUserResponse(response, 'chat', 'user');
        expect(handled).toBe(true);
        expect(spy).toHaveBeenCalledWith({ granted: true });
      }
    });

    it('"non" blocks action', () => {
      const spy = setupPending();
      const handled = pm.handleUserResponse('non', 'chat', 'user');
      expect(handled).toBe(true);
      expect(spy).toHaveBeenCalledWith({ granted: false });
    });

    it('"non, fais plutôt X" blocks with corrective feedback', () => {
      const spy = setupPending();
      const handled = pm.handleUserResponse('non, utilise /tmp plutôt', 'chat', 'user');
      expect(handled).toBe(true);
      expect(spy).toHaveBeenCalledWith({
        granted: false,
        feedback: 'utilise /tmp plutôt',
      });
    });

    it('returns false when no pending requests', () => {
      const handled = pm.handleUserResponse('oui', 'chat', 'user');
      expect(handled).toBe(false);
    });

    it('returns false for unrecognized responses', () => {
      setupPending();
      const handled = pm.handleUserResponse('peut-être demain', 'chat', 'user');
      expect(handled).toBe(false);
    });
  });

  describe('multi-tenant & escalation responses', () => {
    it('isolates pending requests by chatId (multi-tenant safety)', () => {
      const spyA = jest.fn();
      const spyB = jest.fn();

      (pm as unknown as PmInternals).pendingRequests.set('req_a', {
        id: 'req_a',
        numericId: 101,
        chatId: 'chat_room_alpha',
        targetChat: 'chat_room_alpha',
        allowedApproverJid: 'userA',
        senderJid: 'userA',
        actionDescription: 'action A',
        sourceChannel: 'whatsapp',
        createdAt: Date.now(),
        resolve: spyA,
      });

      (pm as unknown as PmInternals).pendingRequests.set('req_b', {
        id: 'req_b',
        numericId: 102,
        chatId: 'chat_room_beta',
        targetChat: 'chat_room_beta',
        allowedApproverJid: 'userB',
        senderJid: 'userB',
        actionDescription: 'action B',
        sourceChannel: 'discord',
        createdAt: Date.now(),
        resolve: spyB,
      });

      expect(pm.handleUserResponse('oui', 'unknown_chat', 'userB')).toBe(false);
      expect(spyA).not.toHaveBeenCalled();
      expect(spyB).not.toHaveBeenCalled();

      expect(pm.handleUserResponse('oui', 'chat_room_beta', 'userB')).toBe(true);
      expect(spyB).toHaveBeenCalledWith({ granted: true });
      expect(spyA).not.toHaveBeenCalled();
      expect(pm.pendingCount).toBe(1);

      expect(pm.handleUserResponse('non', 'chat_room_alpha', 'userA')).toBe(true);
      expect(spyA).toHaveBeenCalledWith({ granted: false });
      expect(pm.pendingCount).toBe(0);
    });

    it('prevents self-approval and enforces owner-only approval on escalated requests', () => {
      const spy = jest.fn();
      const ownerJid = 'owner@s.whatsapp.net';
      const userJid = 'user123@s.whatsapp.net';
      const groupChat = 'group_project_1';

      (pm as unknown as PmInternals).pendingRequests.set('req_escalated', {
        id: 'req_escalated',
        numericId: 201,
        chatId: groupChat,
        senderJid: userJid,
        targetChat: ownerJid,
        allowedApproverJid: ownerJid,
        actionDescription: 'rm -rf /storage',
        sourceChannel: 'whatsapp',
        createdAt: Date.now(),
        resolve: spy,
      });

      expect(pm.handleUserResponse('oui', groupChat, userJid)).toBe(false);
      expect(spy).not.toHaveBeenCalled();

      expect(pm.handleUserResponse('oui', ownerJid, 'intruder@s.whatsapp.net')).toBe(false);
      expect(spy).not.toHaveBeenCalled();

      expect(pm.handleUserResponse('oui', ownerJid)).toBe(false);
      expect(spy).not.toHaveBeenCalled();

      expect(pm.handleUserResponse('oui', ownerJid, ownerJid)).toBe(true);
      expect(spy).toHaveBeenCalledWith({ granted: true });
    });

    it('rejects approval when allowedApproverJid is PENDING_ADMIN_CHECK (resolving admin rights race condition)', () => {
      const spy = jest.fn();
      const userJid = 'user123@s.whatsapp.net';
      const groupChat = 'group_project_1';

      (pm as unknown as PmInternals).pendingRequests.set('req_resolving', {
        id: 'req_resolving',
        numericId: 202,
        chatId: groupChat,
        senderJid: userJid,
        targetChat: groupChat,
        allowedApproverJid: 'PENDING_ADMIN_CHECK',
        actionDescription: 'sensitive_cmd',
        sourceChannel: 'whatsapp',
        createdAt: Date.now(),
        resolve: spy,
      });

      expect(pm.handleUserResponse('oui', groupChat, userJid)).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it('rejects handleUserResponse called without chatId if sender does not match allowedApproverJid', () => {
      const priorSpy = jest.fn();
      const priorRequestId = 'perm_prior_other_user';
      (pm as unknown as PmInternals).pendingRequests.set(priorRequestId, {
        id: priorRequestId,
        numericId: 302,
        chatId: 'other_chat',
        senderJid: 'other_user',
        targetChat: 'other_chat',
        allowedApproverJid: 'other_approver@s.whatsapp.net',
        actionDescription: 'restart',
        sourceChannel: 'whatsapp',
        createdAt: Date.now(),
        resolve: priorSpy,
      });

      const spy = jest.fn();
      const requestId = 'perm_no_chat_auth';
      (pm as unknown as PmInternals).pendingRequests.set(requestId, {
        id: requestId,
        numericId: 303,
        chatId: 'any_chat',
        senderJid: 'user_orig',
        targetChat: 'any_chat',
        allowedApproverJid: 'admin_approver@s.whatsapp.net',
        actionDescription: 'deploy',
        sourceChannel: 'whatsapp',
        createdAt: Date.now(),
        resolve: spy,
      });

      expect(pm.handleUserResponse('oui')).toBe(false);
      expect(priorSpy).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();

      expect(pm.handleUserResponse('oui', undefined, 'unauthorized@s.whatsapp.net')).toBe(false);
      expect(priorSpy).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();

      expect(pm.handleUserResponse('oui', undefined, 'admin_approver@s.whatsapp.net')).toBe(true);
      expect(spy).toHaveBeenCalledWith({ granted: true });
      expect(priorSpy).not.toHaveBeenCalled();
    });

    it('rejects in-band response when allowedApproverJid is HUB_ADMIN_ONLY and keeps request pending', () => {
      const spy = jest.fn();
      const requestId = 'req_hub_inband';
      (pm as unknown as PmInternals).pendingRequests.set(requestId, {
        id: requestId,
        numericId: 203,
        chatId: 'group_project_1',
        senderJid: 'user123@s.whatsapp.net',
        targetChat: 'hub_channel',
        allowedApproverJid: 'HUB_ADMIN_ONLY',
        actionDescription: 'deploy_prod',
        sourceChannel: 'whatsapp',
        createdAt: Date.now(),
        resolve: spy,
      });
      (pm as unknown as PmInternals).numericIdMap.set(203, requestId);

      expect(pm.handleUserResponse('oui', 'hub_channel', 'non_super_user')).toBe(false);
      expect(spy).not.toHaveBeenCalled();
      expect((pm as unknown as PmInternals).pendingRequests.has(requestId)).toBe(true);
    });
  });
});

// =========================================================================
// 6. PENDING COUNT & EXPORTS
// =========================================================================

describe('PermissionManager - Pending Count & Exports', () => {
  let pm: PermissionManagerType;

  beforeEach(() => {
    jest.clearAllMocks();
    pm = new PermissionManager();
  });

  describe('pendingCount', () => {
    it('reflects the number of pending requests', () => {
      const requestId = 'perm_count_1';
      (
        pm as unknown as {
          pendingRequests: Map<
            string,
            { id: string; numericId: number; resolve: (value: { granted: boolean }) => void }
          >;
        }
      ).pendingRequests.set(requestId, { id: requestId, numericId: 50, resolve: jest.fn() });

      expect(pm.pendingCount).toBe(1);
    });

    it('decrements after resolution', async () => {
      const resolverSpy = jest.fn();
      const requestId = 'perm_count_2';
      setPendingRequest(pm, requestId, 51, resolverSpy);

      await pm.handleAdminCommand('.approve 51', 'chat', 'user');
      expect(pm.pendingCount).toBe(0);
    });
  });

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
