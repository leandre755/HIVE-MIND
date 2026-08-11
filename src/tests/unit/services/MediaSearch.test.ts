// tests/unit/services/MediaSearch.test.ts
import { describe, it, beforeEach, afterEach, jest, expect } from '@jest/globals';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  safeMkdirSync,
  safeRemoveDirectorySync,
  safeWriteFileSync,
} from '../../../utils/safeFs.js';
import { MultimodalEmbeddingService } from '../../../services/ai/MultimodalEmbeddingService.js';
import { MediaSearch } from '../../../services/media/MediaSearch.js';

// ── Mock fetch ──────────────────────────────────────────────────────────

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
const originalFetch = global.fetch;

const FAKE_VECTOR_A = Array.from({ length: 3072 }, () => 0.8);
const FAKE_VECTOR_B = Array.from({ length: 3072 }, () => 0.2);

// ── Tests ──────────────────────────────────────────────────────────────

describe('MediaSearch', () => {
  const TEST_KEY = 'test-gemini-key';
  let testDb = '';

  let embeddingService: MultimodalEmbeddingService;
  let search: MediaSearch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
    testDb = join(tmpdir(), `test-mediasearch-${randomUUID()}`);
    safeMkdirSync(testDb, { recursive: true });
    embeddingService = new MultimodalEmbeddingService({ geminiKey: TEST_KEY, dbPath: testDb });
    embeddingService.init();
    search = new MediaSearch(embeddingService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    safeRemoveDirectorySync(testDb);
  });

  // ── searchByText ──

  describe('searchByText', () => {
    it('should return matching entries for a text query', async () => {
      // Seed index with 2 entries
      embeddingService.addEntry(
        {
          contextId: 'c1',
          filePath: '/a.jpg',
          fileName: 'a.jpg',
          modality: 'image',
          mimeType: 'image/jpeg',
          fileSize: 100,
          contentSummary: 'A',
          metadata: {},
        },
        FAKE_VECTOR_A,
      );
      embeddingService.addEntry(
        {
          contextId: 'c1',
          filePath: '/b.jpg',
          fileName: 'b.jpg',
          modality: 'image',
          mimeType: 'image/jpeg',
          fileSize: 200,
          contentSummary: 'B',
          metadata: {},
        },
        FAKE_VECTOR_B,
      );

      // Mock embedText to return a vector close to FAKE_VECTOR_A
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: { values: FAKE_VECTOR_A } }),
      } as Response);

      const results = await search.searchByText('c1', 'find photos');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].fileName).toBe('a.jpg');
    });

    it('should return empty for empty query', async () => {
      const results = await search.searchByText('c1', '');
      expect(results).toEqual([]);
    });

    it('should return empty when no entries exist', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: { values: FAKE_VECTOR_A } }),
      } as Response);

      const results = await search.searchByText('c1', 'query');
      expect(results).toEqual([]);
    });

    it('should respect contextId filter', async () => {
      embeddingService.addEntry(
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
        FAKE_VECTOR_A,
      );
      embeddingService.addEntry(
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
        FAKE_VECTOR_A,
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: { values: FAKE_VECTOR_A } }),
      } as Response);

      const results = await search.searchByText('c1', 'query');
      expect(results).toHaveLength(1);
      expect(results[0].filePath).toBe('/a.jpg');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        embeddingService.addEntry(
          {
            contextId: 'c1',
            filePath: `/${i}.jpg`,
            fileName: `${i}.jpg`,
            modality: 'image',
            mimeType: 'image/jpeg',
            fileSize: 100,
            contentSummary: null,
            metadata: {},
          },
          FAKE_VECTOR_A,
        );
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: { values: FAKE_VECTOR_A } }),
      } as Response);

      const results = await search.searchByText('c1', 'query', 3);
      expect(results).toHaveLength(3);
    });
  });

  // ── searchByImage ──

  describe('searchByImage', () => {
    it('should search by image embedding', async () => {
      embeddingService.addEntry(
        {
          contextId: 'c1',
          filePath: '/target.jpg',
          fileName: 'target.jpg',
          modality: 'image',
          mimeType: 'image/jpeg',
          fileSize: 100,
          contentSummary: null,
          metadata: {},
        },
        FAKE_VECTOR_A,
      );

      const queryImg = join(testDb, 'query.jpg');
      safeWriteFileSync(queryImg, Buffer.from([0xff, 0xd8]));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: { values: FAKE_VECTOR_A } }),
      } as Response);

      const results = await search.searchByImage('c1', queryImg);
      expect(results).toHaveLength(1);
      expect(results[0].fileName).toBe('target.jpg');
    });
  });

  // ── searchByFile ──

  describe('searchByFile', () => {
    it('should search by video file', async () => {
      embeddingService.addEntry(
        {
          contextId: 'c1',
          filePath: '/match.mp4',
          fileName: 'match.mp4',
          modality: 'video',
          mimeType: 'video/mp4',
          fileSize: 100,
          contentSummary: null,
          metadata: {},
        },
        FAKE_VECTOR_A,
      );

      const queryVid = join(testDb, 'query.mp4');
      safeWriteFileSync(queryVid, Buffer.from([0x00]));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: { values: FAKE_VECTOR_A } }),
      } as Response);

      const results = await search.searchByFile('c1', queryVid);
      expect(results).toHaveLength(1);
      expect(results[0].modality).toBe('video');
    });

    it('should return empty for text files', async () => {
      const results = await search.searchByFile('c1', '/file.md');
      expect(results).toEqual([]);
    });
  });
});
