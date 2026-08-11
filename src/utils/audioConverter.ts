/**
 * utils/audioConverter.ts
 * Utilitaires de conversion audio pour Gemini Live API
 * Formats: OGG (WhatsApp) ↔ PCM (Gemini)
 */

import { spawn } from 'child_process';
import { safeExistsSync, safeUnlinkSync } from './safeFs.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';

const FFMPEG_BIN = ffmpegPath.path;

export interface AudioConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  format: string;
}

/**
 * Formats audio pour Gemini Live API
 */
export const AUDIO_FORMATS = {
  INPUT: {
    sampleRate: 16000,
    channels: 1,
    bitDepth: 16,
    format: 'pcm_s16le',
  } as AudioConfig,
  OUTPUT: {
    sampleRate: 24000,
    channels: 1,
    bitDepth: 16,
    format: 'pcm_s16le',
  } as AudioConfig,
};

/**
 * Convertit un fichier OGG (WhatsApp) en PCM pour Gemini
 * @param oggPath Chemin du fichier OGG
 * @returns Audio PCM 16-bit, 16kHz, Mono
 */
export async function oggToPcm(oggPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const ffmpeg = spawn(FFMPEG_BIN, [
      '-i',
      oggPath,
      '-f',
      's16le', // PCM 16-bit signed little-endian
      '-acodec',
      'pcm_s16le',
      '-ar',
      '16000', // 16kHz (Gemini input)
      '-ac',
      '1', // Mono
      '-', // Output to stdout
    ]);

    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on('data', () => {}); // Ignorer les logs ffmpeg

    ffmpeg.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exit code: ${code}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

/**
 * Convertit un buffer PCM (Gemini output) en fichier OGG pour WhatsApp
 * @param pcmBuffer Audio PCM 16-bit, 24kHz, Mono
 * @param options { sampleRate: 24000 }
 * @returns Chemin du fichier OGG
 */
export async function pcmToOgg(
  pcmBuffer: Buffer,
  options: { sampleRate?: number } = {},
): Promise<string> {
  const sampleRate = options.sampleRate || 24000;
  const outputPath = join(tmpdir(), `gemini_audio_${randomUUID()}.ogg`);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(FFMPEG_BIN, [
      '-f',
      's16le', // Input format: PCM 16-bit
      '-ar',
      sampleRate.toString(),
      '-ac',
      '1', // Mono
      '-i',
      '-', // Input from stdin
      '-c:a',
      'libopus', // Opus codec (WhatsApp compatible)
      '-b:a',
      '64k', // Bitrate
      '-vbr',
      'on',
      '-compression_level',
      '10',
      '-y', // Overwrite
      outputPath,
    ]);

    ffmpeg.stdin.write(pcmBuffer);
    ffmpeg.stdin.end();

    ffmpeg.stderr.on('data', () => {}); // Ignorer les logs

    ffmpeg.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`ffmpeg exit code: ${code}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

/**
 * Convertit un fichier WAV en OGG pour WhatsApp
 * @param wavPath Chemin du fichier WAV
 * @returns Chemin du fichier OGG
 */
export async function wavToOgg(wavPath: string): Promise<string> {
  const outputPath = join(tmpdir(), `gemini_audio_${randomUUID()}.ogg`);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(FFMPEG_BIN, [
      '-i',
      wavPath,
      '-c:a',
      'libopus',
      '-b:a',
      '64k',
      '-vbr',
      'on',
      '-y',
      outputPath,
    ]);

    ffmpeg.stderr.on('data', () => {});

    ffmpeg.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`ffmpeg exit code: ${code}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

/**
 * Nettoie les fichiers temporaires
 * @param paths Chemins des fichiers à supprimer
 */
export function cleanupTempFiles(...paths: (string | null | undefined)[]): void {
  for (const path of paths) {
    try {
      if (path && safeExistsSync(path)) {
        safeUnlinkSync(path);
      }
    } catch {
      console.warn('[AudioConverter] Cleanup failed:', path);
    }
  }
}

/**
 * Vérifie si ffmpeg est disponible
 */
export async function checkFfmpeg(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const ffmpeg = spawn(FFMPEG_BIN, ['-version']);
    ffmpeg.on('close', (code: number | null) => resolve(code === 0));
    ffmpeg.on('error', () => resolve(false));
  });
}

export default {
  oggToPcm,
  pcmToOgg,
  wavToOgg,
  cleanupTempFiles,
  checkFfmpeg,
  AUDIO_FORMATS,
};
