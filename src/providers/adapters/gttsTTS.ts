// providers/adapters/gttsTTS.ts
// Google TTS (Free Tier) Adapter
// Uses google-tts-api - Last resort fallback

import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import { ensureFfmpegBinary } from '../../utils/ffmpegBinary.js';
import {
  safeExistsSync,
  safeMkdirSync,
  safeReadFileBuffer,
  safeUnlink,
  safeWriteFile,
} from '../../utils/safeFs.js';
import type { TTSAdapterConfig, TTSOptions, TTSResult } from './ttsTypes.js';

ensureFfmpegBinary();

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Locale de dernier recours. google-tts-api n'expose ni modèle ni voix —
 * seule une langue — et il est le dernier maillon de la chaîne de repli TTS
 * (`voice_provider.tts_models[].priority` = 99) : il doit produire de l'audio
 * même appelé sans option, là où les autres adapters échouent volontairement.
 */
const FALLBACK_LANGUAGE = 'fr';

/** Limite de caractères par requête Google TTS (API non officielle). */
const MAX_CHARS_PER_CHUNK = 200;

type ResolveFn<T> = (value: T | PromiseLike<T>) => void;
type RejectFn = (reason?: unknown) => void;

/**
 * Surface de `google-tts-api` réellement utilisée.
 * Le paquet est en CJS ; l'import dynamique retourne le module entier.
 */
interface GoogleTtsModule {
  getAudioUrl: (text: string, options?: { lang?: string; slow?: boolean; host?: string }) => string;
  getAllAudioUrls: (
    text: string,
    options?: { lang?: string; slow?: boolean; host?: string },
  ) => string[];
}

export class GttsTTSAdapter {
  readonly name = 'gtts';
  private readonly config: TTSAdapterConfig;
  private readonly cacheDir: string;

  constructor(config: TTSAdapterConfig = {}) {
    this.config = config;
    this.cacheDir = path.join(__dirname, '..', '..', 'temp', 'voice_cache');

    if (!safeExistsSync(this.cacheDir)) {
      safeMkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /** GTTS est toujours disponible : service gratuit, sans clé ni quota. */
  isAvailable(): boolean {
    return true;
  }

  /**
   * Synthétise du texte en OGG Opus via Google Translate TTS.
   *
   * @throws {Error} Échec du fetch audio ou de la conversion ffmpeg.
   */
  async synthesize(text: string, options: TTSOptions = {}): Promise<TTSResult> {
    const language = options.language ?? this.config.language ?? FALLBACK_LANGUAGE;

    console.log(`[GTTS] Synthèse: "${text.substring(0, 50)}..." (lang: ${language})`);

    try {
      // Import dynamique : le paquet n'est chargé que sur le chemin de repli.
      const ttsModule = (await import('google-tts-api')) as unknown as GoogleTtsModule;

      // Découper le texte en chunks de ≤200 caractères (limite API)
      const chunks = this._splitText(text, MAX_CHARS_PER_CHUNK);
      const audioBuffers: Buffer[] = [];

      for (const chunk of chunks) {
        const urls = ttsModule.getAllAudioUrls(chunk, { lang: language });
        for (const url of urls) {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) {
            throw new Error(`GTTS fetch failed: ${response.status} ${response.statusText}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          audioBuffers.push(Buffer.from(arrayBuffer));
        }
      }

      const mp3Buffer = Buffer.concat(audioBuffers);

      // Sauvegarder temporairement
      const tempMp3Path = path.join(this.cacheDir, `gtts_${Date.now()}.mp3`);
      await safeWriteFile(tempMp3Path, mp3Buffer);

      // Convertir en OGG pour WhatsApp
      const outputOggPath = tempMp3Path.replace('.mp3', '.ogg');
      await this._convertToOgg(tempMp3Path, outputOggPath);

      // Le MP3 source n'a plus d'usage ; son échec de suppression ne doit pas
      // invalider une synthèse réussie, mais reste tracé.
      try {
        await safeUnlink(tempMp3Path);
      } catch (cleanupError: unknown) {
        console.warn(
          '[GTTS] Fichier temporaire non supprimé (%s):',
          tempMp3Path,
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        );
      }

      const oggBuffer = await safeReadFileBuffer(outputOggPath);

      return {
        audioBuffer: oggBuffer,
        format: 'ogg',
        filePath: outputOggPath,
      };
    } catch (error: unknown) {
      console.error('[GTTS] Erreur:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /** Découpe le texte en chunks respectant la limite de l'API. */
  private _splitText(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) {
      return [text];
    }
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      const cutAt = remaining.lastIndexOf(' ', maxLen);
      const end = cutAt > 0 ? cutAt : maxLen;
      chunks.push(remaining.substring(0, end));
      remaining = remaining.substring(end).trimStart();
    }
    return chunks;
  }

  /** Convertit MP3 vers OGG Opus, seul conteneur accepté en note vocale. */
  private _convertToOgg(inputPath: string, outputPath: string): Promise<string> {
    return new Promise<string>((resolve: ResolveFn<string>, reject: RejectFn) => {
      ffmpeg(inputPath)
        .audioCodec('libopus')
        .audioBitrate('32k')
        .audioFrequency(48000)
        .format('ogg')
        .on('end', () => resolve(outputPath))
        .on('error', (err: Error, _stdout: string | null, stderr: string | null) => {
          if (stderr) console.error('[GTTS] FFmpeg stderr:', stderr);
          reject(new Error(`FFmpeg error: ${err.message}`));
        })
        .save(outputPath);
    });
  }
}
