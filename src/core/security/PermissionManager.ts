import { resolve, isAbsolute, basename, sep } from 'path';
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
export const BANNED_COMMANDS = ['su', 'sudo'];

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

  private getAuthorizedDirectoriesHint(): string {
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
    const parts = command.trim().split(/\s+/);
    const baseCmd = parts[0]?.toLowerCase();

    if (BANNED_COMMANDS.includes(baseCmd)) {
      return {
        result: false,
        requiresPermission: false,
        reason: `Command '${baseCmd}' is strictly forbidden (privilege escalation).`,
      };
    }

    const firstFlag = parts[1]?.toLowerCase();
    if (firstFlag) {
      const isPatternBanned = BANNED_FLAG_PATTERNS.some(
        ([cmd, flag]) => baseCmd === cmd && firstFlag === flag,
      );
      if (isPatternBanned) {
        return {
          result: false,
          requiresPermission: false,
          reason: `The combination '${baseCmd} ${firstFlag}' is forbidden (inline execution outside sandbox).`,
        };
      }
    }

    if (SAFE_COMMANDS.has(command.trim())) {
      return { result: true, requiresPermission: false };
    }
    if (baseCmd === 'cd' && parts[1]) {
      const targetDir = parts[1].replace(/^['"]|['"]$/g, '');
      if (!this.isInSandbox(targetDir, currentCwd)) {
        return {
          result: false,
          requiresPermission: true,
          reason: `Cannot navigate to '${targetDir}': directory outside sandbox.${this.getAuthorizedDirectoriesHint()}`,
        };
      }
    }
    return { result: true, requiresPermission: false };
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
      const pending: PendingRequest = {
        id: requestId,
        numericId,
        chatId,
        senderJid,
        actionDescription,
        sourceChannel,
        createdAt: Date.now(),
        resolve: resolvePromise,
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

  handleAdminCommand(text: string): boolean {
    const trimmed = text.trim();

    const approveMatch = trimmed.match(/^\.approve\s+(\d+)$/i);
    if (approveMatch) {
      const numId = parseInt(approveMatch[1], 10);
      return this._resolveByNumericId(numId, { granted: true });
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
        return this._resolveByNumericId(numId, { granted: false, feedback });
      }
    }

    return false;
  }

  private _resolveByNumericId(numericId: number, result: PermissionResult): boolean {
    const requestId = this.numericIdMap.get(numericId);
    if (!requestId) {
      console.warn(`[Permission] ⚠️ Request #${numericId} not found or expired`);
      return false;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;

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

  handleUserResponse(text: string): boolean {
    if (this.pendingRequests.size === 0) return false;

    const trimmed = text.trim();
    const lowerText = trimmed.toLowerCase();

    const firstKey = this.pendingRequests.keys().next().value;
    if (firstKey === undefined) return false;
    const pending = this.pendingRequests.get(firstKey);
    if (!pending) return false;

    if (/^(oui|y|yes|ok|autoriser|allow)$/i.test(lowerText)) {
      console.log(`[Permission] ✅ Request #${pending.numericId} approved (In-Band)`);
      this._cleanup(pending.id, pending.numericId);
      pending.resolve({ granted: true });
      return true;
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
          console.log(
            `[Permission] ❌ Request #${pending.numericId} rejected with feedback: "${feedback}"`,
          );
          this._cleanup(pending.id, pending.numericId);
          pending.resolve({ granted: false, feedback });
          return true;
        }
      }
    }

    if (/^(non|n|no|bloquer|annuler|block|cancel)$/i.test(lowerText)) {
      console.log(`[Permission] ❌ Request #${pending.numericId} rejected (In-Band)`);
      this._cleanup(pending.id, pending.numericId);
      pending.resolve({ granted: false });
      return true;
    }

    return false;
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
