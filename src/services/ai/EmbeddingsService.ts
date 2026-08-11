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
      // Strategy: Try Gemini first (Cheaper / Better context)
      const vector = await this._embedWithGemini(cleanText);
      if (vector) return vector;

      // Fallback
      console.warn('[Embeddings] Gemini failed, attempting OpenAI fallback...');
      return await this._embedWithOpenAI(cleanText);
    } catch (error: unknown) {
      console.error(
        '[Embeddings] Fatal error:',
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private async _embedWithGemini(text: string): Promise<number[] | null> {
    const apiKey = this.config.geminiKey;
    if (!apiKey) throw new Error('Gemini API key missing');

    // Safe debug log
    const keyObfuscated = apiKey.startsWith('AIza')
      ? 'AIza...' + apiKey.slice(-4)
      : apiKey.substring(0, 5) + '...';

    console.log(
      `[Embeddings] Using Model: ${this.model}, Dims: ${this.dimensions}, Key: ${keyObfuscated}`,
    );

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
      const err = await response.json();
      throw new Error(err.error?.message || 'Gemini API Error');
    }

    const data = await response.json();
    return data.embedding?.values || null;
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
      const err = await response.json();
      throw new Error(err.error?.message || 'OpenAI API Error');
    }

    const data = await response.json();
    return data.data[0]?.embedding || null;
  }
}
