// src/utils/readFileInRange.ts

import { createReadStream, fstat } from 'fs';
import { safeStat, safeReadFile, safeCreateReadStream } from './safeFs.js';

const FAST_PATH_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export interface ReadFileRangeResult {
  content: string;
  lineCount: number;
  totalLines: number;
  totalBytes: number;
  readBytes: number;
  mtimeMs: number;
  truncatedByBytes?: boolean;
}

export class FileTooLargeError extends Error {
  constructor(
    public sizeInBytes: number,
    public maxSizeBytes: number,
  ) {
    super(
      `File content (${(sizeInBytes / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed size (${(maxSizeBytes / 1024 / 1024).toFixed(2)} MB). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.`,
    );
    this.name = 'FileTooLargeError';
  }
}

/**
 * Line-oriented file reader with two optimized code paths:
 * 1. Fast path (files < 10MB): reads whole file then splits in memory using indexOf('\n').
 * 2. Streaming path (large files): createReadStream with line scanning, only accumulating lines in range.
 */
export async function readFileInRange(
  filePath: string,
  offset = 0,
  maxLines?: number,
  maxBytes?: number,
  signal?: AbortSignal,
  options?: { truncateOnByteLimit?: boolean },
): Promise<ReadFileRangeResult> {
  signal?.throwIfAborted();
  const truncateOnByteLimit = options?.truncateOnByteLimit ?? false;

  const stats = await safeStat(filePath);

  if (stats.isDirectory()) {
    throw new Error(`EISDIR: illegal operation on a directory, read '${filePath}'`);
  }

  if (stats.isFile() && stats.size < FAST_PATH_MAX_SIZE) {
    if (!truncateOnByteLimit && maxBytes !== undefined && stats.size > maxBytes) {
      throw new FileTooLargeError(stats.size, maxBytes);
    }

    const text = await safeReadFile(filePath);
    return readFileInRangeFast(
      text,
      stats.mtimeMs,
      offset,
      maxLines,
      truncateOnByteLimit ? maxBytes : undefined,
    );
  }

  return readFileInRangeStreaming(
    filePath,
    offset,
    maxLines,
    maxBytes,
    truncateOnByteLimit,
    signal,
  );
}

function readFileInRangeFast(
  raw: string,
  mtimeMs: number,
  offset: number,
  maxLines: number | undefined,
  truncateAtBytes: number | undefined,
): ReadFileRangeResult {
  const endLine = maxLines !== undefined ? offset + maxLines : Infinity;

  // Strip UTF-8 BOM if present
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  const selectedLines: string[] = [];
  let lineIndex = 0;
  let startPos = 0;
  let newlinePos: number;
  let selectedBytes = 0;
  let truncatedByBytes = false;

  function tryPush(line: string): boolean {
    if (truncateAtBytes !== undefined) {
      const sep = selectedLines.length > 0 ? 1 : 0;
      const nextBytes = selectedBytes + sep + Buffer.byteLength(line, 'utf8');
      if (nextBytes > truncateAtBytes) {
        truncatedByBytes = true;
        return false;
      }
      selectedBytes = nextBytes;
    }
    selectedLines.push(line);
    return true;
  }

  while ((newlinePos = text.indexOf('\n', startPos)) !== -1) {
    if (lineIndex >= offset && lineIndex < endLine && !truncatedByBytes) {
      let line = text.slice(startPos, newlinePos);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      tryPush(line);
    }
    lineIndex++;
    startPos = newlinePos + 1;
  }

  // Final fragment
  if (lineIndex >= offset && lineIndex < endLine && !truncatedByBytes) {
    let line = text.slice(startPos);
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }
    tryPush(line);
  }
  lineIndex++;

  const content = selectedLines.join('\n');
  return {
    content,
    lineCount: selectedLines.length,
    totalLines: lineIndex,
    totalBytes: Buffer.byteLength(text, 'utf8'),
    readBytes: Buffer.byteLength(content, 'utf8'),
    mtimeMs,
    ...(truncatedByBytes ? { truncatedByBytes: true } : {}),
  };
}

interface StreamState {
  stream: ReturnType<typeof createReadStream>;
  offset: number;
  endLine: number;
  maxBytes: number | undefined;
  truncateOnByteLimit: boolean;
  resolve: (value: ReadFileRangeResult) => void;
  reject: (err: unknown) => void;
  totalBytesRead: number;
  selectedBytes: number;
  truncatedByBytes: boolean;
  currentLineIndex: number;
  selectedLines: string[];
  partial: string;
  isFirstChunk: boolean;
  resolveMtime: (ms: number) => void;
  mtimeReady: Promise<number>;
}

function streamOnOpen(this: StreamState, fd: number): void {
  fstat(fd, (err, stats) => {
    this.resolveMtime(err ? 0 : stats.mtimeMs);
  });
}

function pushStreamLine(state: StreamState, line: string): void {
  if (state.truncateOnByteLimit && state.maxBytes !== undefined) {
    const sep = state.selectedLines.length > 0 ? 1 : 0;
    const nextBytes = state.selectedBytes + sep + Buffer.byteLength(line, 'utf8');
    if (nextBytes > state.maxBytes) {
      state.truncatedByBytes = true;
      state.endLine = state.currentLineIndex;
    } else {
      state.selectedBytes = nextBytes;
      state.selectedLines.push(line);
    }
  } else {
    state.selectedLines.push(line);
  }
}

function processStreamLines(state: StreamState, data: string): string {
  let startPos = 0;
  let newlinePos: number;
  while ((newlinePos = data.indexOf('\n', startPos)) !== -1) {
    if (state.currentLineIndex >= state.offset && state.currentLineIndex < state.endLine) {
      let line = data.slice(startPos, newlinePos);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      pushStreamLine(state, line);
    }
    state.currentLineIndex++;
    startPos = newlinePos + 1;
  }
  return data.slice(startPos);
}

function processTrailingFragment(state: StreamState, fragment: string): void {
  if (fragment.length === 0) return;
  if (state.currentLineIndex >= state.offset && state.currentLineIndex < state.endLine) {
    if (state.truncateOnByteLimit && state.maxBytes !== undefined) {
      const sep = state.selectedLines.length > 0 ? 1 : 0;
      const fragBytes = state.selectedBytes + sep + Buffer.byteLength(fragment, 'utf8');
      if (fragBytes > state.maxBytes) {
        state.truncatedByBytes = true;
        state.endLine = state.currentLineIndex;
        return;
      }
    }
    state.partial = fragment;
  }
}

function streamOnData(this: StreamState, chunk: string): void {
  let cleanChunk = chunk;
  if (this.isFirstChunk) {
    this.isFirstChunk = false;
    if (cleanChunk.charCodeAt(0) === 0xfeff) {
      cleanChunk = cleanChunk.slice(1);
    }
  }

  this.totalBytesRead += Buffer.byteLength(cleanChunk, 'utf8');
  if (
    !this.truncateOnByteLimit &&
    this.maxBytes !== undefined &&
    this.totalBytesRead > this.maxBytes
  ) {
    this.stream.destroy(new FileTooLargeError(this.totalBytesRead, this.maxBytes));
    return;
  }

  const data = this.partial.length > 0 ? this.partial + cleanChunk : cleanChunk;
  this.partial = '';

  const fragment = processStreamLines(this, data);
  processTrailingFragment(this, fragment);
}

function streamOnEnd(this: StreamState): void {
  let line = this.partial;
  if (line.endsWith('\r')) {
    line = line.slice(0, -1);
  }
  if (this.currentLineIndex >= this.offset && this.currentLineIndex < this.endLine) {
    if (this.truncateOnByteLimit && this.maxBytes !== undefined) {
      const sep = this.selectedLines.length > 0 ? 1 : 0;
      const nextBytes = this.selectedBytes + sep + Buffer.byteLength(line, 'utf8');
      if (nextBytes > this.maxBytes) {
        this.truncatedByBytes = true;
      } else {
        this.selectedLines.push(line);
      }
    } else {
      this.selectedLines.push(line);
    }
  }
  this.currentLineIndex++;

  const content = this.selectedLines.join('\n');
  const truncated = this.truncatedByBytes;
  this.mtimeReady.then((mtimeMs) => {
    this.resolve({
      content,
      lineCount: this.selectedLines.length,
      totalLines: this.currentLineIndex,
      totalBytes: this.totalBytesRead,
      readBytes: Buffer.byteLength(content, 'utf8'),
      mtimeMs,
      ...(truncated ? { truncatedByBytes: true } : {}),
    });
  });
}

function readFileInRangeStreaming(
  filePath: string,
  offset: number,
  maxLines: number | undefined,
  maxBytes: number | undefined,
  truncateOnByteLimit: boolean,
  signal?: AbortSignal,
): Promise<ReadFileRangeResult> {
  return new Promise((resolve, reject) => {
    let resolveMtimeCall!: (ms: number) => void;
    const mtimeReady = new Promise<number>((r) => {
      resolveMtimeCall = r;
    });

    const stream = safeCreateReadStream(filePath, {
      encoding: 'utf8',
      highWaterMark: 512 * 1024,
      ...(signal ? { signal } : undefined),
    });

    const state: StreamState = {
      stream,
      offset,
      endLine: maxLines !== undefined ? offset + maxLines : Infinity,
      maxBytes,
      truncateOnByteLimit,
      resolve,
      reject,
      totalBytesRead: 0,
      selectedBytes: 0,
      truncatedByBytes: false,
      currentLineIndex: 0,
      selectedLines: [],
      partial: '',
      isFirstChunk: true,
      resolveMtime: resolveMtimeCall,
      mtimeReady,
    };

    stream.once('open', streamOnOpen.bind(state));
    stream.on('data', streamOnData.bind(state));
    stream.once('end', streamOnEnd.bind(state));
    stream.once('error', (err) => {
      reject(err);
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        stream.destroy();
        reject(signal.reason || new Error('Aborted'));
      });
    }
  });
}
