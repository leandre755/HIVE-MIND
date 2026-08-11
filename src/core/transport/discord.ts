import { Client, type Message, type TextBasedChannel } from 'discord.js-selfbot-v13';
import type { MessageData, UniversalResponse } from '../types/BotTypes.js';
import type {
  GroupEventCallback,
  ITransport,
  MessageCallback,
  PresenceType,
  SendMediaOptions,
  SendTextOptions,
  SendVoiceNoteOptions,
  TransportGroupMetadata,
} from './interface.js';

/** Limite dure de Discord par message (2000 caractères) ; on découpe à 1990 par marge. */
const DISCORD_MESSAGE_LIMIT = 2000;

/** Message normalisé émis vers le coeur applicatif (ajoute l'horodatage Discord en secondes). */
interface DiscordMessageData extends MessageData {
  timestamp: number;
}

/** Contrat du transport Discord : ITransport + l'état de connexion propre au selfbot. */
interface DiscordTransport extends ITransport {
  client: Client | null;
  messageCallback: MessageCallback | null;
  groupEventCallback: GroupEventCallback | null;
}

/**
 * Résout un salon textuel depuis son identifiant.
 * @returns Le salon si le client est connecté et que le salon accepte des messages, sinon `null`.
 */
async function fetchTextChannel(chatId: string): Promise<TextBasedChannel | null> {
  const client = discordTransport.client;
  if (!client) return null;

  const channel = await client.channels.fetch(chatId);
  if (!channel?.isText()) return null;
  return channel;
}

/** Construit le message normalisé à partir d'un message Discord. */
function normalizeMessage(msg: Message): DiscordMessageData {
  return {
    id: msg.id,
    chatId: msg.channelId,
    sender: msg.author.id,
    senderName: msg.author.username,
    text: msg.content,
    isGroup: msg.channel.type === 'GUILD_TEXT' || msg.channel.type === 'GROUP_DM',
    timestamp: Math.floor(msg.createdTimestamp / 1000),
  };
}

export const discordTransport: DiscordTransport = {
  client: null,
  messageCallback: null,
  groupEventCallback: null,

  connect: async () => {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      throw new Error('[DiscordTransport] DISCORD_TOKEN is missing in environment variables.');
    }

    // Aucune option passée : les défauts viennent de Options.createDefault() via
    // BaseClient (src/client/BaseClient.js:25). L'ancien `checkUpdate: false` était mort —
    // la clé n'apparaît nulle part dans le paquet installé.
    const client = new Client();
    discordTransport.client = client;

    client.on('ready', () => {
      console.log(`[DiscordTransport] Connected to Discord as ${client.user?.username}`);
    });

    client.on('messageCreate', (msg) => {
      if (msg.author.id === client.user?.id) return; // Ignore self

      const callback = discordTransport.messageCallback;
      if (!callback) return;

      // Map to HIVE-MIND MessageData format
      callback(normalizeMessage(msg));
    });

    await client.login(token);
  },

  disconnect: async () => {
    if (discordTransport.client) {
      discordTransport.client.destroy();
      discordTransport.client = null;
    }
  },

  sendText: async (chatId: string, text: string, _options: SendTextOptions = {}) => {
    const channel = await fetchTextChannel(chatId);
    if (!channel) return;
    return await channel.send(text);
  },

  sendMedia: async (chatId: string, media: Buffer | string, _options: SendMediaOptions = {}) => {
    const channel = await fetchTextChannel(chatId);
    if (!channel) return;
    return await channel.send({ files: [media] });
  },

  sendVoiceNote: async (
    chatId: string,
    audio: Buffer | string,
    options: SendVoiceNoteOptions = {},
  ) => {
    // Sur Discord, une note vocale est juste un fichier audio
    return await discordTransport.sendMedia(chatId, audio, options);
  },

  sendFile: async (chatId: string, filePath: string, fileName: string, caption: string = '') => {
    const channel = await fetchTextChannel(chatId);
    if (!channel) return;
    return await channel.send({
      content: caption,
      files: [{ attachment: filePath, name: fileName }],
    });
  },

  sendSticker: async (_chatId: string, _stickerBuffer: Buffer) => {
    console.warn('[DiscordTransport] sendSticker not implemented fully');
  },

  getGroupMetadata: async (groupId: string): Promise<TransportGroupMetadata> => {
    const channel = await fetchTextChannel(groupId);
    // Fail closed : les appelants (groupHandler._checkFounder, BotCore) déréférencent
    // directement le résultat. Un `null` silencieux y provoquerait un TypeError distant.
    if (!channel) {
      throw new Error(`[DiscordTransport] Salon textuel introuvable: ${groupId}`);
    }
    return {
      id: channel.id,
      name: ('name' in channel ? channel.name : null) ?? 'Discord Group',
      participants: [], // Can map guild members if needed
      admins: [],
    };
  },

  downloadMedia: async (_message: unknown): Promise<Buffer | null> => {
    // Simple download media logic or return null
    return null;
  },

  onMessage: (callback: MessageCallback) => {
    discordTransport.messageCallback = callback;
  },

  onGroupEvent: (callback: GroupEventCallback) => {
    discordTransport.groupEventCallback = callback;
  },

  setPresence: async (chatId: string, presence: PresenceType | string) => {
    if (presence !== 'composing') return;
    const channel = await fetchTextChannel(chatId);
    if (!channel) return;
    await channel.sendTyping();
  },

  sendUniversalResponse: async (
    chatId: string,
    response: UniversalResponse,
    options: SendTextOptions = {},
  ) => {
    // Discord supports full markdown natively, so we prefer the markdown property
    const text = response.markdown || response.plainText;
    if (!text) return;

    // Split text if it exceeds Discord's 2000 character limit
    if (text.length > DISCORD_MESSAGE_LIMIT) {
      const chunks = text.match(/[\s\S]{1,1990}/gu) || [];
      for (const chunk of chunks) {
        await discordTransport.sendText(chatId, chunk, options);
      }
      return;
    }
    return await discordTransport.sendText(chatId, text, options);
  },

  isAdmin: async (_groupId: string, _userId: string): Promise<boolean> => {
    return false; // Basic implementation for selfbot
  },

  sendReaction: async (_chatId: string, _key: unknown, _emoji: string): Promise<boolean> => {
    console.warn('[DiscordTransport] sendReaction not fully implemented');
    return false;
  },
};
