// tests/unit/utils/pidLock.test.ts
import { describe, it, beforeAll, afterAll, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { acquireLock, releaseLock, isLocked } from '../../../utils/pidLock.js';

const PID_FILE = path.join(process.cwd(), '.hive-mind.pid');

describe('pidLock.ts unit tests', () => {
  beforeAll(() => {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  });

  afterAll(() => {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  });

  it('should acquire lock when no lock exists', () => {
    acquireLock();
    expect(fs.existsSync(PID_FILE)).toBe(true);
    expect(parseInt(fs.readFileSync(PID_FILE, 'utf8'))).toBe(process.pid);
  });

  it('isLocked should return true if locked', () => {
    expect(isLocked()).toBe(true);
  });

  it('releaseLock should remove the pid file if it belongs to current process', () => {
    releaseLock();
    expect(fs.existsSync(PID_FILE)).toBe(false);
  });

  it('isLocked should return false if not locked', () => {
    expect(isLocked()).toBe(false);
  });

  it('acquireLock should handle stale pid files', () => {
    // Create a fake stale PID file with a very high PID that is unlikely to exist
    const stalePid = '999999';
    fs.writeFileSync(PID_FILE, stalePid);

    // Should detect stale PID and overwrite
    acquireLock();
    expect(parseInt(fs.readFileSync(PID_FILE, 'utf8'))).toBe(process.pid);
    releaseLock();
  });
});
