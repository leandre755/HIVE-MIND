// providers/adapters/geminiLive.ts
// providers/adapters/geminiLive.js
// Adapter pour Gemini 2.5 Flash Native Audio (Live API)
// PRIORITY 0: Provider principal pour TTS haute qualité

import { GeminiLiveProvider, HD_VOICES, type GeminiLiveAdapterOptions } from '../geminiLive.js';
import { oggToPcm, wavToOgg, cleanupTempFiles } from '../../utils/audioConverter.js';
import { safeReadFileBuffer } from '../../utils/safeFs.js';
import type { TTSOptions, TTSResult } from './ttsTypes.js';

/** Résultat d'une transcription, relayé tel quel à l'appelant. */
export interface GeminiLiveTranscription {
  transcription: string;
  /** `null` tant que la Live API n'expose pas de signal d'émotion. */
  emotion: string | null;
  provider: string;
}

const isUsableApiKey = (apiKey: string | undefined): apiKey is string =>
  typeof apiKey === 'string' && Boolean(apiKey.trim()) && apiKey.trim().toLowerCase() !== 'no_key';

export class GeminiLiveAdapter {
  apiKey: string | undefined;
  options: GeminiLiveAdapterOptions;
  provider: GeminiLiveProvider | null;
  defaultVoice: string;

  constructor(apiKey: string | undefined, options: GeminiLiveAdapterOptions = {}) {
    this.apiKey = isUsableApiKey(apiKey) ? apiKey.trim() : undefined;
    this.options = options;
    this.provider = null;
    this.defaultVoice = options.voice ?? HD_VOICES.ZEPHYR;
    const model = typeof options.model === 'string' ? options.model.trim() : '';
    if (this.apiKey && model) {
      const opts = { ...options, model, voice: this.defaultVoice };
      this.provider = new GeminiLiveProvider(this.apiKey, opts);
    }
  }

  /**
   * Vérifie si l'adapter est disponible
   */
  isAvailable(): boolean {
    return isUsableApiKey(this.apiKey);
  }

  /**
   * Liste des voix HD disponibles
   */
  getAvailableVoices(): string[] {
    return Object.values(HD_VOICES);
  }

  /**
   * Synthèse vocale TTS
   *
   * Le WAV temporaire produit par le provider est converti en OGG Opus pour
   * WhatsApp, puis supprimé.
   *
   * @param text Texte à convertir.
   * @param options Voix de synthèse ; à défaut celle de l'adapter.
   * @throws {Error} Provider non initialisé, ou aucun audio généré.
   */
  async synthesize(text: string, options: TTSOptions = {}): Promise<TTSResult> {
    const key = isUsableApiKey(this.apiKey) ? this.apiKey : undefined;
    const m = typeof options.model === 'string' ? options.model.trim() : '';
    const opts = { ...this.options, model: m, voice: this.defaultVoice };
    const provider =
      m && key && m !== this.provider?.model ? new GeminiLiveProvider(key, opts) : this.provider;
    if (!provider) {
      throw new Error('GeminiLive provider not initialized');
    }

    const voice = options.voice ?? this.defaultVoice;

    try {
      // Utiliser le provider Live pour TTS
      const result = await provider.textToSpeech(text, { voice });

      if (!result || !result.filePath) {
        throw new Error('No audio generated');
      }

      // Convertir WAV → OGG pour WhatsApp et garantir le nettoyage du WAV temporaire
      let oggPath: string;
      try {
        oggPath = await wavToOgg(result.filePath);
      } finally {
        cleanupTempFiles(result.filePath);
      }

      try {
        const audioBuffer = await safeReadFileBuffer(oggPath);
        return {
          audioBuffer,
          format: 'ogg',
          filePath: oggPath,
          provider: 'gemini-live',
        };
      } catch (readError: unknown) {
        cleanupTempFiles(oggPath);
        throw readError;
      }
    } catch (error: unknown) {
      console.error(
        '[GeminiLiveAdapter] TTS Error:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Transcription vocale STT
   *
   * @param audioPath Chemin du fichier OGG à transcrire.
   * @throws {Error} Provider non initialisé, ou échec de conversion/API.
   */
  async transcribe(audioPath: string): Promise<GeminiLiveTranscription> {
    const provider = this.provider;
    if (!provider) {
      throw new Error('GeminiLive provider not initialized');
    }

    try {
      // Convertir OGG → PCM pour Gemini
      const pcmBuffer = await oggToPcm(audioPath);

      // Envoyer au Live API
      const result = await provider.processAudio(pcmBuffer);

      return {
        transcription: result.transcription,
        emotion: result.emotion,
        provider: 'gemini-live',
      };
    } catch (error: unknown) {
      console.error(
        '[GeminiLiveAdapter] STT Error:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}

export default GeminiLiveAdapter;
