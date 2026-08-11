// providers/adapters/geminiTTS.ts
// Gemini Flash TTS Adapter
// Features: Natural prompt control, <300ms latency, 80+ locales

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
  resolveWithinRoot,
} from '../../utils/safeFs.js';
import { requireModel, requireOption } from '../requireModel.js';
import type { TTSAdapterConfig, TTSOptions, TTSResult } from './ttsTypes.js';

ensureFfmpegBinary();

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Paramètres du flux PCM renvoyé par l'API, requis par ffmpeg en entrée brute. */
const PCM_SAMPLE_RATE = 24000;

type ResolveFn<T> = (value: T | PromiseLike<T>) => void;
type RejectFn = (reason?: unknown) => void;

/** Charge utile binaire d'une `part` de réponse `generateContent`. */
interface GeminiInlineData {
  data: string;
  mimeType?: string;
}

interface GeminiResponsePart {
  inlineData?: GeminiInlineData;
}

/** Réponse `generateContent`. Tous les champs manquent sur le chemin d'erreur. */
interface GeminiTTSResponse {
  candidates?: { content?: { parts?: GeminiResponsePart[] } }[];
}

/** Corps d'erreur de l'API Generative Language. */
interface GeminiErrorResponse {
  error?: { message?: string };
}

/**
 * Assemble les consignes de jeu ("Director's Notes") lues dans les options.
 *
 * La documentation impose de les placer en tête du texte, entre parenthèses.
 */
function buildDirectorNotes(options: TTSOptions): string {
  const notes = [
    options.style,
    options.tone ? `Tone: ${options.tone}` : null,
    options.accent ? `Accent: ${options.accent}` : null,
    options.pace ? `Pace: ${options.pace}` : null,
    options.language ? `Language or dialect: ${options.language}` : null,
    options.speaker_1 ? `Speaker 1: ${options.speaker_1}` : null,
    options.speaker_2 ? `Speaker 2: ${options.speaker_2}` : null,
  ].filter((note): note is string => typeof note === 'string' && note.length > 0);

  return notes.join('. ');
}

/**
 * Détermine l'extension du fichier brut à écrire d'après le type MIME annoncé.
 *
 * `audio/l16` désigne du PCM brut ; un en-tête `RIFF` signale un WAV même
 * lorsque le MIME ne le dit pas.
 */
function resolveAudioFormat(
  mimeType: string,
  audioBuffer: Buffer,
): { ext: string; isPcm: boolean } {
  if (mimeType.includes('wav') || audioBuffer.subarray(0, 4).toString() === 'RIFF') {
    return { ext: 'wav', isPcm: false };
  }
  if (mimeType.includes('pcm') || mimeType.includes('l16')) {
    return { ext: 'pcm', isPcm: true };
  }
  return { ext: 'mp3', isPcm: false };
}

export class GeminiTTSAdapter {
  readonly name = 'gemini';
  private readonly apiKey: string | undefined;
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
   * Synthétise du texte en OGG Opus via l'API Generative Language.
   *
   * `options.model` et `options.voice` sont obligatoires : ils proviennent de
   * `voice_provider.tts_models[]` dans `models_config.json`. La liste des voix
   * acceptées fait foi dans `voice_provider.gemini_voices` et est validée par
   * `VoiceProvider` en amont ; l'API rejette de toute façon un nom inconnu.
   *
   * @throws {Error} Clé absente, modèle ou voix non fournis, erreur API,
   *   réponse sans charge audio.
   */
  async synthesize(text: string, options: TTSOptions = {}): Promise<TTSResult> {
    if (!this.isAvailable()) {
      throw new Error('Clé API Gemini manquante ou invalide');
    }

    const model = requireModel(options.model, 'Gemini TTS Adapter');
    const voice = requireOption(options.voice, 'voice', 'Gemini TTS Adapter');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    // Construction du contenu avec Director's Notes (style)
    // Les instructions de haut niveau sont placées entre parenthèses au début selon la doc
    const directorNotes = buildDirectorNotes(options);
    const finalText = directorNotes ? `(${directorNotes}) ${text}` : text;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: finalText }],
        },
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice,
            },
          },
        },
      },
    };

    console.log(
      `[GeminiTTS] Synthèse: "${text.substring(0, 50)}..." (voice: ${voice}, model: ${model})`,
    );
    if (directorNotes) console.log(`[GeminiTTS] 🎬 Director notes: ${directorNotes}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = (await response.json()) as GeminiErrorResponse;
      throw new Error(error.error?.message ?? `Gemini TTS Error (${response.status})`);
    }

    const data = (await response.json()) as GeminiTTSResponse;
    const candidate = data.candidates?.[0];

    if (!candidate) {
      throw new Error('Pas de réponse Gemini TTS');
    }

    // Trouver la partie audio
    const inlineData = candidate.content?.parts?.find(
      (part: GeminiResponsePart) => part.inlineData,
    )?.inlineData;

    if (!inlineData) {
      throw new Error(
        'Pas de données audio dans la réponse. Vérifiez que le modèle supporte le mode AUDIO.',
      );
    }

    // Décoder l'audio Base64
    const audioBuffer = Buffer.from(inlineData.data, 'base64');
    const mimeType = (inlineData.mimeType ?? 'audio/pcm').toLowerCase();

    console.log(`[GeminiTTS] Audio data received: ${audioBuffer.length} bytes, MIME: ${mimeType}`);
    console.log(`[GeminiTTS] First 16 bytes (hex): ${audioBuffer.subarray(0, 16).toString('hex')}`);

    // Sauvegarde temporaire du fichier brut
    const { ext, isPcm } = resolveAudioFormat(mimeType, audioBuffer);
    const tempPath = resolveWithinRoot(this.cacheDir, `gemini_${Date.now()}.${ext}`);
    await safeWriteFile(tempPath, audioBuffer);

    console.log(
      `[GeminiTTS] Saved raw file to: ${tempPath} (Detected ext: ${ext}, isPcm: ${isPcm})`,
    );

    // Convertir en OGG pour WhatsApp (Opus)
    const outputOggPath = tempPath.replace(`.${ext}`, '.ogg');

    try {
      await this._convertToOgg(tempPath, outputOggPath, isPcm);
    } catch (convErr: unknown) {
      console.error(
        '[GeminiTTS] Conversion error:',
        convErr instanceof Error ? convErr.message : String(convErr),
      );
      // Un MP3 ou un WAV est lisible tel quel par le consommateur ; seul le PCM
      // brut, sans en-tête, est inexploitable sans la conversion.
      if (ext !== 'pcm') {
        return { audioBuffer, format: ext, filePath: tempPath };
      }
      throw convErr;
    }

    // Le fichier brut n'a plus d'usage ; son échec de suppression ne doit pas
    // invalider une synthèse réussie, mais reste tracé.
    try {
      await safeUnlink(tempPath);
    } catch (cleanupError: unknown) {
      console.warn(
        '[GeminiTTS] Fichier temporaire non supprimé (%s):',
        tempPath,
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      );
    }

    const oggBuffer = await safeReadFileBuffer(outputOggPath);

    return {
      audioBuffer: oggBuffer,
      format: 'ogg',
      filePath: outputOggPath,
      provider: 'gemini',
      model,
    };
  }

  /**
   * Convertit vers OGG Opus.
   *
   * @param isRawPcm Si vrai, décrit le flux d'entrée à ffmpeg : le PCM brut ne
   *   porte aucun en-tête, ses paramètres doivent être fournis explicitement.
   */
  private _convertToOgg(
    inputPath: string,
    outputPath: string,
    isRawPcm: boolean = false,
  ): Promise<string> {
    return new Promise<string>((resolve: ResolveFn<string>, reject: RejectFn) => {
      const command = ffmpeg();

      command.input(inputPath);

      if (isRawPcm) {
        // Gemini TTS renvoie du PCM 16-bit little-endian mono
        command.inputOptions(['-f s16le', `-ar ${PCM_SAMPLE_RATE}`, '-ac 1']);
      }

      command
        .audioCodec('libopus')
        .audioBitrate('32k')
        .audioFrequency(48000) // Standard Opus frequency
        .format('ogg')
        .on('end', () => resolve(outputPath))
        .on('error', (err: Error, _stdout: string | null, stderr: string | null) => {
          if (stderr) console.error('[GeminiTTS] FFmpeg stderr:', stderr);
          reject(new Error(`FFmpeg error: ${err.message}`));
        })
        .save(outputPath);
    });
  }
}
