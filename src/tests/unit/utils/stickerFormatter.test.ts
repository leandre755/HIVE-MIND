import { describe, it, expect } from '@jest/globals';
import sharpImage from 'sharp';
import {
  createStickerExif,
  injectExifToWebp,
  createStickerBuffer,
} from '../../../utils/stickerFormatter.js';

describe('stickerFormatter', () => {
  describe('createStickerExif', () => {
    it('creates a valid EXIF buffer with default values', () => {
      const exif = createStickerExif();
      expect(exif).toBeInstanceOf(Buffer);
      expect(exif.length).toBeGreaterThan(32);

      // Check TIFF little-endian header
      expect(exif[0]).toBe(0x49);
      expect(exif[1]).toBe(0x49);
      expect(exif[2]).toBe(0x2a);
      expect(exif[3]).toBe(0x00);

      // Check metadata string presence
      const exifStr = exif.toString('utf8');
      expect(exifStr).toContain('Bot Stickers');
      expect(exifStr).toContain('Bot');
      expect(exifStr).toContain('sticker-pack-id');
    });

    it('creates a custom EXIF buffer with custom pack, author, and emojis', () => {
      const exif = createStickerExif('MyPack', 'MyAuthor', ['🔥', '🚀']);
      const exifStr = exif.toString('utf8');
      expect(exifStr).toContain('MyPack');
      expect(exifStr).toContain('MyAuthor');
      expect(exifStr).toContain('🔥');
      expect(exifStr).toContain('🚀');
    });
  });

  describe('injectExifToWebp', () => {
    it('throws on invalid non-WebP buffer', () => {
      const invalidBuffer = Buffer.from('NOT_A_WEBP_FILE');
      const exif = createStickerExif();
      expect(() => injectExifToWebp(invalidBuffer, exif)).toThrow('Invalid WebP buffer');
    });

    it('injects EXIF chunk into a standard WebP buffer', async () => {
      const samplePng = await sharpImage({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const baseWebp = await sharpImage(samplePng).webp().toBuffer();
      const exif = createStickerExif('TestPack', 'TestAuthor');
      const resultWebp = injectExifToWebp(baseWebp, exif);

      expect(resultWebp.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(resultWebp.subarray(8, 12).toString('ascii')).toBe('WEBP');
      expect(resultWebp.includes(Buffer.from('EXIF', 'ascii'))).toBe(true);
      expect(resultWebp.includes(Buffer.from('TestPack', 'utf8'))).toBe(true);
      expect(resultWebp.includes(Buffer.from('TestAuthor', 'utf8'))).toBe(true);
    }, 15000);
  });

  describe('createStickerBuffer', () => {
    it('converts an image buffer into a 512x512 WebP sticker with EXIF metadata', async () => {
      const samplePng = await sharpImage({
        create: {
          width: 120,
          height: 80,
          channels: 4,
          background: { r: 0, g: 128, b: 255, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const sticker = await createStickerBuffer(samplePng, {
        pack: 'HIVE-MIND',
        author: 'Tester',
        quality: 90,
      });

      expect(sticker).toBeInstanceOf(Buffer);
      expect(sticker.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(sticker.subarray(8, 12).toString('ascii')).toBe('WEBP');
      expect(sticker.includes(Buffer.from('HIVE-MIND', 'utf8'))).toBe(true);
      expect(sticker.includes(Buffer.from('Tester', 'utf8'))).toBe(true);

      // Verify dimensions
      const metadata = await sharpImage(sticker).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(512);
      expect(metadata.height).toBe(512);
    }, 15000);
  });
});
