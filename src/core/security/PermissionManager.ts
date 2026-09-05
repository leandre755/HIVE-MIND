import { resolve, isAbsolute, basename, sep, dirname } from 'path';
import { homedir } from 'os';
import { parse as parseShell } from 'shell-quote';
import {
  safeExistsSync,
  safeMkdirSync,
  safeLstatSync,
  safeReaddirSync,
  safeRmdirSync,
  safeSymlinkSync,
  safeRealPathSync,
  safePath,
} from '../../utils/safeFs.js';
import { transportManager } from '../transport/TransportManager.js';
import { adminService } from '../../services/adminService.js';

// WHY: Only commands that enable privilege escalation are banned.
// Network tools (curl, wget) are useful and allowed — the agent won't exfiltrate.
// VM escape vectors are handled by SafeScriptValidator at the JS level.
export const PRIVILEGE_ESCALATION_COMMANDS = [
  'su',
  'sudo',
  'sudoedit',
  'pkexec',
  'doas',
  'nsenter',
  'unshare',
  'chroot',
  'capsh',
  'systemd-run',
];

export const BANNED_COMMANDS = [...PRIVILEGE_ESCALATION_COMMANDS, 'eval', 'exec'];

// WHY: These flag combinations allow inline code execution that could bypass
// the SafeScriptValidator. E.g. `node -e "require('child_process').exec('sudo ...')"`
// We check baseCmd + first flag as a compound pattern.
const BANNED_FLAG_PATTERNS: ReadonlyArray<[string, string]> = [
  ['node', '-e'],
  ['node', '--eval'],
  ['python', '-c'],
  ['python3', '-c'],
  ['perl', '-e'],
  ['ruby', '-e'],
  ['lua', '-e'],
  ['bash', '-c'],
  ['sh', '-c'],
  ['zsh', '-c'],
];

export const SAFE_COMMANDS = new Set([
  'git status',
  'git diff',
  'git log',
  'git branch',
  'pwd',
  'tree',
  'date',
  'which',
  'ls',
  'echo',
  'cat',
  'node --version',
  'npm --version',
]);

/** Enriched result of a permission request (HITL) */
export interface PermissionResult {
  readonly granted: boolean;
  /** Corrective instruction from the human (e.g. "use npm run build instead") */
  readonly feedback?: string;
}

/** Internal metadata for a pending permission request */
interface PendingRequest {
  readonly id: string;
  readonly numericId: number;
  readonly chatId: string;
  readonly senderJid: string;
  targetChat?: string;
  allowedApproverJid?: string;
  readonly actionDescription: string;
  readonly sourceChannel: string;
  readonly createdAt: number;
  resolve: (result: PermissionResult) => void;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function safeRealPathOrSelf(pathStr: string): string {
  try {
    return safeRealPathSync(pathStr);
  } catch {
    return pathStr;
  }
}

function resolveSegmentedPath(absoluteTarget: string): string {
  const segments = absoluteTarget.split(/[/\\]/);
  const isWin = process.platform === 'win32';
  let current = isWin ? segments[0] + '\\' : '/';
  const startIdx = isWin ? 1 : 0;

  for (const segment of segments.slice(startIdx)) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      current = safeRealPathOrSelf(current);
      current = safePath(`${current}${sep}..`);
    } else {
      current = safeRealPathOrSelf(safePath(`${current}${sep}${segment}`));
    }
  }
  return safePath(current);
}

function resolvePathWithSymlinks(targetPath: string, currentCwd: string): string {
  const absoluteTarget = isAbsolute(targetPath)
    ? targetPath
    : safePath(`${currentCwd}${sep}${targetPath}`);
  try {
    return safeRealPathSync(absoluteTarget);
  } catch {
    return resolveSegmentedPath(absoluteTarget);
  }
}

const WRAPPERS = new Set([
  'env',
  'nohup',
  'nice',
  'command',
  'timeout',
  'stdbuf',
  'xargs',
  'busybox',
  'setsid',
  'flock',
  'taskset',
  'ionice',
  'chrt',
]);

function _skipTimeoutArgs(parts: string[], startIndex: number): number {
  let idx = startIndex;
  while (idx < parts.length) {
    const arg = parts.at(idx);
    if (!arg) break;
    if (arg.startsWith('-')) {
      if (['-s', '--signal', '-k', '--kill-after'].includes(arg.toLowerCase())) {
        idx += 2;
      } else {
        idx++;
      }
    } else {
      idx++;
      break;
    }
  }
  return idx;
}

function _skipEnvArgs(parts: string[], startIndex: number): number {
  let idx = startIndex;
  while (idx < parts.length) {
    const arg = parts.at(idx);
    if (!arg) break;
    if (/^\w+=/.test(arg)) {
      idx++;
    } else if (['-u', '--unset', '-c', '--chdir'].includes(arg.toLowerCase())) {
      idx += 2;
    } else if (arg.startsWith('-')) {
      idx++;
    } else {
      break;
    }
  }
  return idx;
}

function _skipStdbufArgs(parts: string[], startIndex: number): number {
  let idx = startIndex;
  while (idx < parts.length && parts.at(idx)?.startsWith('-')) {
    const flag = parts.at(idx);
    if (
      flag &&
      flag.length === 2 &&
      idx + 1 < parts.length &&
      !parts.at(idx + 1)?.startsWith('-')
    ) {
      idx += 2;
    } else {
      idx++;
    }
  }
  return idx;
}

function _skipXargsArgs(parts: string[], startIndex: number): number {
  let idx = startIndex;
  while (idx < parts.length && parts.at(idx)?.startsWith('-')) {
    const flag = parts.at(idx);
    if (flag && /^-[idnselpa]$/i.test(flag)) {
      idx += 2;
    } else {
      idx++;
    }
  }
  return idx;
}

function _skipGenericWrapperArgs(parts: string[], startIndex: number): number {
  let idx = startIndex;
  while (idx < parts.length) {
    const item = parts.at(idx);
    if (item && (item.startsWith('-') || /^\w+=/.test(item))) {
      idx++;
    } else {
      break;
    }
  }
  return idx;
}

function _skipWrapperArgs(b: string, parts: string[], startIndex: number): number {
  if (b === 'timeout') return _skipTimeoutArgs(parts, startIndex);
  if (b === 'env') return _skipEnvArgs(parts, startIndex);
  if (b === 'stdbuf') return _skipStdbufArgs(parts, startIndex);
  if (b === 'xargs') return _skipXargsArgs(parts, startIndex);
  return _skipGenericWrapperArgs(parts, startIndex);
}

function _skipWrappers(parts: string[]): number {
  let cmdIndex = 0;
  while (cmdIndex < parts.length) {
    const p = parts.at(cmdIndex);
    if (!p) break;
    if (/^\w+=/.test(p)) {
      cmdIndex++;
      continue;
    }
    const b = basename(p).toLowerCase();
    if (!WRAPPERS.has(b)) break;
    cmdIndex = _skipWrapperArgs(b, parts, cmdIndex + 1);
  }
  return cmdIndex;
}

function _matchesBracketChar(base: string, target: string): boolean {
  const open = base.indexOf('[');
  const close = base.indexOf(']', open);
  if (open === -1 || close === -1 || close <= open + 1) return false;
  const chars = base.substring(open + 1, close);
  const targetChar = target.charAt(open);
  if (!targetChar || !chars.includes(targetChar)) return false;
  const reconstructed = base.substring(0, open) + targetChar + base.substring(close + 1);
  return reconstructed === target;
}

function _matchesGlobPattern(base: string, target: string): boolean {
  if (base.includes('[') && base.includes(']') && _matchesBracketChar(base, target)) {
    return true;
  }
  let p = 0;
  let t = 0;
  let starP = -1;
  let starT = -1;
  while (t < target.length) {
    const baseChar = base.charAt(p);
    const targetChar = target.charAt(t);
    if (p < base.length && (baseChar === '?' || baseChar === targetChar)) {
      p++;
      t++;
    } else if (p < base.length && baseChar === '*') {
      starP = p;
      starT = t;
      p++;
    } else if (starP !== -1) {
      p = starP + 1;
      starT++;
      t = starT;
    } else {
      return false;
    }
  }
  while (p < base.length && base.charAt(p) === '*') {
    p++;
  }
  return p === base.length;
}

function _matchesPatternOrBraces(candidate: string, target: string): boolean {
  const lower = candidate.toLowerCase();
  const base = basename(lower);
  if (lower === target || base === target) return true;
  if (/[*?[\]]/.test(base) && _matchesGlobPattern(base, target)) {
    return true;
  }
  if (base.includes('{') && base.includes('}')) {
    const inner = base.replace(/^[^{]*\{([^}]+)\}.*$/, '$1');
    if (inner.split(',').some((v) => v.trim().toLowerCase() === target)) return true;
  }
  return false;
}

function _expandBraces(
  pattern: string,
  maxBranches: number,
): { branches: string[]; overflow: boolean } {
  let overflow = false;
  const helper = (pat: string): string[] => {
    const start = pat.indexOf('{');
    if (start === -1) return [pat];
    const end = pat.indexOf('}', start);
    if (end === -1) return [pat];
    const prefix = pat.substring(0, start);
    const suffix = pat.substring(end + 1);
    const inner = pat.substring(start + 1, end);
    const branches = inner.split(',').map((b) => b.trim());
    const results: string[] = [];
    for (const branch of branches) {
      if (results.length >= maxBranches) {
        overflow = true;
        break;
      }
      const sub = helper(prefix + branch + suffix);
      results.push(...sub);
      if (results.length >= maxBranches) {
        overflow = true;
        break;
      }
    }
    return results.slice(0, maxBranches);
  };
  const branches = helper(pattern);
  return { branches, overflow };
}

function _isWriteRedirection(op: string): boolean {
  return (
    /^(\d*>>?|\d*>\||&>>?)$/.test(op) ||
    ['>', '>>', '1>', '1>>', '2>', '2>>', '&>', '&>>', '>|', '1>|', '2>|'].includes(op)
  );
}

function _extractTargetFromEntry(target: unknown): string | null {
  if (typeof target === 'string') return target;
  if (typeof target === 'object' && target !== null && 'pattern' in target) {
    const pat = (target as { pattern?: unknown }).pattern;
    if (typeof pat === 'string') return pat;
  }
  return null;
}

function _resolveTargetBranches(
  rawTarget: string,
  maxBranches: number,
): { branches: string[]; overflow: boolean } {
  const cleanTarget = rawTarget.replace(/^['"]|['"]$/g, '');
  if (cleanTarget.includes('{') && cleanTarget.includes('}')) {
    return _expandBraces(cleanTarget, maxBranches);
  }
  return { branches: [cleanTarget], overflow: false };
}

function _validateWriteRedirections(
  entries: unknown[],
  currentCwd: string,
  manager: PermissionManager,
): { result: boolean; requiresPermission: boolean; reason?: string } | null {
  const MAX_BRACE_BRANCHES = 64;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries.at(i);
    if (typeof entry !== 'object' || entry === null || !('op' in entry)) continue;
    const op = String((entry as { op?: unknown }).op);
    if (!_isWriteRedirection(op) || i + 1 >= entries.length) continue;

    const rawTarget = _extractTargetFromEntry(entries.at(i + 1));
    if (rawTarget === null) continue;

    const { branches, overflow } = _resolveTargetBranches(rawTarget, MAX_BRACE_BRANCHES);
    if (overflow) {
      return {
        result: false,
        requiresPermission: true,
        reason: `L'expansion d'accolades dépasse la limite autorisée (${MAX_BRACE_BRANCHES} branches).${manager.getAuthorizedDirectoriesHint()}`,
      };
    }

    for (const branch of branches) {
      const writeValidation = manager.validateFileWrite(branch, currentCwd);
      if (!writeValidation.result) return writeValidation;
    }
  }
  return null;
}

function _groupSubCommands(entries: unknown[]): string[][] {
  const CHAIN_OPS = new Set([';', '&&', '||', '|', '&']);
  const subCommands: string[][] = [[]];

  for (const entry of entries) {
    if (typeof entry === 'object' && entry !== null && 'op' in entry) {
      const op = String((entry as { op?: unknown }).op);
      if (CHAIN_OPS.has(op)) {
        subCommands.push([]);
      } else if (op === 'glob' && 'pattern' in entry && typeof entry.pattern === 'string') {
        subCommands.at(-1)?.push(entry.pattern);
      }
    } else if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed !== '{' && trimmed !== '}') {
        subCommands.at(-1)?.push(entry);
      }
    }
  }
  return subCommands;
}

function _isShellInterpreter(token: string): boolean {
  return ['bash', 'sh', 'zsh', 'dash', 'ksh', 'ash'].includes(token);
}

function _isPythonInterpreter(token: string): boolean {
  return token.startsWith('python');
}

function _isNodeInterpreter(token: string): boolean {
  return token.startsWith('node');
}

function _isScriptInterpreter(token: string): boolean {
  return token === 'perl' || token === 'ruby' || token === 'lua';
}

function _isForbiddenInlineFlag(token: string, flag: string): boolean {
  if (!flag.startsWith('-')) return false;
  if (_isShellInterpreter(token) || _isPythonInterpreter(token)) {
    return !flag.startsWith('--') && flag.includes('c');
  }
  if (_isNodeInterpreter(token)) {
    return flag === '-e' || flag === '--eval' || (!flag.startsWith('--') && flag.includes('e'));
  }
  if (_isScriptInterpreter(token)) {
    return !flag.startsWith('--') && flag.includes('e');
  }
  return false;
}

function _checkInlineFlagsOnTokens(
  parts: string[],
): { result: boolean; requiresPermission: boolean; reason?: string } | null {
  for (let i = 0; i < parts.length; i++) {
    const tokenPart = parts.at(i);
    if (!tokenPart) continue;
    const token = basename(tokenPart).toLowerCase();
    const isInterp =
      _isShellInterpreter(token) ||
      _isPythonInterpreter(token) ||
      _isNodeInterpreter(token) ||
      _isScriptInterpreter(token);
    if (!isInterp) continue;

    for (let j = i + 1; j < parts.length; j++) {
      const flag = parts.at(j)?.toLowerCase();
      if (!flag || !flag.startsWith('-')) break;
      if (_isForbiddenInlineFlag(token, flag)) {
        return {
          result: false,
          requiresPermission: false,
          reason: `The combination '${token} ... ${flag}' is strictly forbidden (inline execution outside sandbox).`,
        };
      }
    }
  }
  return null;
}

function _checkPrivilegeEscalationArgs(
  parts: string[],
  cmdIndex: number,
): { result: boolean; requiresPermission: boolean; reason?: string } | null {
  for (let i = cmdIndex + 1; i < parts.length; i++) {
    const token = parts.at(i);
    if (!token) continue;
    const hasSubstitution = /[`$()]/.test(token);
    const prevToken = parts.at(i - 1)?.toLowerCase();
    const isExecutionArg =
      prevToken === '-c' ||
      prevToken === '-exec' ||
      prevToken === '--exec' ||
      prevToken === 'xargs' ||
      prevToken === 'sh' ||
      prevToken === 'bash';
    const cleaned = token.replace(/[`$()]/g, '');
    const matchesPrivilege = PRIVILEGE_ESCALATION_COMMANDS.some((cmd) =>
      _matchesPatternOrBraces(cleaned, cmd),
    );
    if (matchesPrivilege && (hasSubstitution || isExecutionArg)) {
      return {
        result: false,
        requiresPermission: false,
        reason: `Command contains strictly forbidden privilege escalation construct: '${token}'.`,
      };
    }
  }
  return null;
}

function _checkInlineExecution(
  baseCmd: string,
  parts: string[],
  cmdIndex: number,
): { result: boolean; requiresPermission: boolean; reason?: string } | null {
  for (let i = cmdIndex + 1; i < parts.length; i++) {
    const flag = parts.at(i)?.toLowerCase();
    if (!flag) continue;

    const isInline =
      _isForbiddenInlineFlag(baseCmd, flag) ||
      BANNED_FLAG_PATTERNS.some(([cmd, bannedFlag]) => baseCmd === cmd && flag === bannedFlag);

    if (isInline) {
      return {
        result: false,
        requiresPermission: false,
        reason: `The combination '${baseCmd} ${flag}' is strictly forbidden (inline execution outside sandbox).`,
      };
    }
  }
  return null;
}

function _validateCdAndPushd(
  baseCmd: string,
  parts: string[],
  cmdIndex: number,
  currentCwd: string,
  manager: PermissionManager,
): { result: boolean; requiresPermission: boolean; reason?: string } | null {
  if (baseCmd !== 'cd' && baseCmd !== 'pushd') return null;

  const targetDirArg = parts.slice(cmdIndex + 1).find((arg) => !arg.startsWith('-'));
  let targetDir: string;
  if (!targetDirArg) {
    targetDir = homedir();
  } else {
    const rawDir = targetDirArg.replace(/^['"]|['"]$/g, '');
    if (/[$`()\\]/.test(rawDir)) {
      return {
        result: false,
        requiresPermission: true,
        reason: `Cannot navigate to '${rawDir}': dynamic variables or expansions used in path.${manager.getAuthorizedDirectoriesHint()}`,
      };
    }
    if (rawDir === '~') {
      targetDir = homedir();
    } else if (rawDir.startsWith('~/')) {
      targetDir = safePath(`${homedir()}/${rawDir.slice(2)}`);
    } else if (rawDir.startsWith('~')) {
      targetDir = resolve(dirname(homedir()), rawDir.slice(1));
    } else {
      targetDir = rawDir;
    }
  }

  if (!manager.isInSandbox(targetDir, currentCwd)) {
    return {
      result: false,
      requiresPermission: true,
      reason: `Cannot navigate to '${targetDir}': directory outside sandbox.${manager.getAuthorizedDirectoriesHint()}`,
    };
  }
  return null;
}

function _checkBannedOrInterpreters(
  baseCmd: string,
  manager: PermissionManager,
): { result: boolean; requiresPermission: boolean; reason?: string } | null {
  const isBanned = BANNED_COMMANDS.some((banned) => _matchesPatternOrBraces(baseCmd, banned));
  if (isBanned) {
    return {
      result: false,
      requiresPermission: false,
      reason: `Command '${baseCmd}' is strictly forbidden (privilege escalation).`,
    };
  }

  if (/^(awk|gawk|mawk|nawk)$/.test(baseCmd)) {
    return {
      result: false,
      requiresPermission: true,
      reason: `The interpreter '${baseCmd}' can execute system commands from its program argument.${manager.getAuthorizedDirectoriesHint()}`,
    };
  }

  if (/^(sed|gsed)$/.test(baseCmd)) {
    return {
      result: false,
      requiresPermission: true,
      reason: `The stream editor '${baseCmd}' can execute system commands or modify files arbitrarily.${manager.getAuthorizedDirectoriesHint()}`,
    };
  }

  return null;
}

function _validateSingleSubCommand(
  parts: string[],
  currentCwd: string,
  manager: PermissionManager,
): { result: boolean; requiresPermission: boolean; reason?: string } | null {
  if (parts.length === 0) return null;

  const inlineTokensRes = _checkInlineFlagsOnTokens(parts);
  if (inlineTokensRes) return inlineTokensRes;

  const cmdIndex = _skipWrappers(parts);
  if (cmdIndex >= parts.length) return null;

  const rawBase = parts.at(cmdIndex) ?? '';
  const baseCmd = basename(rawBase).toLowerCase();

  const bannedRes = _checkBannedOrInterpreters(baseCmd, manager);
  if (bannedRes) return bannedRes;

  const privEscRes = _checkPrivilegeEscalationArgs(parts, cmdIndex);
  if (privEscRes) return privEscRes;

  const inlineExecRes = _checkInlineExecution(baseCmd, parts, cmdIndex);
  if (inlineExecRes) return inlineExecRes;

  return _validateCdAndPushd(baseCmd, parts, cmdIndex, currentCwd, manager);
}

function _hasDynamicCdOrPushd(command: string): boolean {
  const subLines = command.split(/[;&|\n]+/);
  for (const sub of subLines) {
    const trimmed = sub.trim();
    if (
      (trimmed.startsWith('cd ') ||
        trimmed.startsWith('pushd ') ||
        trimmed === 'cd' ||
        trimmed === 'pushd') &&
      /[$`()\\]/.test(trimmed)
    ) {
      return true;
    }
  }
  return false;
}

function _determineInitialApproverJid(
  hubId: string | undefined,
  sourceChannel: string,
  senderJid: string,
): string {
  if (hubId) return 'HUB_ADMIN_ONLY';
  if (sourceChannel === 'cli' || sourceChannel === 'tui' || sourceChannel === 'ink-cli') {
    return senderJid;
  }
  return 'PENDING_ADMIN_CHECK';
}

export class PermissionManager {
  private originalCwd: string;
  public sandboxDir: string;
  public storageDir: string;
  private allowedDirectories: Set<string> = new Set();

  /** Map requestId (string "perm_xxx") → PendingRequest */
  private pendingRequests: Map<string, PendingRequest> = new Map();
  /** Map numericId (number) → requestId (string) pour les commandes .approve/.reject */
  private numericIdMap: Map<number, string> = new Map();

  private requestCounter: number = 0;

  // ===== Configuration (via process.env) =====

  /** Dedicated Admin Hub channel (LOGIC 1) — e.g. WhatsApp group ID, Discord channel */
  private readonly SECURITY_HUB_ID = process.env.SECURITY_HUB_ID || '';
  /** Transport for the Hub (whatsapp, telegram, discord) */
  private readonly SECURITY_TRANSPORT = process.env.SECURITY_TRANSPORT || 'whatsapp';
  /** Timeout In-Band (LOGIC 2) — 10 minutes */
  private readonly INBAND_TIMEOUT_MS = 10 * 60 * 1000;
  /** Timeout Admin Hub (LOGIC 1) — 10 minutes before fallback to LOGIC 2 */
  private readonly HUB_TIMEOUT_MS = 10 * 60 * 1000;

  constructor() {
    this.originalCwd = process.cwd();
    this.sandboxDir = process.env.SANDBOX_DIR
      ? resolve(process.env.SANDBOX_DIR)
      : resolve(this.originalCwd, 'Sandbox1');

    this.storageDir = process.env.STORAGE_DIR
      ? resolve(process.env.STORAGE_DIR)
      : resolve(this.originalCwd, 'storage_hm');

    // 1. Create physical sandbox directory
    if (!safeExistsSync(this.sandboxDir)) {
      safeMkdirSync(this.sandboxDir, { recursive: true });
    }

    // 2. Create physical storage inside sandbox
    const physicalStoragePath = resolve(this.sandboxDir, 'storage_hm');
    if (!safeExistsSync(physicalStoragePath)) {
      safeMkdirSync(physicalStoragePath, { recursive: true });
    }

    // 3. Create/verify symlink at project root for agent transparency
    const symlinkPath = resolve(this.originalCwd, 'storage_hm');
    try {
      const stats = safeLstatSync(symlinkPath);
      if (!stats.isSymbolicLink() && stats.isDirectory()) {
        const entries = safeReaddirSync(symlinkPath);
        if (entries.length === 0) {
          safeRmdirSync(symlinkPath);
          safeSymlinkSync(physicalStoragePath, symlinkPath);
        }
      }
    } catch {
      safeSymlinkSync(physicalStoragePath, symlinkPath);
    }

    this.allowedDirectories.add(this.sandboxDir);
    this.allowedDirectories.add(this.storageDir);
  }

  // =========================================================================
  // SANDBOX VALIDATION
  // =========================================================================

  isInSandbox(targetPath: string, currentCwd: string = this.originalCwd): boolean {
    const absoluteTarget = resolvePathWithSymlinks(targetPath, currentCwd);
    const resolvedAllowed = Array.from(this.allowedDirectories).map(safeRealPathOrSelf);

    for (const allowedPath of resolvedAllowed) {
      if (
        absoluteTarget === allowedPath ||
        absoluteTarget.startsWith(allowedPath + '/') ||
        absoluteTarget.startsWith(allowedPath + '\\')
      ) {
        return true;
      }
    }
    return false;
  }

  public getAuthorizedDirectoriesHint(): string {
    return (
      '\n[SANDBOX HINT] You have universal READ access to the entire filesystem (the "Host Disk"). However, for WRITE access, you are strictly limited to your two authorized virtual disks:\n' +
      `  - Sandbox Execution Disk: ${basename(this.sandboxDir)}/ (for running scripts, compiling code, and temporary tasks).\n` +
      `  - Dedicated Storage Disk: ${basename(this.storageDir)}/ (for persistently saving your data, documents, stickers, screenshots).\n` +
      'Any other directory (the rest of the project, /home, etc.) is the "Host Disk" and is READ-ONLY. Retry your write action targeting one of your two authorized virtual disks.'
    );
  }

  validateBashCommand(
    command: string,
    currentCwd: string = this.originalCwd,
  ): { result: boolean; requiresPermission: boolean; reason?: string } {
    const trimmed = command.trim();
    if (SAFE_COMMANDS.has(trimmed)) {
      return { result: true, requiresPermission: false };
    }

    const multilineRes = this._checkMultiline(command, currentCwd);
    if (multilineRes) return multilineRes;

    const subshellRes = this._checkSubshells(command, currentCwd);
    if (subshellRes) return subshellRes;

    if (_hasDynamicCdOrPushd(command)) {
      return {
        result: false,
        requiresPermission: true,
        reason: `Cannot navigate: dynamic variables or expansions used in path.${this.getAuthorizedDirectoriesHint()}`,
      };
    }

    const entries = parseShell(command);
    const writeRes = _validateWriteRedirections(entries, currentCwd, this);
    if (writeRes) return writeRes;

    const subCommands = _groupSubCommands(entries);
    for (const parts of subCommands) {
      const subRes = _validateSingleSubCommand(parts, currentCwd, this);
      if (subRes) return subRes;
    }

    return { result: true, requiresPermission: false };
  }

  private _checkMultiline(
    command: string,
    currentCwd: string,
  ): { result: boolean; requiresPermission: boolean; reason?: string } | null {
    const lines = command.split(/[\r\n]+/);
    if (lines.length <= 1) return null;
    for (const line of lines) {
      if (!line.trim()) continue;
      const lineRes = this.validateBashCommand(line, currentCwd);
      if (!lineRes.result || lineRes.requiresPermission) {
        return lineRes;
      }
    }
    return { result: true, requiresPermission: false };
  }

  private _checkSubshells(
    command: string,
    currentCwd: string,
  ): { result: boolean; requiresPermission: boolean; reason?: string } | null {
    const subshellRegex = /\$\(([^)]+)\)|`([^`]+)`|<(?:\(([^)]+)\))|>(?:\(([^)]+)\))/g;
    let match: RegExpExecArray | null;
    while ((match = subshellRegex.exec(command)) !== null) {
      const innerCmd = match.at(1) ?? match.at(2) ?? match.at(3) ?? match.at(4);
      if (innerCmd && innerCmd.trim()) {
        const innerValidation = this.validateBashCommand(innerCmd, currentCwd);
        if (!innerValidation.result || innerValidation.requiresPermission) {
          return innerValidation;
        }
      }
    }
    return null;
  }

  validateFileWrite(
    filePath: string,
    currentCwd: string = this.originalCwd,
  ): { result: boolean; requiresPermission: boolean; reason?: string } {
    if (!this.isInSandbox(filePath, currentCwd)) {
      return {
        result: false,
        requiresPermission: true,
        reason: `Cannot write to '${filePath}': directory outside sandbox.${this.getAuthorizedDirectoriesHint()}`,
      };
    }
    return { result: true, requiresPermission: false };
  }

  // =========================================================================
  // PERMISSION REQUEST — DUAL LOGIC
  // =========================================================================

  async askPermission(
    chatId: string,
    actionDescription: string,
    sourceChannel: string = 'whatsapp',
    senderJid: string = 'system',
  ): Promise<PermissionResult> {
    this.requestCounter++;
    const numericId = this.requestCounter;
    const requestId = `perm_${Date.now()}_${numericId}`;

    return new Promise((resolvePromise) => {
      const initialApprover = _determineInitialApproverJid(
        this.SECURITY_HUB_ID || undefined,
        sourceChannel,
        senderJid,
      );
      const pending: PendingRequest = {
        id: requestId,
        numericId,
        chatId,
        senderJid,
        actionDescription,
        sourceChannel,
        createdAt: Date.now(),
        resolve: resolvePromise,
        targetChat: this.SECURITY_HUB_ID ? this.SECURITY_HUB_ID : chatId,
        allowedApproverJid: initialApprover,
      };

      this.pendingRequests.set(requestId, pending);
      this.numericIdMap.set(numericId, requestId);

      this._executePermissionRequest(pending).catch((err) => {
        console.error('[Permission] 💥 Uncaught error in permission executor:', err);
        this._cleanup(requestId, numericId);
        resolvePromise({
          granted: false,
          feedback: `Internal security system error: ${extractErrorMessage(err)}`,
        });
      });
    });
  }

  private async _executePermissionRequest(pending: PendingRequest): Promise<void> {
    const {
      chatId,
      actionDescription,
      sourceChannel,
      senderJid,
      id: requestId,
      numericId,
    } = pending;

    // ── LOGIC 0: CLI / TUI (Local Admin) ──
    if (sourceChannel === 'cli' || sourceChannel === 'tui' || sourceChannel === 'ink-cli') {
      console.log(
        `[Permission] 💻 Local ${sourceChannel.toUpperCase()} request, asking directly in terminal.`,
      );

      if (sourceChannel === 'tui' || sourceChannel === 'ink-cli') {
        try {
          const { hiveTransport } = await import('../transport/tui/HiveTransport.js');
          const response = await hiveTransport.requestConfirmation(
            'permission_request',
            { chatId, senderJid, actionDescription },
            actionDescription,
          );

          this._cleanup(requestId, numericId);
          pending.resolve({
            granted: response.approved,
            feedback: response.feedback,
          });
          return;
        } catch (importErr) {
          console.warn('[Permission] ⚠️ TUI bridge unavailable, fallback to terminal:', importErr);
        }
      }

      await this._startInBandFallback(pending, true);
      return;
    }

    // ── LOGIC 1: Admin Hub (Out-of-Band) ──
    if (this.SECURITY_HUB_ID) {
      try {
        await this._sendHubRequest(pending);
        console.log(
          `[Permission] 🏢 Request #${numericId} sent to Hub (${this.SECURITY_TRANSPORT})`,
        );

        await transportManager
          .sendText(
            chatId,
            `⏳ _Une action sensible a été détectée. En attente de validation par l'administrateur système (Requête #${numericId})..._\n_A sensitive action was detected. Waiting for system administrator approval (Request #${numericId})..._`,
            {},
            sourceChannel,
          )
          .catch(() => {});

        setTimeout(() => {
          if (this.pendingRequests.has(requestId)) {
            console.log(
              `[Permission] ⏰ Hub timeout for #${numericId}, escalating to LOGIC 2 (In-Band)`,
            );
            this._startInBandFallback(pending, false).catch(() => {});
          }
        }, this.HUB_TIMEOUT_MS);

        return;
      } catch (hubErr) {
        console.warn('[Permission] ⚠️ Hub unavailable, direct fallback to LOGIC 2:', hubErr);
      }
    }

    // ── LOGIC 2: In-Band with Escalation (direct or fallback) ──
    await this._startInBandFallback(pending, false);
  }

  // =========================================================================
  // LOGIC 1 — ADMIN HUB (Out-of-Band)
  // =========================================================================

  private async _sendHubRequest(pending: PendingRequest): Promise<void> {
    const promptMessage =
      `🚨 *REQUÊTE DE SÉCURITÉ / SECURITY REQUEST #${pending.numericId}* 🚨\n\n` +
      `*Source:* Conversation \`${pending.chatId.split('@')[0]}\`\n` +
      `*Initiateur / Initiator:* ${pending.senderJid.split('@')[0]}\n` +
      `*Action:* ${pending.actionDescription}\n\n` +
      'Pour répondre / To respond:\n' +
      `👉 \`.approve ${pending.numericId}\`\n` +
      `👉 \`.reject ${pending.numericId} [instructions]\``;

    await transportManager.sendText(
      this.SECURITY_HUB_ID,
      promptMessage,
      {},
      this.SECURITY_TRANSPORT,
    );
  }

  async handleAdminCommand(text: string, chatId: string, senderJid: string): Promise<boolean> {
    const trimmed = text.trim();

    const approveMatch = trimmed.match(/^\.approve\s+(\d+)$/i);
    if (approveMatch) {
      const numId = parseInt(approveMatch[1], 10);
      return await this._resolveByNumericId(numId, { granted: true }, chatId, senderJid);
    }

    if (trimmed.toLowerCase().startsWith('.reject')) {
      const rest = trimmed.substring(7).trim();
      const spaceIdx = rest.search(/\s/);
      const idStr = spaceIdx === -1 ? rest : rest.substring(0, spaceIdx);
      if (/^\d+$/.test(idStr)) {
        const numId = parseInt(idStr, 10);
        const feedback = spaceIdx === -1 ? undefined : rest.substring(spaceIdx).trim() || undefined;
        const feedbackStr = feedback ? ` avec feedback: "${feedback}"` : '';
        console.log(`[Permission] 📝 Rejet #${numId}${feedbackStr}`);
        return await this._resolveByNumericId(
          numId,
          { granted: false, feedback },
          chatId,
          senderJid,
        );
      }
    }

    return false;
  }

  private async _verifyAdminPermissions(
    pending: PendingRequest,
    chatId: string,
    senderJid: string,
    numericId: number,
  ): Promise<boolean> {
    const expectedChat = pending.targetChat ?? pending.chatId;
    if (expectedChat !== chatId && chatId !== this.SECURITY_HUB_ID) {
      console.warn(
        '[Permission] ⛔ Commande admin rejetée: chat non autorisé pour la requête:',
        chatId,
        numericId,
      );
      return false;
    }

    if (pending.allowedApproverJid === 'PENDING_ADMIN_CHECK') {
      console.warn(
        '[Permission] ⏳ Commande admin rejetée: requête en cours de résolution des droits:',
        numericId,
      );
      return false;
    }

    if (pending.allowedApproverJid === 'HUB_ADMIN_ONLY') {
      if (chatId !== this.SECURITY_HUB_ID || !senderJid) {
        console.warn('[Permission] ⛔ Commande admin rejetée: hors hub ou sender non fourni.');
        return false;
      }
      try {
        const isSuper = await adminService.isSuperUser(senderJid);
        if (!isSuper) {
          console.warn(
            '[Permission] ⛔ Commande admin rejetée: sender non superuser en mode Hub:',
            senderJid,
          );
          return false;
        }
      } catch (err) {
        console.error(
          '[Permission] ❌ Erreur lors de la vérification superuser pour sender:',
          senderJid,
          err,
        );
        return false;
      }
    } else if (
      !pending.allowedApproverJid ||
      !senderJid ||
      pending.allowedApproverJid !== senderJid
    ) {
      console.warn(
        '[Permission] ⛔ Commande admin rejetée: sender non autorisé:',
        senderJid,
        'attendu:',
        pending.allowedApproverJid,
      );
      return false;
    }

    return true;
  }

  private async _resolveByNumericId(
    numericId: number,
    result: PermissionResult,
    chatId: string,
    senderJid: string,
  ): Promise<boolean> {
    const requestId = this.numericIdMap.get(numericId);
    if (!requestId) {
      console.warn(`[Permission] ⚠️ Request #${numericId} not found or expired`);
      return false;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;

    const isAuthorized = await this._verifyAdminPermissions(pending, chatId, senderJid, numericId);
    if (!isAuthorized) return false;

    console.log(
      `[Permission] ${result.granted ? '✅' : '❌'} Request #${numericId} ${result.granted ? 'approved' : 'rejected'}`,
    );
    this._cleanup(requestId, numericId);
    pending.resolve(result);
    return true;
  }

  // =========================================================================
  // LOGIC 2 — IN-BAND WITH ESCALATION (Fallback)
  // =========================================================================

  private async _startInBandFallback(
    pending: PendingRequest,
    forceDirect: boolean = false,
  ): Promise<void> {
    const {
      chatId,
      senderJid,
      actionDescription,
      sourceChannel,
      id: requestId,
      numericId,
    } = pending;

    let targetChat = chatId;
    let escalated = false;
    let targetChannel = sourceChannel;

    const isAdmin = forceDirect || (await adminService.isSuperUser(senderJid));

    if (!isAdmin) {
      const ownerJid = await adminService.getOwnerJid();
      if (ownerJid) {
        targetChat = ownerJid;
        targetChannel = 'whatsapp';
        escalated = true;
        pending.targetChat = ownerJid;
        pending.allowedApproverJid = ownerJid;
        console.log(`[Permission] 🔀 Escalation #${numericId}: request sent via DM to Owner (DB)`);
      } else {
        console.warn('[Permission] ⚠️ No owner found in global_admins. Blocking by default.');
        this._cleanup(requestId, numericId);
        pending.resolve({
          granted: false,
          feedback: 'No owner configured in the database to approve this action.',
        });
        return;
      }
    } else {
      pending.targetChat = chatId;
      pending.allowedApproverJid = senderJid;
      console.log(
        `[Permission] 💬 In-Band request #${numericId} in current chat${forceDirect ? ' (Local CLI)' : ''}`,
      );
    }

    const reqStr = forceDirect ? '' : ` — Requête/Request #${numericId}`;
    const escStr = escalated ? ' (Escalade/Escalation)' : '';
    const promptMessage =
      `⚠️ *ALERTE SÉCURITÉ / SECURITY ALERT${escStr}${reqStr}* ⚠️\n\n` +
      "L'agent IA tente une action hors sandbox :\n" +
      'The AI agent is attempting an action outside the sandbox:\n' +
      `*Action:* ${actionDescription}\n` +
      `*Demandé par / Requested by:* ${senderJid.split('@')[0]}\n\n` +
      'Répondez par / Reply with:\n' +
      '👉 *oui / yes* (autoriser / allow)\n' +
      '👉 *non / no* (bloquer / block)\n' +
      "👉 *non, [consigne] / no, [instruction]* (corriger l'agent / correct the agent)";

    try {
      await transportManager.sendText(targetChat, promptMessage, {}, targetChannel);

      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          console.log(`[Permission] ⏰ In-Band timeout for #${numericId}. Action blocked.`);
          transportManager
            .sendText(
              targetChat,
              `⏳ Timeout de la demande #${numericId}. Action bloquée par défaut.\nRequest #${numericId} timed out. Action blocked by default.`,
              {},
              targetChannel,
            )
            .catch(() => {});
          this._cleanup(requestId, numericId);
          pending.resolve({
            granted: false,
            feedback: 'The administrator did not respond in time (Timeout).',
          });
        }
      }, this.INBAND_TIMEOUT_MS);
    } catch (error) {
      console.error('[Permission] ❌ Failed to send In-Band request:', error);
      this._cleanup(requestId, numericId);
      pending.resolve({
        granted: false,
        feedback:
          'Unable to reach the administrator (network/connection error). Action blocked for security. Please try again later.',
      });
    }
  }

  // =========================================================================
  // IN-BAND RESPONSE HANDLER (oui/non/non, feedback)
  // =========================================================================

  private _findRequestByChat(chatId: string, senderJid?: string): PendingRequest | null {
    for (const req of this.pendingRequests.values()) {
      const expectedChat = req.targetChat ?? req.chatId;
      if (
        expectedChat === chatId &&
        req.allowedApproverJid &&
        senderJid &&
        req.allowedApproverJid === senderJid
      ) {
        return req;
      }
    }
    for (const req of this.pendingRequests.values()) {
      const expectedChat = req.targetChat ?? req.chatId;
      if (
        expectedChat === chatId &&
        (!req.allowedApproverJid || (senderJid && req.allowedApproverJid === senderJid))
      ) {
        return req;
      }
    }
    return null;
  }

  private _findMatchingPendingRequest(chatId?: string, senderJid?: string): PendingRequest | null {
    if (chatId) return this._findRequestByChat(chatId, senderJid);
    if (senderJid) {
      for (const req of this.pendingRequests.values()) {
        if (req.allowedApproverJid === senderJid) return req;
      }
    }
    const firstKey = this.pendingRequests.keys().next().value;
    return firstKey !== undefined ? (this.pendingRequests.get(firstKey) ?? null) : null;
  }

  private _verifyApproverAuthorization(pending: PendingRequest, senderJid?: string): boolean {
    if (pending.allowedApproverJid === 'PENDING_ADMIN_CHECK') {
      console.warn(
        '[Permission] ⏳ Approbation rejetée: requête en cours de résolution des droits admin:',
        pending.numericId,
      );
      return false;
    }

    if (pending.allowedApproverJid === 'HUB_ADMIN_ONLY') {
      console.warn(
        '[Permission] ⛔ Réponse in-band refusée: requête en mode Hub, utilisez .approve/.reject:',
        pending.numericId,
      );
      return false;
    }

    if (!pending.allowedApproverJid || !senderJid || pending.allowedApproverJid !== senderJid) {
      console.warn(
        '[Permission] ⛔ Approbation non autorisée tentée par sender:',
        senderJid,
        'attendu:',
        pending.allowedApproverJid,
      );
      return false;
    }

    return true;
  }

  private _parseResponseFeedback(
    trimmed: string,
    lowerText: string,
  ): { granted: boolean; feedback?: string } | null {
    if (/^(oui|y|yes|ok|autoriser|allow)$/i.test(lowerText)) {
      return { granted: true };
    }

    const firstSpaceOrComma = trimmed.search(/[,\s]/);
    if (firstSpaceOrComma !== -1) {
      const prefix = lowerText.substring(0, firstSpaceOrComma);
      if (prefix === 'no' || prefix === 'non') {
        const feedback = trimmed
          .substring(firstSpaceOrComma + 1)
          .replace(/^[,\s]+/, '')
          .trim();
        if (feedback) {
          return { granted: false, feedback };
        }
      }
    }

    if (/^(non|n|no|bloquer|annuler|block|cancel)$/i.test(lowerText)) {
      return { granted: false };
    }

    return null;
  }

  handleUserResponse(text: string, chatId?: string, senderJid?: string): boolean {
    if (this.pendingRequests.size === 0) return false;

    const pending = this._findMatchingPendingRequest(chatId, senderJid);
    if (!pending) return false;

    if (!this._verifyApproverAuthorization(pending, senderJid)) {
      return false;
    }

    const trimmed = text.trim();
    const lowerText = trimmed.toLowerCase();
    const responseResult = this._parseResponseFeedback(trimmed, lowerText);
    if (!responseResult) return false;

    const { granted, feedback } = responseResult;
    let logMsg = `[Permission] ❌ Request #${pending.numericId} rejected (In-Band)`;
    if (granted) {
      logMsg = `[Permission] ✅ Request #${pending.numericId} approved (In-Band)`;
    } else if (feedback) {
      logMsg = `[Permission] ❌ Request #${pending.numericId} rejected with feedback: "${feedback}"`;
    }
    console.log(logMsg);

    this._cleanup(pending.id, pending.numericId);
    pending.resolve(responseResult);
    return true;
  }

  // =========================================================================
  // UTILITIES
  // =========================================================================

  private _cleanup(requestId: string, numericId: number): void {
    this.pendingRequests.delete(requestId);
    this.numericIdMap.delete(numericId);
  }

  get pendingCount(): number {
    return this.pendingRequests.size;
  }
}

export const permissionManager = new PermissionManager();
