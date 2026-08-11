import { execFile } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';
import { safeExistsSync, safeMkdirSync, resolveWithinRoot } from '../../utils/safeFs.js';
import {
  BrowserResult,
  SnapshotResult,
  ScreenshotResult,
  BrowserExecOptions,
  RefInfo,
} from './types.js';

const execFileAsync = promisify(execFile);

export class BrowserService {
  private static instance: BrowserService;
  private readonly binaryName = 'agent-browser';
  private readonly defaultTimeout = 25000; // 25s
  private screenshotDir: string;
  private blockedDomains: string[];

  // WHY: Sensible defaults block NSFW/malware domains without requiring config.
  // Extend via AGENT_BROWSER_BLOCKED_DOMAINS env var (comma-separated).
  private static readonly DEFAULT_BLOCKED_DOMAINS = [
    // Adult / NSFW
    'pornhub.com',
    'xvideos.com',
    'xnxx.com',
    'xhamster.com',
    'redtube.com',
    'youporn.com',
    // Darknet gateways
    'onion.to',
    'onion.ws',
    'onion.ly',
  ];

  private constructor() {
    // Initialize screenshot directory
    const storageDir = process.env.STORAGE_DIR || join(process.cwd(), 'storage_hm');
    this.screenshotDir =
      process.env.AGENT_BROWSER_SCREENSHOT_DIR || join(storageDir, 'screenshots');

    if (!safeExistsSync(this.screenshotDir)) {
      safeMkdirSync(this.screenshotDir, { recursive: true });
    }

    // Initialize blocked domains (blacklist approach — open by default)
    const envDomains = process.env.AGENT_BROWSER_BLOCKED_DOMAINS;
    const extraDomains = envDomains ? envDomains.split(',').map((d) => d.trim()) : [];
    this.blockedDomains = [...BrowserService.DEFAULT_BLOCKED_DOMAINS, ...extraDomains];
  }

  public static getInstance(): BrowserService {
    if (!BrowserService.instance) {
      BrowserService.instance = new BrowserService();
    }
    return BrowserService.instance;
  }

  private _parseExecOutput(stdout: string, stderr: string): BrowserResult {
    if (stderr && !stdout) {
      return { success: false, error: stderr.trim() };
    }
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.success === false) {
        return { success: false, error: parsed.error || 'Unknown CLI error', data: parsed.data };
      }
      return { success: true, data: parsed.data };
    } catch {
      return { success: true, data: stdout.trim() };
    }
  }

  private _parseExecError(error: unknown): BrowserResult {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errObj = error as Record<string, unknown>;
    if (
      typeof errObj === 'object' &&
      errObj !== null &&
      'stdout' in errObj &&
      typeof errObj.stdout === 'string'
    ) {
      try {
        const parsed = JSON.parse(errObj.stdout);
        return { success: false, error: parsed.error || errorMessage, data: parsed.data };
      } catch {
        return { success: false, error: errObj.stdout.trim() };
      }
    }
    return { success: false, error: errorMessage };
  }

  /**
   * Core execution wrapper for agent-browser CLI
   */
  private async exec(args: string[], options: BrowserExecOptions = {}): Promise<BrowserResult> {
    const cmdArgs = [...args, '--json'];
    if (options.session) {
      cmdArgs.push('--session', options.session);
    }
    const timeout = options.timeout || this.defaultTimeout;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AGENT_BROWSER_IDLE_TIMEOUT_MS: process.env.AGENT_BROWSER_IDLE_TIMEOUT_MS || '300000',
    };

    const nodeBinDir = dirname(process.execPath);
    if (env.PATH && !env.PATH.includes(nodeBinDir)) {
      env.PATH = `${nodeBinDir}:${env.PATH}`;
    }

    try {
      const { stdout, stderr } = await execFileAsync(this.binaryName, cmdArgs, { timeout, env });
      return this._parseExecOutput(stdout, stderr);
    } catch (error: unknown) {
      return this._parseExecError(error);
    }
  }

  public async open(url: string, session?: string): Promise<BrowserResult> {
    // Domain blacklist check — block known-bad, allow everything else
    try {
      const domain = new URL(url).hostname;
      if (this.blockedDomains.some((blocked) => domain.endsWith(blocked))) {
        return { success: false, error: `Domain ${domain} is blocked by security policy.` };
      }
    } catch {
      return { success: false, error: `Invalid URL: ${url}` };
    }

    return this.exec(['open', url], { session });
  }

  public async snapshot(session?: string, interactiveOnly = true): Promise<SnapshotResult> {
    const args = ['snapshot'];
    if (interactiveOnly) {
      args.push('--interactive');
    }

    const result = await this.exec(args, { session });
    if (!result.success) return result as SnapshotResult;

    const data = result.data as { snapshot?: string; refs?: Record<string, RefInfo> } | undefined;
    return {
      success: true,
      snapshot: data?.snapshot || '',
      refs: data?.refs || {},
    };
  }

  public async click(selector: string, session?: string): Promise<BrowserResult> {
    return this.exec(['click', selector], { session });
  }

  public async fill(selector: string, value: string, session?: string): Promise<BrowserResult> {
    return this.exec(['fill', selector, value], { session });
  }

  public async type(selector: string, text: string, session?: string): Promise<BrowserResult> {
    return this.exec(['type', selector, text], { session });
  }

  public async screenshot(
    session?: string,
    name?: string,
    fullPage?: boolean,
  ): Promise<ScreenshotResult> {
    const fileName = name || `screenshot-${Date.now()}.png`;
    const filePath = resolveWithinRoot(this.screenshotDir, fileName);

    const args = ['screenshot'];
    if (fullPage) {
      args.push('--full');
    }
    args.push(filePath);

    const result = await this.exec(args, { session });
    if (!result.success) return result as ScreenshotResult;

    const data = result.data as { annotatedRefs?: ScreenshotResult['annotatedRefs'] } | undefined;
    return {
      success: true,
      filePath,
      annotatedRefs: data?.annotatedRefs,
    };
  }

  public async getText(selector: string, session?: string): Promise<BrowserResult> {
    return this.exec(['get', 'text', selector], { session });
  }

  public async evaluate(js: string, session?: string): Promise<BrowserResult> {
    return this.exec(['eval', js], { session });
  }

  public async scroll(
    direction: 'up' | 'down' | 'left' | 'right',
    pixels?: number,
    session?: string,
  ): Promise<BrowserResult> {
    const args = ['scroll', direction];
    if (pixels) args.push(pixels.toString());
    return this.exec(args, { session });
  }

  public async wait(
    options: { selector?: string; text?: string; url?: string; timeout?: number },
    session?: string,
  ): Promise<BrowserResult> {
    const args = ['wait'];
    if (options.selector) {
      args.push(options.selector);
    } else if (options.text) {
      args.push('--text', options.text);
    } else if (options.url) {
      args.push('--url', options.url);
    } else if (options.timeout) {
      args.push(options.timeout.toString());
    }

    return this.exec(args, { session });
  }

  public async press(key: string, session?: string): Promise<BrowserResult> {
    return this.exec(['press', key], { session });
  }

  public async back(session?: string): Promise<BrowserResult> {
    return this.exec(['back'], { session });
  }

  public async close(session?: string): Promise<BrowserResult> {
    return this.exec(['close'], { session });
  }

  public async batch(commands: string[][], session?: string): Promise<BrowserResult> {
    // agent-browser batch "open https://..." "click @e1"
    const flattened = commands.map((cmd) => cmd.join(' '));
    return this.exec(['batch', ...flattened], { session, timeout: 120000 }); // 2min for batch
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(this.binaryName, [
        'doctor',
        '--quick',
        '--offline',
        '--json',
      ]);
      const data = JSON.parse(stdout);
      return data.success === true;
    } catch {
      return false;
    }
  }

  public getSessionName(chatId: string): string {
    // Sanitize chatId for session name
    return `hm-${chatId.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20)}`;
  }
}

export const browserService = BrowserService.getInstance();
export default browserService;
