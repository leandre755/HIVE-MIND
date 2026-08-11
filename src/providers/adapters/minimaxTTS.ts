// providers/adapters/minimaxTTS.ts
// Minimax TTS Adapter - Voix HIVE-MIND (Primary)
// Documentation: https://platform.minimax.io/docs/

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
import { requireModel, requireOption } from '../requireModel.js';
import type { TTSAdapterConfig, TTSOptions, TTSResult } from './ttsTypes.js';

ensureFfmpegBinary();

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Réglages du conteneur audio demandé à l'API, imposés par l'étape ffmpeg. */
const AUDIO_SAMPLE_RATE = 32000;
const AUDIO_BITRATE = 128000;

type ResolveFn<T> = (value: T | PromiseLike<T>) => void;
type RejectFn = (reason?: unknown) => void;

/** Réponse `POST /v1/t2a_v2`. Tous les champs sont optionnels côté erreur. */
interface MinimaxTTSResponse {
  data?: { audio?: string };
  base_resp?: { status_code?: number; status_msg?: string };
}

export class MinimaxTTSAdapter {
  readonly name = 'minimax';
  private readonly apiKey: string | undefined;
  private readonly baseUrl = 'https://api.minimax.io/v1/t2a_v2';
  private readonly config: TTSAdapterConfig;
  private readonly cacheDir: string;

  constructor(apiKey: string | undefined, config: TTSAdapterConfig = {}) {
    this.apiKey = apiKey;
    this.config = config;
    this.cacheDir = path.join(__dirname, '..', '..', 'temp', 'voice_cache');

    if (!safeExistsSync(this.cacheDir)) {
      safeMkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Indique si une clé exploitable est présente. `no_key` est le marqueur
   * d'absence utilisé par `credentials.json`.
   */
  isAvailable(): boolean {
    return (
      typeof this.apiKey === 'string' &&
      this.apiKey.trim().length > 0 &&
      this.apiKey.trim().toLowerCase() !== 'no_key'
    );
  }

  /**
   * Synthétise du texte en OGG Opus.
   *
   * `options.model` et `options.voice_id` sont obligatoires : ils proviennent de
   * `voice_provider.tts_models[]` dans `models_config.json`.
   *
   * @throws {Error} Clé absente, modèle ou voix non fournis, erreur API.
   */
  async synthesize(text: string, options: TTSOptions = {}): Promise<TTSResult> {
    if (!this.isAvailable()) {
      throw new Error('Clé API Minimax manquante ou invalide');
    }

    const model = requireModel(options.model, 'Minimax TTS Adapter');
    const voiceId = requireOption(options.voice_id, 'voice_id', 'Minimax TTS Adapter');

    const payload = {
      model,
      text,
      stream: false,
      voice_setting: {
        voice_id: voiceId,
        speed: options.speed ?? this.config.speed,
        vol: options.vol ?? this.config.vol,
        pitch: options.pitch ?? this.config.pitch,
      },
      audio_setting: {
        sample_rate: AUDIO_SAMPLE_RATE,
        bitrate: AUDIO_BITRATE,
        format: 'mp3',
        channel: 1,
      },
    };

    console.log(`[MinimaxTTS] Synthèse: "${text.substring(0, 50)}..." (voice: ${voiceId})`);

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Minimax API Error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as MinimaxTTSResponse;

    if (data.base_resp && data.base_resp.status_code !== 0) {
      throw new Error(`Minimax Error: ${data.base_resp.status_msg}`);
    }

    const encodedAudio = data.data?.audio;
    if (!encodedAudio) {
      throw new Error('Réponse invalide: pas de données audio');
    }

    const audioBuffer = Buffer.from(encodedAudio, 'hex');

    // Sauvegarder temporairement et convertir en OGG pour WhatsApp
    const tempMp3Path = path.join(this.cacheDir, `minimax_${Date.now()}.mp3`);
    await safeWriteFile(tempMp3Path, audioBuffer);

    const outputOggPath = tempMp3Path.replace('.mp3', '.ogg');
    await this._convertToOgg(tempMp3Path, outputOggPath);

    // Le MP3 source n'a plus d'usage ; son échec de suppression ne doit pas
    // invalider une synthèse réussie, mais reste tracé.
    try {
      await safeUnlink(tempMp3Path);
    } catch (cleanupError: unknown) {
      console.warn(
        '[MinimaxTTS] Fichier temporaire non supprimé (%s):',
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
          if (stderr) console.error('[MinimaxTTS] FFmpeg stderr:', stderr);
          reject(new Error(`FFmpeg error: ${err.message}`));
        })
        .save(outputPath);
    });
  }
}
