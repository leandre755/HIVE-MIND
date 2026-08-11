// Sticker creation plugin from images/videos

import { Sticker, StickerTypes } from 'wa-sticker-formatter';

interface StickerContext {
  transport?: {
    downloadMedia?: (msg: unknown) => Promise<Buffer>;
    sendSticker?: (chatId: string, buffer: Buffer) => Promise<void>;
  };
  message?: {
    raw?: {
      message?: {
        imageMessage?: unknown;
        videoMessage?: unknown;
      };
      key?: unknown;
    };
    quotedMsg?: {
      message?: {
        imageMessage?: unknown;
        videoMessage?: unknown;
      };
    };
  };
  chatId?: string;
}

interface StickerArgs {
  pack_name?: string;
  author?: string;
  url?: string;
}

interface MediaSource {
  mediaMessage: {
    message?: {
      imageMessage?: unknown;
      videoMessage?: unknown;
    };
    key?: unknown;
  } | null;
  directBuffer: Buffer | null;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function resolveUrlBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
  } catch (e: unknown) {
    console.error('[Sticker] URL download error:', e);
  }
  return null;
}

function extractMediaFromMessage(message: StickerContext['message']): MediaSource {
  if (message?.raw?.message?.imageMessage || message?.raw?.message?.videoMessage) {
    return { mediaMessage: message.raw ?? null, directBuffer: null };
  }
  if (message?.quotedMsg?.message) {
    if (message.quotedMsg.message.imageMessage || message.quotedMsg.message.videoMessage) {
      return {
        mediaMessage: { message: message.quotedMsg.message, key: message.raw?.key },
        directBuffer: null,
      };
    }
  }
  return { mediaMessage: null, directBuffer: null };
}

export default {
  name: 'create_sticker',
  description: 'Creates a sticker from an image, video, or GIF.',
  version: '1.0.0',
  enabled: true,

  // TEXT MATCHER: [sticker] pattern for textual fallback
  textMatchers: [
    {
      pattern: /\[sticker\]/i,
      handler: 'create_sticker',
      description: 'Create a sticker via [sticker]',
      extractArgs: () => ({}),
    },
  ],

  // Tool definition for function calling
  toolDefinition: {
    type: 'function',
    function: {
      name: 'create_sticker',
      description:
        'Create a sticker from an image or video attached to the message or quoted. User must send or reply to an image/video.',
      parameters: {
        type: 'object',
        properties: {
          pack_name: {
            type: 'string',
            description: 'Sticker pack name (optional)',
          },
          author: {
            type: 'string',
            description: 'Sticker author name (optional)',
          },
        },
        required: [],
      },
    },
  },

  /**
   * Exécute la création de sticker
   * @param {Object} args - { pack_name, author, url }
   * @param {Object} context - { transport, message, chatId, sender }
   * @param {string} toolName - Nom de l'outil
   */
  async execute(args: unknown, context: StickerContext, _toolName?: string) {
    const { transport, message, chatId } = context || {};
    const stickerArgs = args as StickerArgs;
    const { pack_name = 'Bot Stickers', author = 'Bot', url } = stickerArgs;

    if (!transport || !chatId) {
      return { success: false, message: 'Transport or chatId missing from context.' };
    }

    // Resolve media source
    let directBuffer: Buffer | null = null;
    if (url) {
      directBuffer = await resolveUrlBuffer(url);
    }
    const { mediaMessage } = extractMediaFromMessage(message);

    if (!mediaMessage && !directBuffer) {
      return {
        success: false,
        message:
          'IMAGE_REQUIRED: Send, reply to an image/video, or provide a URL to create a sticker.',
      };
    }

    try {
      // Download media (either URL buffer or Message)
      const downloadFn = transport.downloadMedia;
      if (!downloadFn) {
        return { success: false, message: 'Download function not available.' };
      }
      const mediaBuffer = directBuffer || (await downloadFn({ raw: mediaMessage }));

      // Create sticker
      const sticker = new Sticker(mediaBuffer, {
        pack: pack_name,
        author,
        type: StickerTypes.FULL,
        quality: 80,
      });

      const stickerBuffer = await sticker.toBuffer();

      // Send sticker
      const sendStickerFn = transport.sendSticker;
      if (sendStickerFn) {
        await sendStickerFn(chatId, stickerBuffer);
      }

      return {
        success: true,
        message: 'Sticker created and sent successfully! 🎉',
      };
    } catch (error: unknown) {
      console.error('[Sticker Plugin] Error:', error);
      return {
        success: false,
        message: `Error creating sticker: ${extractErrorMessage(error)}`,
      };
    }
  },
};
