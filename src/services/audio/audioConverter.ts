// services/audio/audioConverter.ts
// Convertit les formats audio entre WhatsApp (OGG Opus) et Gemini (PCM 16kHz mono)

import ffmpeg from 'fluent-ffmpeg';
import { ensureFfmpegBinary } from '../../utils/ffmpegBinary.js';
import { safeUnlink } from '../../utils/safeFs.js';

ensureFfmpegBinary();

type ResolveFn<T> = (value: T | PromiseLike<T>) => void;
type RejectFn = (reason?: unknown) => void;

/**
 * Convertir OGG Opus vers PCM 16kHz mono (format Gemini)
 * @param inputPath - Chemin du fichier OGG
 * @returns Buffer PCM
 */
export async function convertOggToPcm(inputPath: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve: ResolveFn<Buffer>, reject: RejectFn) => {
    const chunks: Buffer[] = [];

    ffmpeg(inputPath)
      .audioCodec('pcm_s16le') // PCM 16-bit little endian
      .audioFrequency(16000) // 16kHz
      .audioChannels(1) // Mono
      .format('s16le') // Raw PCM
      .on('error', (err: Error) => {
        console.error('[AudioConverter] ❌ OGG→PCM error:', err.message);
        reject(err);
      })
      .on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`[AudioConverter] ✅ OGG→PCM (${buffer.length} bytes)`);
        resolve(buffer);
      })
      .pipe()
      .on('data', (chunk: Buffer) => chunks.push(chunk));
  });
}

/**
 * Convertir PCM vers OGG Opus (format WhatsApp)
 * @param inputPath - Chemin du fichier PCM
 * @param outputPath - Chemin de sortie OGG
 * @param sampleRate - Fréquence d'échantillonnage en Hz
 * @returns Chemin du fichier OGG
 */
export async function convertPcmToOgg(
  inputPath: string,
  outputPath: string,
  sampleRate = 24000,
): Promise<string> {
  return new Promise<string>((resolve: ResolveFn<string>, reject: RejectFn) => {
    ffmpeg(inputPath)
      .inputOptions([
        '-f s16le',
        `-ar ${sampleRate}`,
        '-ac 1', // Mono
      ])
      .audioCodec('libopus')
      .audioBitrate('64k')
      .audioFrequency(48000)
      .format('ogg')
      .on('error', (err: Error, _stdout: string | null, stderr: string | null) => {
        if (stderr) console.error('[AudioConverter] FFmpeg stderr:', stderr);
        console.error('[AudioConverter] ❌ PCM→OGG error:', err.message);
        reject(err);
      })
      .on('end', () => {
        console.log(`[AudioConverter] ✅ PCM→OGG: ${outputPath} (input ${sampleRate}Hz)`);
        resolve(outputPath);
      })
      .save(outputPath);
  });
}

/**
 * Convertir et nettoyer (tout-en-un)
 * @param inputOgg - Fichier OGG WhatsApp
 * @param outputOgg - Fichier OGG de sortie
 * @param processCallback - Fonction de traitement (reçoit PCM buffer)
 */
export async function processAudioPipeline(
  inputOgg: string,
  outputOgg: string,
  processCallback: (buffer: Buffer) => Promise<string>,
): Promise<string> {
  let pcmBuffer: Buffer | null = null;
  let tempPcmPath: string | null = null;

  try {
    // 1. OGG → PCM
    console.log('[AudioConverter] 🔄 Pipeline: OGG → PCM');
    pcmBuffer = await convertOggToPcm(inputOgg);

    // 2. Traiter (ex: envoyer à Gemini)
    console.log('[AudioConverter] ⚙️ Processing audio...');
    tempPcmPath = await processCallback(pcmBuffer);

    // 3. PCM → OGG
    console.log('[AudioConverter] 🔄 Pipeline: PCM → OGG');
    await convertPcmToOgg(tempPcmPath, outputOgg, 16000);

    return outputOgg;
  } finally {
    // Cleanup
    if (tempPcmPath) {
      await safeUnlink(tempPcmPath).catch(() => {});
    }
  }
}

export default {
  convertOggToPcm,
  convertPcmToOgg,
  processAudioPipeline,
};
