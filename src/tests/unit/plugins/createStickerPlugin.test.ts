import { jest, describe, beforeEach, beforeAll, it, expect } from '@jest/globals';
import sharpImage from 'sharp';

describe('create_sticker plugin', () => {
  let CreateStickerPlugin: typeof import('../../../plugins/whatsapp/sticker/index.js').default;
  let sampleImageBuffer: Buffer;

  beforeAll(async () => {
    const mod = await import('../../../plugins/whatsapp/sticker/index.js');
    CreateStickerPlugin = mod.default;

    sampleImageBuffer = await sharpImage({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('has valid plugin metadata and toolDefinition', () => {
    expect(CreateStickerPlugin.name).toBe('create_sticker');
    expect(CreateStickerPlugin.enabled).toBe(true);
    expect(CreateStickerPlugin.toolDefinition.type).toBe('function');
    expect(CreateStickerPlugin.toolDefinition.function.name).toBe('create_sticker');
  });

  it('returns failure when transport or chatId is missing', async () => {
    const res = await CreateStickerPlugin.execute({}, { chatId: undefined });
    expect(res.success).toBe(false);
    expect(res.message).toContain('Transport or chatId missing');
  });

  it('returns failure when no image is provided in context or args', async () => {
    const transport = {
      downloadMedia: jest.fn<() => Promise<Buffer>>(),
      sendSticker: jest.fn<(chatId: string, buf: Buffer) => Promise<void>>(),
    };
    const res = await CreateStickerPlugin.execute({}, { transport, chatId: '123@s.whatsapp.net' });
    expect(res.success).toBe(false);
    expect(res.message).toContain('IMAGE_REQUIRED');
  });

  it('creates and sends sticker successfully from message image', async () => {
    const sendStickerMock = jest.fn<(chatId: string, buf: Buffer) => Promise<void>>(async () => {});
    const downloadMediaMock = jest.fn<() => Promise<Buffer>>(async () => sampleImageBuffer);

    const transport = {
      downloadMedia: downloadMediaMock,
      sendSticker: sendStickerMock,
    };

    const context = {
      transport,
      chatId: '12345@s.whatsapp.net',
      message: {
        raw: {
          message: {
            imageMessage: { mimetype: 'image/jpeg' },
          },
        },
      },
    };

    const res = await CreateStickerPlugin.execute(
      { pack_name: 'CustomPack', author: 'CustomAuthor' },
      context,
    );

    expect(res.success).toBe(true);
    expect(downloadMediaMock).toHaveBeenCalled();
    expect(sendStickerMock).toHaveBeenCalledTimes(1);

    const sentChatId = sendStickerMock.mock.calls[0]?.[0];
    const sentBuffer = sendStickerMock.mock.calls[0]?.[1];

    expect(sentChatId).toBe('12345@s.whatsapp.net');
    expect(sentBuffer).toBeInstanceOf(Buffer);
    expect(sentBuffer?.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(sentBuffer?.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });
});
