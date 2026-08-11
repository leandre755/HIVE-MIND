// providers/adapters/geminiLive.ts
// providers/adapters/geminiLive.js
// Adapter pour Gemini 2.5 Flash Native Audio (Live API)
// PRIORITY 0: Provider principal pour TTS haute qualité

import { GeminiLiveProvider, HD_VOICES, type GeminiLiveProviderOptions } from '../geminiLive.js';
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

export class GeminiLiveAdapter {
  apiKey: string | undefined;
  options: GeminiLiveProviderOptions;
  provider: GeminiLiveProvider | null;
  defaultVoice: string;

  constructor(apiKey: string | undefined, options: GeminiLiveProviderOptions = {}) {
    this.apiKey = apiKey;
    this.options = options;
    this.provider = null;
    this.defaultVoice = options.voice ?? HD_VOICES.ZEPHYR;

    if (apiKey) {
      this.provider = new GeminiLiveProvider(apiKey, {
        ...options,
        voice: this.defaultVoice,
      });
    }
  }

  /**
   * Vérifie si l'adapter est disponible
   */
  isAvailable(): boolean {
    return !!this.provider && !!this.apiKey;
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
    const provider = this.provider;
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

      // Convertir WAV → OGG pour WhatsApp
      const oggPath = await wavToOgg(result.filePath);

      // Cleanup WAV temp
      cleanupTempFiles(result.filePath);

      return {
        audioBuffer: await safeReadFileBuffer(oggPath),
        format: 'ogg',
        filePath: oggPath,
        provider: 'gemini-live',
      };
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
