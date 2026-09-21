import { describe, it, expect } from '@jest/globals';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  safeWriteFileSync,
  safeReadFileSync,
  safeExistsSync,
  safeRmSync,
  safeMkdirSync,
} from '../../../utils/safeFs.js';

describe('safeFs wrapper utility', () => {
  it('correctly creates, reads, and deletes files and directories with safeRmSync', () => {
    const testDir = join(tmpdir(), `hive_mind_safefs_test_${Date.now()}`);
    safeMkdirSync(testDir, { recursive: true });
    expect(safeExistsSync(testDir)).toBe(true);

    const testFile = join(testDir, 'test.txt');
    safeWriteFileSync(testFile, 'hello safeFs');
    expect(safeExistsSync(testFile)).toBe(true);
    expect(safeReadFileSync(testFile, 'utf8')).toBe('hello safeFs');

    safeRmSync(testFile);
    expect(safeExistsSync(testFile)).toBe(false);

    safeRmSync(testDir, { recursive: true, force: true });
    expect(safeExistsSync(testDir)).toBe(false);
  });
});
