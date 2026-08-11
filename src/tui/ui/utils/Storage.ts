import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { safeMkdir } from '../../../utils/safeFs.js';

export class Storage {
  private targetDir: string;
  private data: Map<string, unknown> = new Map();

  constructor(targetDir: string = process.cwd()) {
    this.targetDir = path.resolve(targetDir);
  }

  async initialize(): Promise<void> {
    const tempDir = this.getProjectTempDir();
    const logsDir = this.getProjectTempLogsDir();
    const plansDir = this.getPlansDir();
    await safeMkdir(tempDir, { recursive: true }).catch(() => {});
    await safeMkdir(logsDir, { recursive: true }).catch(() => {});
    await safeMkdir(plansDir, { recursive: true }).catch(() => {});
    await safeMkdir(path.join(tempDir, 'chats'), { recursive: true }).catch(() => {});
  }

  getProjectTempDir(): string {
    const hash = createHash('sha256').update(this.targetDir).digest('hex').substring(0, 12);
    return path.join(homedir(), '.hive-mind', 'temp', hash);
  }

  getProjectTempLogsDir(): string {
    return path.join(this.getProjectTempDir(), 'logs');
  }

  getHistoryFilePath(): string {
    return path.join(this.getProjectTempDir(), 'history.json');
  }

  getPlansDir(): string {
    return path.join(this.getProjectTempDir(), 'plans');
  }

  isWorkspaceHomeDir(): boolean {
    return this.targetDir === homedir();
  }

  static getUserKeybindingsPath(): string {
    return path.join(homedir(), '.hive-mind', 'keybindings.json');
  }

  get(key: string): unknown {
    return this.data.get(key) ?? null;
  }

  set(key: string, value: unknown): void {
    this.data.set(key, value);
  }

  delete(key: string): void {
    this.data.delete(key);
  }
}
