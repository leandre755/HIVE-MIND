import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
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

/** Limite dure de Telegram par message (4096 caractères) ; on découpe à 4000 par marge. */
const TELEGRAM_CHUNK_SIZE = 4000;

/**
 * Entité expéditeur telle que résolue par GramJS.
 * Dérivée du `.d.ts` upstream plutôt que réécrite : `define.d.ts` ne réexporte pas `Entity`.
 */
type TelegramSender = Awaited<ReturnType<Api.Message['getSender']>>;

/** Message normalisé émis vers le coeur applicatif (ajoute l'horodatage Telegram). */
interface TelegramMessageData extends MessageData {
  timestamp: number;
}

/** Contrat du transport Telegram : ITransport + l'état de connexion propre à GramJS. */
interface TelegramTransport extends ITransport {
  client: TelegramClient | null;
  messageCallback: MessageCallback | null;
  groupEventCallback: GroupEventCallback | null;
}

/**
 * Extrait l'identifiant de conversation depuis l'union `Api.TypePeer`.
 * Chaque variante porte le champ sous un nom différent, d'où le narrowing par `instanceof`.
 */
function resolveChatId(peer: Api.TypePeer | undefined): string {
  if (peer instanceof Api.PeerUser) return peer.userId.toString();
  if (peer instanceof Api.PeerChat) return peer.chatId.toString();
  if (peer instanceof Api.PeerChannel) return peer.channelId.toString();
  return '';
}

/**
 * Résout un nom affichable pour l'expéditeur.
 * `username`/`firstName` n'existent que sur `Api.User` ; les groupes et canaux portent `title`.
 */
function resolveSenderName(sender: TelegramSender): string {
  if (sender instanceof Api.User) {
    return sender.username || sender.firstName || 'Unknown';
  }
  if (
    sender instanceof Api.Chat ||
    sender instanceof Api.Channel ||
    sender instanceof Api.ChatForbidden ||
    sender instanceof Api.ChannelForbidden
  ) {
    return sender.title || 'Unknown';
  }
  return 'Unknown';
}

/**
 * Construit le message normalisé à partir d'un événement GramJS.
 * Retourne `null` si l'événement ne porte pas de message exploitable.
 */
async function normalizeMessage(msg: Api.Message): Promise<TelegramMessageData> {
  let senderName = 'Unknown';
  try {
    senderName = resolveSenderName(await msg.getSender());
  } catch {
    // La résolution de l'expéditeur exige un aller-retour réseau : un échec ne doit pas
    // faire perdre le message, on retombe sur 'Unknown'.
  }

  return {
    id: msg.id.toString(),
    chatId: resolveChatId(msg.peerId),
    sender: msg.senderId?.toString() ?? '',
    senderName,
    text: msg.message || '',
    isGroup: Boolean(msg.isGroup || msg.isChannel),
    timestamp: msg.date,
  };
}

export const telegramTransport: TelegramTransport = {
  client: null,
  messageCallback: null,
  groupEventCallback: null,

  connect: async () => {
    const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
    const apiHash = process.env.TELEGRAM_API_HASH || '';
    const sessionString = process.env.TELEGRAM_SESSION || '';
    const botToken = process.env.TELEGRAM_BOT_TOKEN || '';

    if (!apiId || !apiHash) {
      throw new Error('[TelegramTransport] TELEGRAM_API_ID and TELEGRAM_API_HASH are required.');
    }

    const stringSession = new StringSession(sessionString);
    const client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: false,
    });
    telegramTransport.client = client;

    if (botToken) {
      await client.start({ botAuthToken: botToken });
      console.log('[TelegramTransport] Connected to Telegram as Bot');
    } else if (sessionString) {
      await client.connect();
      console.log('[TelegramTransport] Connected to Telegram with Session');
    } else {
      console.warn(
        '[TelegramTransport] No Bot Token or Session String provided. Connecting without pre-auth.',
      );
      await client.connect();
    }

    // Register message listener
    client.addEventHandler(async (event: NewMessageEvent) => {
      const msg = event.message;
      if (!msg) return;

      const callback = telegramTransport.messageCallback;
      if (!callback) return;

      const senderId = msg.senderId?.toString();
      const me = await client.getMe();
      if (senderId && senderId === me.id.toString()) return; // Ignore self

      callback(await normalizeMessage(msg));
    }, new NewMessage({}));
  },

  disconnect: async () => {
    if (telegramTransport.client) {
      await telegramTransport.client.disconnect();
      telegramTransport.client = null;
    }
  },

  sendText: async (chatId: string, text: string, _options: SendTextOptions = {}) => {
    if (!telegramTransport.client) return;
    return await telegramTransport.client.sendMessage(chatId, { message: text });
  },

  sendMedia: async (chatId: string, media: Buffer | string, _options: SendMediaOptions = {}) => {
    if (!telegramTransport.client) return;
    return await telegramTransport.client.sendMessage(chatId, { file: media });
  },

  sendVoiceNote: async (
    chatId: string,
    audio: Buffer | string,
    _options: SendVoiceNoteOptions = {},
  ) => {
    if (!telegramTransport.client) return;
    // `voiceNote` n'existe que sur SendFileInterface (uploads.d.ts:76) : sendMessage() ignore
    // silencieusement toute clé hors de sa liste de destructuration (messages.js:454).
    return await telegramTransport.client.sendFile(chatId, { file: audio, voiceNote: true });
  },

  sendFile: async (chatId: string, filePath: string, fileName: string, caption: string = '') => {
    if (!telegramTransport.client) return;
    // Passage direct par sendFile() : SendMessageParams.forceDocument est typé `false`
    // littéral (messages.d.ts:126) alors que SendFileInterface l'expose en `boolean`.
    return await telegramTransport.client.sendFile(chatId, {
      file: filePath,
      forceDocument: true,
      attributes: fileName ? [new Api.DocumentAttributeFilename({ fileName })] : [],
      caption,
    });
  },

  sendSticker: async (chatId: string, stickerBuffer: Buffer) => {
    if (!telegramTransport.client) return;
    return await telegramTransport.client.sendMessage(chatId, { file: stickerBuffer });
  },

  getGroupMetadata: async (groupId: string): Promise<TransportGroupMetadata> => {
    return {
      id: groupId,
      name: 'Telegram Group',
      participants: [],
      admins: [],
    };
  },

  downloadMedia: async (_message: unknown): Promise<Buffer | null> => {
    return null;
  },

  onMessage: (callback: MessageCallback) => {
    telegramTransport.messageCallback = callback;
  },

  onGroupEvent: (callback: GroupEventCallback) => {
    telegramTransport.groupEventCallback = callback;
  },

  setPresence: async (_chatId: string, _presence: PresenceType | string) => {
    // Presence typing not implemented for GramJS natively without extra API calls
  },

  sendUniversalResponse: async (
    chatId: string,
    response: UniversalResponse,
    options: SendTextOptions = {},
  ) => {
    const text = response.markdown || response.plainText;
    if (!text) return;

    // Split text if it exceeds Telegram's 4096 character limit
    if (text.length > TELEGRAM_CHUNK_SIZE) {
      const chunks = text.match(/[\s\S]{1,4000}/gu) || [];
      for (const chunk of chunks) {
        await telegramTransport.sendText(chatId, chunk, options);
      }
      return;
    }
    return await telegramTransport.sendText(chatId, text, options);
  },

  isAdmin: async (_groupId: string, _userId: string): Promise<boolean> => {
    return false;
  },

  sendReaction: async (_chatId: string, _key: unknown, _emoji: string): Promise<boolean> => {
    console.warn('[TelegramTransport] sendReaction not implemented');
    return false;
  },
};
