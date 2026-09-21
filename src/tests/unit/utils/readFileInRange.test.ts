import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import * as path from 'path';
import {
  readFileInRange,
  readFileInRangeStreaming,
  FileTooLargeError,
} from '../../../utils/readFileInRange.js';
import {
  safeExistsSync,
  safeMkdirSync,
  safeWriteFileSync,
  safeRmSync,
} from '../../../utils/safeFs.js';

describe('readFileInRange', () => {
  const testDir = path.resolve(process.cwd(), 'src/tests/unit/utils/temp_test_read');

  beforeAll(() => {
    if (!safeExistsSync(testDir)) {
      safeMkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (safeExistsSync(testDir)) {
      safeRmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should throw EISDIR when trying to read a directory', async () => {
    await expect(readFileInRange(testDir)).rejects.toThrow('EISDIR');
  });

  it('should read a small file completely using the Fast Path', async () => {
    const filePath = path.join(testDir, 'small.txt');
    const content = 'line 1\nline 2\r\nline 3\n';
    safeWriteFileSync(filePath, content, 'utf8');

    const result = await readFileInRange(filePath);
    expect(result.content).toBe('line 1\nline 2\nline 3\n');
    expect(result.lineCount).toBe(4);
    expect(result.totalLines).toBe(4);
    expect(result.readBytes).toBe(Buffer.byteLength('line 1\nline 2\nline 3\n', 'utf8'));
  });

  it('should respect offset and limit in Fast Path', async () => {
    const filePath = path.join(testDir, 'fast_range.txt');
    const lines = ['a', 'b', 'c', 'd', 'e'];
    safeWriteFileSync(filePath, lines.join('\n'), 'utf8');

    const result = await readFileInRange(filePath, 1, 3);
    expect(result.content).toBe('b\nc\nd');
    expect(result.lineCount).toBe(3);
    expect(result.totalLines).toBe(5);
  });

  it('should strip UTF-8 BOM in Fast Path', async () => {
    const filePath = path.join(testDir, 'bom.txt');
    const content = '\ufeffbom content';
    safeWriteFileSync(filePath, content, 'utf8');

    const result = await readFileInRange(filePath);
    expect(result.content).toBe('bom content');
  });

  it('should enforce maxBytes size limit in Fast Path', async () => {
    const filePath = path.join(testDir, 'large_fast.txt');
    const content = 'a'.repeat(100);
    safeWriteFileSync(filePath, content, 'utf8');

    await expect(
      readFileInRange(filePath, 0, undefined, 50, undefined, { truncateOnByteLimit: false }),
    ).rejects.toThrow(FileTooLargeError);
  });

  it('should truncate by bytes if truncateOnByteLimit is true in Fast Path', async () => {
    const filePath = path.join(testDir, 'truncate_fast.txt');
    const lines = ['hello', 'world', 'extra'];
    safeWriteFileSync(filePath, lines.join('\n'), 'utf8');

    // 'hello\nworld' is 11 bytes. If we limit to 12 bytes, it should fit 'hello' and 'world', but not 'extra'.
    const result = await readFileInRange(filePath, 0, undefined, 12, undefined, {
      truncateOnByteLimit: true,
    });
    expect(result.content).toBe('hello\nworld');
    expect(result.truncatedByBytes).toBe(true);
  });

  it('should fall back to Streaming Path for large files or read large file sequentially', async () => {
    const filePath = path.join(testDir, 'streaming.txt');
    // Let's create a file with many lines to test the stream processing
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    safeWriteFileSync(filePath, lines.join('\n'), 'utf8');

    // Let's read with offset 1000 and limit 5
    const result = await readFileInRange(filePath, 1000, 5);
    expect(result.content).toBe('line 1000\nline 1001\nline 1002\nline 1003\nline 1004');
    expect(result.lineCount).toBe(5);
    expect(result.totalLines).toBe(5000);
  });

  it('should abort and clean up abort listeners on stream end', async () => {
    const filePath = path.join(testDir, 'streaming_abort.txt');
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    safeWriteFileSync(filePath, lines.join('\n'), 'utf8');

    const ac = new AbortController();
    const result = await readFileInRange(filePath, 1000, 5, undefined, ac.signal);
    // After it completes successfully, the abort listener should be removed.
    expect(result.lineCount).toBe(5);
  });

  it('should reject when signal is already aborted', async () => {
    const filePath = path.join(testDir, 'streaming_abort_2.txt');
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    safeWriteFileSync(filePath, lines.join('\n'), 'utf8');

    const ac = new AbortController();
    const abortReason = new Error('Abort manually');
    ac.abort(abortReason);
    await expect(readFileInRange(filePath, 1000, 5000, undefined, ac.signal)).rejects.toThrow(
      'Abort manually',
    );
    expect(ac.signal.aborted).toBe(true);
  });

  it('should read via readFileInRangeStreaming directly and handle stream completion', async () => {
    const filePath = path.join(testDir, 'streaming_direct.txt');
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    safeWriteFileSync(filePath, lines.join('\n'), 'utf8');

    const result = await readFileInRangeStreaming(filePath, 10, 5, undefined, false);
    expect(result.content).toBe('line 10\nline 11\nline 12\nline 13\nline 14');
    expect(result.lineCount).toBe(5);
  });

  it('should clean up abort listeners on stream end in readFileInRangeStreaming', async () => {
    const filePath = path.join(testDir, 'streaming_direct_signal.txt');
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    safeWriteFileSync(filePath, lines.join('\n'), 'utf8');

    const ac = new AbortController();
    const result = await readFileInRangeStreaming(filePath, 0, 5, undefined, false, ac.signal);
    expect(result.lineCount).toBe(5);
  });

  it('should handle abort signal in readFileInRangeStreaming', async () => {
    const filePath = path.join(testDir, 'streaming_abort_direct.txt');
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i}`);
    safeWriteFileSync(filePath, lines.join('\n'), 'utf8');

    const ac = new AbortController();
    const promise = readFileInRangeStreaming(filePath, 0, 1000, undefined, false, ac.signal);
    ac.abort(new Error('Streaming aborted manually'));
    await expect(promise).rejects.toThrow('Streaming aborted manually');
  });

  it('should reject and clean up signal on stream error in readFileInRangeStreaming', async () => {
    const nonExistentPath = path.join(testDir, 'non_existent_stream_file.txt');
    const ac = new AbortController();
    await expect(
      readFileInRangeStreaming(nonExistentPath, 0, 5, undefined, false, ac.signal),
    ).rejects.toThrow();
  });
});
