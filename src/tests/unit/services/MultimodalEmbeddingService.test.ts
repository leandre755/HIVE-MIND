// tests/unit/services/MultimodalEmbeddingService.test.ts
// Gemini Embedding 2 — multimodal embedding service unit tests
import { describe, it, beforeEach, afterEach, jest, expect } from '@jest/globals';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
// ── Mock fs (selective) ────────────────────────────────────────────────

const actualFs = jest.requireActual<typeof import('node:fs')>('node:fs');
const mockWriteFileSync = jest.fn(actualFs.writeFileSync);
const mockRenameSync = jest.fn(actualFs.renameSync);
const fsMock = {
  ...actualFs,
  writeFileSync: mockWriteFileSync,
  renameSync: mockRenameSync,
};

jest.unstable_mockModule('fs', () => fsMock);
jest.unstable_mockModule('node:fs', () => fsMock);

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
const originalFetch = global.fetch;

// Dynamic import AFTER mock registration
const { safeMkdirSync, safeRemoveDirectorySync, safeExistsSync, safeWriteFileSync } =
  await import('../../../utils/safeFs.js');
const { MultimodalEmbeddingService, detectModality, detectMimeType } =
  await import('../../../services/ai/MultimodalEmbeddingService.js');

// ── Tests ──────────────────────────────────────────────────────────────

const TEST_KEY = 'test-gemini-key-12345';
let testDb = '';

const createTestDb = (): string => join(tmpdir(), `test-mediaDB-${randomUUID()}`);

const makeService = (): InstanceType<typeof MultimodalEmbeddingService> => {
  const svc = new MultimodalEmbeddingService({ geminiKey: TEST_KEY, dbPath: testDb });
  svc.init();
  return svc;
};

const setupDb = (): void => {
  testDb = createTestDb();
  safeMkdirSync(testDb, { recursive: true });
};

const teardownDb = (): void => {
  safeRemoveDirectorySync(testDb);
};

describe('MultimodalEmbeddingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
    setupDb();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    teardownDb();
  });

  // ── detectModality ──

  describe('detectModality', () => {
    it('should detect image modalities', () => {
      expect(detectModality('photo.jpg')).toBe('image');
      expect(detectModality('photo.jpeg')).toBe('image');
      expect(detectModality('image.png')).toBe('image');
      expect(detectModality('anim.gif')).toBe('image');
      expect(detectModality('pic.webp')).toBe('image');
    });

    it('should detect video modalities', () => {
      expect(detectModality('video.mp4')).toBe('video');
      expect(detectModality('clip.mov')).toBe('video');
      expect(detectModality('film.mkv')).toBe('video');
    });

    it('should detect audio modalities', () => {
      expect(detectModality('song.mp3')).toBe('audio');
      expect(detectModality('voice.wav')).toBe('audio');
      expect(detectModality('track.flac')).toBe('audio');
    });

    it('should detect document modalities', () => {
      expect(detectModality('report.pdf')).toBe('document');
    });

    it('should default to text for unknown extensions', () => {
      expect(detectModality('readme.md')).toBe('text');
      expect(detectModality('data.csv')).toBe('text');
    });
  });

  // ── detectMimeType ──

  describe('detectMimeType', () => {
    it('should return correct MIME types', () => {
      expect(detectMimeType('photo.jpg')).toBe('image/jpeg');
      expect(detectMimeType('video.mp4')).toBe('video/mp4');
      expect(detectMimeType('song.mp3')).toBe('audio/mpeg');
      expect(detectMimeType('doc.pdf')).toBe('application/pdf');
    });

    it('should return fallback for unknown', () => {
      expect(detectMimeType('file.xyz')).toBe('application/octet-stream');
    });
  });

  // ── Constructor + init ──

  describe('constructor + init', () => {
    it('should create instance and init with empty DB', () => {
      const svc = makeService();
      expect(svc.getEntryCount()).toBe(0);
      expect(safeExistsSync(join(testDb, 'media_embeddings.json'))).toBe(false);
    });

    it('should load existing entries on init', () => {
      const indexData = {
        version: 1,
        dimensions: 3072,
        entries: [
          {
            id: 'e1',
            contextId: 'c1',
            filePath: '/x.jpg',
            fileName: 'x.jpg',
            modality: 'image',
            mimeType: 'image/jpeg',
            fileSize: 200,
            contentSummary: 'pic',
            metadata: {},
            createdAt: '2026-01-01',
          },
          {
            id: 'e2',
            contextId: 'c1',
            filePath: '/y.mp4',
            fileName: 'y.mp4',
            modality: 'video',
            mimeType: 'video/mp4',
            fileSize: 5000,
            contentSummary: null,
            metadata: {},
            createdAt: '2026-01-02',
          },
        ],
      };
      safeWriteFileSync(join(testDb, 'media_embeddings.json'), JSON.stringify(indexData));

      const svc = makeService();
      expect(svc.getEntryCount()).toBe(2);
      expect(svc.getEntry('e1')?.modality).toBe('image');
      expect(svc.getEntry('e2')?.modality).toBe('video');
    });
  });

  // ── embedText ──

  describe('embedText', () => {
    it('should return null for empty text', async () => {
      const svc = makeService();
      expect(await svc.embedText('')).toBeNull();
      expect(await svc.embedText('   ')).toBeNull();
    });

    it('should call Gemini Embedding 2 API and return vector', async () => {
      const fakeVector = Array.from({ length: 3072 }, () => 0.5);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: { values: fakeVector } }),
      } as Response);

      const svc = makeService();

      const result = await svc.embedText('hello world');
      expect(result).toEqual(fakeVector);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('gemini-embedding-2');
      expect(url).toContain(TEST_KEY);
      expect(opts?.method).toBe('POST');

      const body = JSON.parse(opts?.body as string);
      expect(body.content.parts[0].text).toBe('hello world');
      expect(body.outputDimensionality).toBe(3072);
    });

    it('should return null on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'quota exceeded' } }),
      } as Response);

      const svc = makeService();

      expect(await svc.embedText('test')).toBeNull();
    });

    it('should return null on network error', async () => {
      mockFetch.mockRejectedValue(new Error('network fail'));

      const svc = makeService();

      expect(await svc.embedText('test')).toBeNull();
    });

    it('should return null without API key', async () => {
      const svc = new MultimodalEmbeddingService({ geminiKey: '', dbPath: testDb });
      svc.init();
      expect(await svc.embedText('test')).toBeNull();
    });
  });
});

describe('MultimodalEmbeddingService entries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
    setupDb();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    teardownDb();
  });

  // ── addEntry ──

  describe('addEntry', () => {
    it('should add entry with vector', () => {
      const svc = makeService();

      const id = svc.addEntry(
        {
          contextId: 'ctx1',
          filePath: '/test/photo.jpg',
          fileName: 'photo.jpg',
          modality: 'image',
          mimeType: 'image/jpeg',
          fileSize: 5000,
          contentSummary: 'A test photo',
          metadata: { width: 1920 },
        },
        Array.from({ length: 3072 }, () => 0.1),
      );

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(svc.getEntryCount()).toBe(1);

      const entry = svc.getEntry(id);
      expect(entry?.fileName).toBe('photo.jpg');
      expect(entry?.modality).toBe('image');
      expect(entry?.metadata).toEqual({ width: 1920 });
    });

    it('should assign unique ids', () => {
      const svc = makeService();

      const id1 = svc.addEntry(
        {
          contextId: 'c',
          filePath: '/a.jpg',
          fileName: 'a.jpg',
          modality: 'image',
          mimeType: 'image/jpeg',
          fileSize: 100,
          contentSummary: null,
          metadata: {},
        },
        Array.from({ length: 3072 }, () => 0),
      );

      const id2 = svc.addEntry(
        {
          contextId: 'c',
          filePath: '/b.jpg',
          fileName: 'b.jpg',
          modality: 'image',
          mimeType: 'image/jpeg',
          fileSize: 100,
          contentSummary: null,
          metadata: {},
        },
        Array.from({ length: 3072 }, () => 0),
      );

      expect(id1).not.toBe(id2);
    });
  });

  // ── removeEntry ──

  describe('removeEntry', () => {
    it('should remove entry by id', () => {
      const svc = makeService();

      const id = svc.addEntry(
        {
          contextId: 'ctx1',
          filePath: '/a.jpg',
          fileName: 'a.jpg',
          modality: 'image',
          mimeType: 'image/jpeg',
          fileSize: 100,
          contentSummary: null,
          metadata: {},
        },
        Array.from({ length: 3072 }, () => 0),
      );

      expect(svc.getEntryCount()).toBe(1);
      expect(svc.removeEntry(id)).toBe(true);
      expect(svc.getEntryCount()).toBe(0);
      expect(svc.getEntry(id)).toBeUndefined();
    });

    it('should return false for nonexistent id', () => {
      const svc = makeService();
      expect(svc.removeEntry('nonexistent')).toBe(false);
    });
  });

  // ── getContextEntries ──

  describe('getContextEntries', () => {
    it('should filter by contextId', () => {
      const svc = makeService();

      svc.addEntry(
        {
          contextId: 'c1',
          filePath: '/a.jpg',
          fileName: 'a.jpg',
          modality: 'image',
          mimeType: 'image/jpeg',
          fileSize: 100,
          contentSummary: null,
          metadata: {},
        },
        Array.from({ length: 3072 }, () => 0),
      );
      svc.addEntry(
        {
          contextId: 'c2',
          filePath: '/b.jpg',
          fileName: 'b.jpg',
          modality: 'image',
          mimeType: 'image/jpeg',
          fileSize: 100,
          contentSummary: null,
          metadata: {},
        },
        Array.from({ length: 3072 }, () => 0),
      );
      svc.addEntry(
        {
          contextId: 'c1',
          filePath: '/c.mp4',
          fileName: 'c.mp4',
          modality: 'video',
          mimeType: 'video/mp4',
          fileSize: 200,
          contentSummary: null,
          metadata: {},
        },
        Array.from({ length: 3072 }, () => 0),
      );

      const c1 = svc.getContextEntries('c1');
      expect(c1).toHaveLength(2);
      expect(c1.every((e: { contextId: string }) => e.contextId === 'c1')).toBe(true);
    });
  });

  // ── save (atomic write) ──

  describe('save', () => {
    it('should write JSON atomically (tmp + rename)', () => {
      const svc = makeService();

      svc.addEntry(
        {
          contextId: 'ctx1',
          filePath: '/a.jpg',
          fileName: 'a.jpg',
          modality: 'image',
          mimeType: 'image/jpeg',
          fileSize: 100,
          contentSummary: null,
          metadata: {},
        },
        Array.from({ length: 3072 }, () => 0),
      );

      mockWriteFileSync.mockClear();
      mockRenameSync.mockClear();

      svc.save();

      expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
      expect(mockRenameSync).toHaveBeenCalledTimes(1);

      const [tmpPath] = mockRenameSync.mock.calls[0] as [string, string];
      expect(tmpPath).toMatch(/\.tmp$/);
    });
  });
});
