// services/voice/minimax.js
// Service d'intégration vocale Minimax (T2A)
// Documentation: https://platform.minimax.io/docs/

import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import { ensureFfmpegBinary } from '../../utils/ffmpegBinary.js';
import { safeExistsSync, safeMkdirSync, safeWriteFile, safeUnlink } from '../../utils/safeFs.js';

ensureFfmpegBinary();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

interface MinimaxConfig {
  voice_id?: string;
  model?: string;
  speed?: number;
  vol?: number;
  pitch?: number;
}

interface MinimaxBaseResp {
  status_code: number;
  status_msg: string;
}

interface MinimaxData {
  audio: string;
}

interface MinimaxResponse {
  base_resp?: MinimaxBaseResp;
  data?: MinimaxData;
}

export class MinimaxVoiceService {
  apiKey: string;
  baseUrl: string;
  config: MinimaxConfig;
  cacheDir: string;

  constructor(apiKey: string, config: MinimaxConfig = {}) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.minimax.io/v1/t2a_v2';
    this.config = config;

    this.cacheDir = path.join(__dirname, '..', '..', 'temp', 'voice_cache');
    if (!safeExistsSync(this.cacheDir)) {
      safeMkdirSync(this.cacheDir, { recursive: true });
    }
  }

  async generateAudio(text: string, voiceId: string | null = null): Promise<string> {
    if (
      typeof this.apiKey !== 'string' ||
      this.apiKey.trim().length === 0 ||
      this.apiKey.trim().toLowerCase() === 'no_key'
    ) {
      throw new Error('Clé API Minimax manquante ou invalide');
    }

    const model = this.config.model || 'speech-02-hd';
    const selectedVoiceId = voiceId || this.config.voice_id || 'female-01';

    const payload = {
      model,
      text,
      stream: false,
      voice_setting: {
        voice_id: selectedVoiceId,
        speed: this.config.speed || 1.0,
        vol: this.config.vol || 1.0,
        pitch: this.config.pitch || 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    };

    try {
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

      const data: MinimaxResponse = (await response.json()) as MinimaxResponse;

      if (data.base_resp && data.base_resp.status_code !== 0) {
        throw new Error(`Minimax Error: ${data.base_resp.status_msg}`);
      }

      if (!data.data || !data.data.audio) {
        throw new Error('Réponse invalide: pas de données audio');
      }

      const audioHex = data.data.audio;
      const audioBuffer = Buffer.from(audioHex, 'hex');

      const tempMp3Path = path.join(this.cacheDir, `temp_${Date.now()}.mp3`);
      await safeWriteFile(tempMp3Path, audioBuffer);

      const outputOggPath = tempMp3Path.replace('.mp3', '.ogg');
      await this.convertToOgg(tempMp3Path, outputOggPath);

      try {
        await safeUnlink(tempMp3Path);
      } catch {
        /* Cleanup best-effort */
      }

      return outputOggPath;
    } catch (error: unknown) {
      console.error('❌ Erreur génération vocale Minimax:', extractErrorMessage(error));
      throw error;
    }
  }

  convertToOgg(inputPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec('libopus')
        .audioBitrate('32k')
        .format('ogg')
        .on('end', () => resolve(outputPath))
        .on('error', (err: Error) => reject(new Error(`FFmpeg error: ${extractErrorMessage(err)}`)))
        .save(outputPath);
    });
  }
}
