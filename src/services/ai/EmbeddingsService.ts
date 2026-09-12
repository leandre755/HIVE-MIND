/**
 * services/ai/EmbeddingsService.ts
 * Generates vector embeddings using Gemini or OpenAI fallback.
 */

export interface EmbeddingConfig {
  geminiKey?: string;
  openaiKey?: string;
  model?: string;
  dimensions?: number;
}

export interface IEmbeddingsService {
  embed(text: string): Promise<number[] | null>;
}

export class EmbeddingsService implements IEmbeddingsService {
  private readonly config: EmbeddingConfig;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(config: EmbeddingConfig) {
    this.config = config;
    this.model = config.model || 'gemini-embedding-001';
    this.dimensions = config.dimensions || 1024;
  }

  /**
   * Generates a vector for the given text.
   * @param text The text to embed.
   * @returns A promise resolving to a number array (vector) or null.
   */
  async embed(text: string): Promise<number[] | null> {
    if (!text || !text.trim()) return null;

    // Cleaning: replace newlines with spaces (recommended for RAG)
    const cleanText = text.replace(/\n/g, ' ');

    try {
      let vector: number[] | null = null;
      try {
        vector = await this._embedWithGemini(cleanText);
      } catch {
        console.warn('[Embeddings] Gemini provider failed, attempting OpenAI fallback');
      }
      if (vector) return vector;

      return await this._embedWithOpenAI(cleanText);
    } catch {
      console.error('[Embeddings] Fatal error during embedding generation');
      return null;
    }
  }

  private async _embedWithGemini(text: string): Promise<number[] | null> {
    const apiKey = this.config.geminiKey;
    if (!apiKey) throw new Error('Gemini API key missing');

    console.log(`[Embeddings] Using Model: ${this.model}, Dims: ${this.dimensions}`);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
        outputDimensionality: this.dimensions,
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API Error (${response.status})`);
    }

    const data = await response.json();
    const values: unknown = data.embedding?.values;
    if (
      !Array.isArray(values) ||
      values.length !== this.dimensions ||
      !values.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      return null;
    }
    return values;
  }

  private async _embedWithOpenAI(text: string): Promise<number[] | null> {
    const apiKey = this.config.openaiKey;
    if (!apiKey) {
      console.warn('[Embeddings] OpenAI API key missing, skipping fallback');
      return null;
    }

    const url = 'https://api.openai.com/v1/embeddings';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: this.dimensions,
        encoding_format: 'float',
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API Error (${response.status})`);
    }

    const data = await response.json();
    const embedding: unknown = data?.data?.[0]?.embedding;
    if (
      !Array.isArray(embedding) ||
      embedding.length !== this.dimensions ||
      !embedding.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      return null;
    }
    return embedding;
  }
}
