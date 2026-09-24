// tests/unit/utils/pidLock.test.ts
import { describe, it, beforeAll, afterAll, expect } from '@jest/globals';
import path from 'node:path';
import { acquireLock, releaseLock, isLocked } from '../../../utils/pidLock.js';
import {
  safeExistsSync,
  safeReadFileSync,
  safeUnlinkSync,
  safeWriteFileSync,
} from '../../../utils/safeFs.js';

const PID_FILE = path.join(process.cwd(), '.hive-mind.pid');

describe('pidLock.ts unit tests', () => {
  beforeAll(() => {
    if (safeExistsSync(PID_FILE)) {
      safeUnlinkSync(PID_FILE);
    }
  });

  afterAll(() => {
    if (safeExistsSync(PID_FILE)) {
      safeUnlinkSync(PID_FILE);
    }
  });

  it('should acquire lock when no lock exists', () => {
    acquireLock();
    expect(safeExistsSync(PID_FILE)).toBe(true);
    expect(parseInt(safeReadFileSync(PID_FILE))).toBe(process.pid);
  });

  it('isLocked should return true if locked', () => {
    expect(isLocked()).toBe(true);
  });

  it('releaseLock should remove the pid file if it belongs to current process', () => {
    releaseLock();
    expect(safeExistsSync(PID_FILE)).toBe(false);
  });

  it('isLocked should return false if not locked', () => {
    expect(isLocked()).toBe(false);
  });

  it('acquireLock should handle stale pid files', () => {
    // Create a fake stale PID file with a very high PID that is unlikely to exist
    const stalePid = '999999';
    safeWriteFileSync(PID_FILE, stalePid);

    // Should detect stale PID and overwrite
    acquireLock();
    expect(parseInt(safeReadFileSync(PID_FILE))).toBe(process.pid);
    releaseLock();
  });
});
