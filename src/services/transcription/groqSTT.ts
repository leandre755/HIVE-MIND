// services/transcription/groqSTT.js
// Service de transcription audio via Groq Whisper (OpenAI Compatible)
// Base URL: https://api.groq.com/openai/v1/audio/transcriptions

import { safeCreateReadStream } from '../../utils/safeFs.js';

interface GroqConfig {
  model?: string;
  language?: string;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

export class GroqTranscriptionService {
  private apiKey: string;
  private baseUrl: string;
  private config: GroqConfig;

  constructor(apiKey: string, config: GroqConfig = {}) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
    this.config = config;
  }

  /**
   * Transcrit un fichier audio
   * @param filePath Chemin absolu du fichier audio
   * @returns Le texte transcrit
   */
  async transcribe(filePath: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Clé API Groq manquante pour le STT');
    }

    const model = this.config.model || 'whisper-large-v3';

    try {
      // Lazy load SDK to avoid startup overhead
      const { Groq } = await import('groq-sdk');
      const groq = new Groq({ apiKey: this.apiKey });

      console.log(`[Groq] Transcription démarrage: ${filePath} (${model})`);

      const transcription = await groq.audio.transcriptions.create({
        file: safeCreateReadStream(filePath),
        model,
        language: this.config.language || 'fr',
        response_format: 'json',
      });

      return transcription.text;
    } catch (error: unknown) {
      console.error('❌ Erreur Transcription Groq:', extractErrorMessage(error));
      throw error;
    }
  }
}
