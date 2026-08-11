import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { readFileInRange, FileTooLargeError } from '../../../utils/readFileInRange.js';

describe('readFileInRange', () => {
  const testDir = path.resolve(process.cwd(), 'src/tests/unit/utils/temp_test_read');

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

  it('should throw EISDIR when trying to read a directory', async () => {
    await expect(readFileInRange(testDir)).rejects.toThrow('EISDIR');
  });

  it('should read a small file completely using the Fast Path', async () => {
    const filePath = path.join(testDir, 'small.txt');
    const content = 'line 1\nline 2\r\nline 3\n';
    fs.writeFileSync(filePath, content, 'utf8');

    const result = await readFileInRange(filePath);
    expect(result.content).toBe('line 1\nline 2\nline 3\n');
    expect(result.lineCount).toBe(4);
    expect(result.totalLines).toBe(4);
    expect(result.readBytes).toBe(Buffer.byteLength('line 1\nline 2\nline 3\n', 'utf8'));
  });

  it('should respect offset and limit in Fast Path', async () => {
    const filePath = path.join(testDir, 'fast_range.txt');
    const lines = ['a', 'b', 'c', 'd', 'e'];
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

    const result = await readFileInRange(filePath, 1, 3);
    expect(result.content).toBe('b\nc\nd');
    expect(result.lineCount).toBe(3);
    expect(result.totalLines).toBe(5);
  });

  it('should strip UTF-8 BOM in Fast Path', async () => {
    const filePath = path.join(testDir, 'bom.txt');
    const content = '\ufeffbom content';
    fs.writeFileSync(filePath, content, 'utf8');

    const result = await readFileInRange(filePath);
    expect(result.content).toBe('bom content');
  });

  it('should enforce maxBytes size limit in Fast Path', async () => {
    const filePath = path.join(testDir, 'large_fast.txt');
    const content = 'a'.repeat(100);
    fs.writeFileSync(filePath, content, 'utf8');

    await expect(
      readFileInRange(filePath, 0, undefined, 50, undefined, { truncateOnByteLimit: false }),
    ).rejects.toThrow(FileTooLargeError);
  });

  it('should truncate by bytes if truncateOnByteLimit is true in Fast Path', async () => {
    const filePath = path.join(testDir, 'truncate_fast.txt');
    const lines = ['hello', 'world', 'extra'];
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

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
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

    // Let's read with offset 1000 and limit 5
    const result = await readFileInRange(filePath, 1000, 5);
    expect(result.content).toBe('line 1000\nline 1001\nline 1002\nline 1003\nline 1004');
    expect(result.lineCount).toBe(5);
    expect(result.totalLines).toBe(5000);
  });
});
