import crypto from 'node:crypto';
import sharpImage from 'sharp';

export interface StickerOptions {
  pack?: string;
  author?: string;
  quality?: number;
  emojis?: string[];
  keepAspectRatio?: boolean;
}

/**
 * Construit un buffer EXIF brut structuré selon la spécification WhatsApp.
 */
export function createStickerExif(
  pack = 'Bot Stickers',
  author = 'Bot',
  emojis: string[] = ['✨'],
): Buffer {
  const metadata = {
    'sticker-pack-id': crypto.randomUUID(),
    'sticker-pack-name': pack,
    'sticker-pack-publisher': author,
    emojis,
  };

  const jsonBytes = Buffer.from(JSON.stringify(metadata), 'utf8');
  const exifHeader = Buffer.from([
    0x49,
    0x49,
    0x2a,
    0x00, // TIFF Little Endian
    0x08,
    0x00,
    0x00,
    0x00, // Offset vers le premier IFD (8)
    0x01,
    0x00, // 1 entrée dans le répertoire IFD
    0x41,
    0x57, // Tag 0x5741 ('WA' pour WhatsApp)
    0x07,
    0x00, // Type 7 = UNDEFINED
    0x00,
    0x00,
    0x00,
    0x00, // Espace réservé pour la taille des données (octets 14-17)
    0x16,
    0x00,
    0x00,
    0x00, // Décalage vers la valeur (22 octets)
    0x00,
    0x00,
    0x00,
    0x00, // Décalage vers le prochain IFD (0 = aucun)
  ]);

  exifHeader.writeUInt32LE(jsonBytes.length, 14);
  return Buffer.concat([exifHeader, jsonBytes]);
}

/**
 * Injecte un chunk EXIF dans un conteneur WebP RIFF standard.
 */
export function injectExifToWebp(webpBuffer: Buffer, exifBuffer: Buffer): Buffer {
  if (
    webpBuffer.length < 12 ||
    webpBuffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    webpBuffer.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    throw new Error('Invalid WebP buffer: missing RIFF/WEBP container header');
  }

  const exifChunkHeader = Buffer.from('EXIF', 'ascii');
  const exifChunkSize = Buffer.alloc(4);
  exifChunkSize.writeUInt32LE(exifBuffer.length, 0);
  const padding = exifBuffer.length % 2 !== 0 ? Buffer.from([0x00]) : Buffer.alloc(0);
  const exifChunk = Buffer.concat([exifChunkHeader, exifChunkSize, exifBuffer, padding]);

  const chunkHeader = webpBuffer.subarray(12, 16).toString('ascii');
  if (chunkHeader === 'VP8X') {
    // Si le WebP dispose déjà d'un en-tête VP8X étendu, activer le bit EXIF (0x08)
    const flags = webpBuffer.readUInt8(20);
    webpBuffer.writeUInt8(flags | 0x08, 20);

    const newWebp = Buffer.concat([webpBuffer, exifChunk]);
    newWebp.writeUInt32LE(newWebp.length - 8, 4);
    return newWebp;
  }

  // Sinon, construire le chunk VP8X pour déclarer l'extension EXIF
  const vp8xHeader = Buffer.from('VP8X', 'ascii');
  const vp8xSize = Buffer.alloc(4);
  vp8xSize.writeUInt32LE(10, 0);
  const vp8xData = Buffer.alloc(10);
  vp8xData.writeUInt8(0x08, 0); // Drapeau EXIF activé
  // Canvas 512x512 -> max canvas dimensions 511 (0x01ff)
  vp8xData.writeUIntLE(511, 4, 3);
  vp8xData.writeUIntLE(511, 7, 3);
  const vp8xChunk = Buffer.concat([vp8xHeader, vp8xSize, vp8xData]);

  const originalChunks = webpBuffer.subarray(12);
  const newWebp = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.alloc(4),
    Buffer.from('WEBP', 'ascii'),
    vp8xChunk,
    originalChunks,
    exifChunk,
  ]);
  newWebp.writeUInt32LE(newWebp.length - 8, 4);
  return newWebp;
}

/**
 * Transforme n'importe quel buffer d'image en sticker WebP compatible WhatsApp avec métadonnées Exif.
 */
export async function createStickerBuffer(
  mediaBuffer: Buffer,
  options: StickerOptions = {},
): Promise<Buffer> {
  const {
    pack = 'Bot Stickers',
    author = 'Bot',
    quality = 80,
    emojis = ['✨'],
    keepAspectRatio = true,
  } = options;

  const sharpInstance = sharpImage(mediaBuffer, { animated: true });
  const fitMode = keepAspectRatio ? 'contain' : 'fill';

  const webpBuffer = await sharpInstance
    .resize(512, 512, {
      fit: fitMode,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality, effort: 6 })
    .toBuffer();

  const exifBuffer = createStickerExif(pack, author, emojis);
  return injectExifToWebp(webpBuffer, exifBuffer);
}
