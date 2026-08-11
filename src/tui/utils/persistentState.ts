import { debugLogger } from './errors.js';
import * as path from 'node:path';
import { homedir } from 'node:os';
import {
  safeExistsSync,
  safeReadFileSync,
  safeMkdirSync,
  safeWriteFileSync,
} from '../../utils/safeFs.js';

const STATE_FILENAME = 'state.json';

interface PersistentStateData {
  defaultBannerShownCount?: Record<string, number>;
  terminalSetupPromptShown?: boolean;
  tipsShown?: number;
  hasSeenScreenReaderNudge?: boolean;
  focusUiEnabled?: boolean;
  startupWarningCounts?: Record<string, number>;
  // Add other persistent state keys here as needed
}

export class PersistentState {
  private cache: PersistentStateData | null = null;
  private filePath: string | null = null;

  private getPath(): string {
    if (!this.filePath) {
      this.filePath = path.join(homedir(), '.hivemind', STATE_FILENAME);
    }
    return this.filePath;
  }

  private load(): PersistentStateData {
    if (this.cache) {
      return this.cache;
    }
    try {
      const filePath = this.getPath();
      if (safeExistsSync(filePath)) {
        const content = safeReadFileSync(filePath);

        this.cache = JSON.parse(content);
      } else {
        this.cache = {};
      }
    } catch (error) {
      debugLogger.warn('Failed to load persistent state:', error);
      // If error reading (e.g. corrupt JSON), start fresh
      this.cache = {};
    }
    return this.cache!;
  }

  private save() {
    if (!this.cache) return;
    try {
      const filePath = this.getPath();
      const dir = path.dirname(filePath);
      if (!safeExistsSync(dir)) {
        safeMkdirSync(dir);
      }
      safeWriteFileSync(filePath, JSON.stringify(this.cache, null, 2));
    } catch (error) {
      debugLogger.warn('Failed to save persistent state:', error);
    }
  }

  get<K extends keyof PersistentStateData>(key: K): PersistentStateData[K] | undefined {
    const data = this.load();
    const entry = new Map<string, PersistentStateData[K]>(Object.entries(data)).get(
      key as string,
    ) as PersistentStateData[K] | undefined;
    return entry;
  }

  set<K extends keyof PersistentStateData>(key: K, value: PersistentStateData[K]): void {
    this.load(); // ensure loaded
    const dataMap = new Map<string, PersistentStateData[K]>(Object.entries(this.cache ?? {}));
    dataMap.set(key as string, value);
    this.cache = Object.fromEntries(dataMap) as PersistentStateData;
    this.save();
  }
}

export const persistentState = new PersistentState();
