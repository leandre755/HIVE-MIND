import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { FileStateCache, fileStateCache } from '../../../utils/fileStateCache.js';

describe('FileStateCache', () => {
  const testDir = path.resolve(process.cwd(), 'src/tests/unit/utils/temp_test_state');

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should behave as an LRU cache and evict oldest elements when capacity is exceeded', () => {
    const cache = new FileStateCache(3);

    cache.set('file1.ts', { mtimeMs: 100, contentHash: 'h1', size: 10 });
    cache.set('file2.ts', { mtimeMs: 200, contentHash: 'h2', size: 20 });
    cache.set('file3.ts', { mtimeMs: 300, contentHash: 'h3', size: 30 });

    expect(cache.size).toBe(3);
    expect(cache.has('file1.ts')).toBe(true);

    // Access file1 to make it recently used
    cache.get('file1.ts');

    // Add file4 to trigger eviction
    cache.set('file4.ts', { mtimeMs: 400, contentHash: 'h4', size: 40 });

    // Since file1 was accessed, file2 is now the oldest and should be evicted
    expect(cache.size).toBe(3);
    expect(cache.has('file2.ts')).toBe(false);
    expect(cache.has('file1.ts')).toBe(true);
    expect(cache.has('file3.ts')).toBe(true);
    expect(cache.has('file4.ts')).toBe(true);
  });

  it('should record file state correctly and return it', () => {
    const filePath = path.join(testDir, 'test_record.txt');
    const content = 'hello world';
    fs.writeFileSync(filePath, content, 'utf8');

    const state = fileStateCache.recordFile(filePath, content);

    expect(state).not.toBeNull();
    expect(state?.size).toBe(Buffer.byteLength(content, 'utf8'));
    expect(state?.contentHash).toBeDefined();
    expect(fileStateCache.has(filePath)).toBe(true);

    const fetched = fileStateCache.get(filePath);
    expect(fetched?.mtimeMs).toBe(state?.mtimeMs);
    expect(fetched?.contentHash).toBe(state?.contentHash);
  });

  it('should return null when trying to record state of a non-existent file', () => {
    const state = fileStateCache.recordFile(path.join(testDir, 'non_existent.txt'), 'content');
    expect(state).toBeNull();
  });
});
