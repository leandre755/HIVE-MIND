/**
 * services/media/MediaSearch.ts
 * Cross-modal search over the local /mediaDB/ index.
 * Accepts text, image, or file queries → returns ranked media entries.
 */

import {
  MultimodalEmbeddingService,
  type MediaSearchResult,
} from '../ai/MultimodalEmbeddingService.js';

export type { MediaSearchResult };

// ─── MediaSearch ────────────────────────────────────────────────────────

export class MediaSearch {
  private readonly embeddingService: MultimodalEmbeddingService;

  constructor(embeddingService: MultimodalEmbeddingService) {
    this.embeddingService = embeddingService;
  }

  /**
   * Search media by text query (text → image, text → video, etc.).
   */
  async searchByText(
    contextId: string,
    query: string,
    limit = 10,
    threshold = 0.5,
  ): Promise<MediaSearchResult[]> {
    if (!query || !query.trim()) return [];

    const embedding = await this.embeddingService.embedText(query);
    if (!embedding) return [];

    return this.embeddingService.search(embedding, contextId, limit, threshold);
  }

  /**
   * Search media by image query (image → similar images).
   */
  async searchByImage(
    contextId: string,
    imagePath: string,
    limit = 10,
    threshold = 0.5,
  ): Promise<MediaSearchResult[]> {
    const embedding = await this.embeddingService.embedImage(imagePath);
    if (!embedding) return [];

    return this.embeddingService.search(embedding, contextId, limit, threshold);
  }

  /**
   * Search media by any file (video, audio, document → similar entries).
   */
  async searchByFile(
    contextId: string,
    filePath: string,
    limit = 10,
    threshold = 0.5,
  ): Promise<MediaSearchResult[]> {
    const { detectModality } = await import('../ai/MultimodalEmbeddingService.js');
    const modality = detectModality(filePath);

    let embedding: number[] | null;
    switch (modality) {
      case 'image':
        embedding = await this.embeddingService.embedImage(filePath);
        break;
      case 'video':
        embedding = await this.embeddingService.embedVideo(filePath);
        break;
      case 'audio':
        embedding = await this.embeddingService.embedAudio(filePath);
        break;
      case 'document':
        embedding = await this.embeddingService.embedDocument(filePath);
        break;
      default:
        return [];
    }

    if (!embedding) return [];
    return this.embeddingService.search(embedding, contextId, limit, threshold);
  }
}
