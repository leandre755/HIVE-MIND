import { baileysTransport, type WASocket } from './baileys.js';
import { cliTransport } from './cli.js';
import { discordTransport } from './discord.js';
import { telegramTransport } from './telegram.js';
import {
  validateTransport,
  type ITransport,
  type MessageCallback,
  type SendMediaOptions,
  type SendTextOptions,
  type SendVoiceNoteOptions,
  type TransportGroupEvent,
  type TransportGroupMetadata,
} from './interface.js';
import type { ServiceContainer } from '../ServiceContainer.js';
import type { MessageData, BotEvent, UniversalResponse } from '../types/BotTypes.js';
import { resolveWithinRoot } from '../../utils/safeFs.js';

/**
 * Capacités facultatives qu'un transport peut exposer en plus de `ITransport`.
 * Chacune est vérifiée par duck-typing au point d'appel : seul Baileys les implémente
 * toutes, et `sock` reste indispensable aux plugins WhatsApp qui pilotent le socket
 * directement (`groupParticipantsUpdate`, `groupInviteCode`...).
 */
interface TransportCapabilities {
  sock?: WASocket | null;
  /** Callback courant, exposé par les transports object-literal ; utilisé par les scripts E2E. */
  messageCallback?: MessageCallback | null;
  setContainer?(container: ServiceContainer): void;
  downloadQuotedMedia?(message: MessageData): Promise<Buffer | null>;
}

/**
 * Contrat effectif d'un transport enregistré.
 * `getGroupMetadata` est relâché en `TransportGroupMetadata | Record<string, unknown>` :
 * `HiveTransportImpl` (TUI) renvoie un objet sans `id` et ne peut pas satisfaire le
 * contrat strict — le proxy `getGroupMetadata()` ci-dessous normalise à la sortie.
 */
type RegisteredTransport = Omit<ITransport, 'getGroupMetadata'> &
  TransportCapabilities & {
    getGroupMetadata(groupId: string): Promise<TransportGroupMetadata | Record<string, unknown>>;
  };

/** Nom du transport de repli quand aucun transport actif n'est encore initialisé. */
const DEFAULT_TRANSPORT = 'whatsapp';

/** Noms de transports résolus vers le transport actif par défaut. */
const CURRENT_TRANSPORT_ALIAS = 'current';

/**
 * Normalise le retour hétérogène de `getGroupMetadata` vers le contrat transport-agnostique.
 * Le champ `id` est réinjecté depuis l'argument : les transports sans notion de groupe
 * (TUI, CLI) l'omettent de leur retour.
 */
function normalizeGroupMetadata(
  groupId: string,
  raw: TransportGroupMetadata | Record<string, unknown>,
): TransportGroupMetadata {
  return { ...raw, id: groupId } as TransportGroupMetadata;
}

export class TransportManager {
  private transports: Map<string, RegisteredTransport> = new Map();
  private activeTransports: string[] = [];

  constructor() {
    this.register(DEFAULT_TRANSPORT, baileysTransport);
    this.register('cli', cliTransport);
    this.register('discord', discordTransport);
    this.register('telegram', telegramTransport);

    // Transport inerte pour 'internal'/'system' : supporte le pulse conscient et les
    // événements silencieux (cf. `sourceChannel: 'internal'` dans core/index.ts) sans
    // qu'aucune sortie réseau ne soit émise.
    const internalTransport: RegisteredTransport = {
      connect: async () => {},
      disconnect: async () => {},
      sendText: async () => ({}),
      sendMedia: async () => ({}),
      sendVoiceNote: async () => ({}),
      sendFile: async () => ({}),
      sendSticker: async () => ({}),
      getGroupMetadata: async (groupId: string) => ({
        id: groupId,
        participants: [],
        admins: [],
      }),
      downloadMedia: async () => Buffer.from(''),
      onMessage: () => {},
      onGroupEvent: () => {},
      setPresence: async () => {},
      sendUniversalResponse: async () => ({}),
      isAdmin: async () => false,
      sendReaction: async () => true,
    };
    this.register('internal', internalTransport);
    this.register('system', internalTransport);
  }

  /**
   * Enregistre un nouveau transport
   */
  register(name: string, transportInstance: RegisteredTransport) {
    if (validateTransport(transportInstance)) {
      this.transports.set(name, transportInstance);
    }
  }

  /**
   * Propager le container d'injection de dépendances aux transports
   */
  setContainer(container: ServiceContainer) {
    this.transports.forEach((transport) => {
      if (typeof transport.setContainer === 'function') {
        transport.setContainer(container);
      }
    });
  }

  /**
   * Initialise les transports actifs selon la config (ex: ACTIVE_TRANSPORT=whatsapp,cli)
   */
  async initialize(activeTransportNames: string[] = [DEFAULT_TRANSPORT]) {
    this.activeTransports = activeTransportNames;

    const initPromises = this.activeTransports.map(async (name) => {
      const isTui = name === 'ink-cli' || name === 'tui';
      if (isTui && !this.transports.has(name)) {
        try {
          const { hiveTransport } = await import('./tui/HiveTransport.js');
          this.register(name, hiveTransport);
          console.log(`[TransportManager] TUI HIVE-MIND chargé comme transport ${name}`);

          // Lancer le serveur WebSocket associé pour les clients distants
          const { tuiServerTransport } = await import('./TuiServerTransport.js');
          await tuiServerTransport.start();
        } catch (e: unknown) {
          console.error('[TransportManager] Failed to load HIVE-MIND TUI for %s:', name, e);
        }
      }

      const transport = this.transports.get(name);
      if (!transport) {
        console.warn(`[TransportManager] Transport inconnu: ${name}`);
        return;
      }
      try {
        await transport.connect();
        console.log(`[TransportManager] Transport connecté: ${name}`);
      } catch (error: unknown) {
        console.error(
          '[TransportManager] Erreur de connexion au transport %s:',
          name,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    });

    await Promise.all(initPromises);
  }

  /**
   * Assigne les callbacks de réception de message à tous les transports actifs
   */
  onMessage(callback: (message: MessageData, sourceChannel: string) => void) {
    this.activeTransports.forEach((name) => {
      const transport = this.transports.get(name);
      if (transport) {
        // Wrapper le callback pour injecter la source du canal
        transport.onMessage((msg: MessageData) => {
          msg.sourceChannel = name;
          callback(msg, name);
        });
      }
    });
  }

  /**
   * Assigne les callbacks d'événements de groupe.
   * Les transports émettent un `TransportGroupEvent` ; le coeur consomme un `BotEvent`,
   * d'où l'enveloppe construite ici plutôt qu'un cast.
   */
  onGroupEvent(callback: (event: BotEvent, sourceChannel: string) => void) {
    this.activeTransports.forEach((name) => {
      const transport = this.transports.get(name);
      if (transport) {
        transport.onGroupEvent((event: TransportGroupEvent) => {
          event.sourceChannel = name;
          callback({ type: 'group_event', chatId: event.groupId, data: event }, name);
        });
      }
    });
  }

  /**
   * Récupère un transport spécifique (pour l'envoi ciblé)
   * Résout 'current' ou les transports non trouvés/inactifs vers le transport actif par défaut.
   */
  getTransport(name?: string): RegisteredTransport | undefined {
    if (!name || name === CURRENT_TRANSPORT_ALIAS) {
      return this._getDefaultTransport();
    }

    const transport = this.transports.get(name);
    if (!transport) {
      console.warn(
        `[TransportManager] Transport '${name}' non trouvé ou inactif. Fallback sur le transport par défaut.`,
      );
      return this._getDefaultTransport();
    }
    return transport;
  }

  /** Transport actif prioritaire, ou WhatsApp pour les tests et l'accès précoce. */
  private _getDefaultTransport(): RegisteredTransport | undefined {
    const [firstActive] = this.activeTransports;
    if (firstActive) {
      return this.transports.get(firstActive);
    }
    return this.transports.get(DEFAULT_TRANSPORT);
  }

  /**
   * Résout un transport ou échoue explicitement : les proxys ci-dessous déréférencent
   * le résultat, un `undefined` silencieux y produirait un TypeError sans contexte.
   */
  private _requireTransport(sourceChannel?: string): RegisteredTransport {
    const transport = this.getTransport(sourceChannel);
    if (!transport) {
      throw new Error(
        `[TransportManager] Aucun transport disponible pour '${sourceChannel || CURRENT_TRANSPORT_ALIAS}'`,
      );
    }
    return transport;
  }

  /**
   * Getter de compatibilité pour accéder au socket du transport par défaut (ex: Baileys)
   * WHY: BotCore et de nombreux handlers accèdent directement à .sock sur l'instance de transport.
   */
  get sock(): WASocket | null {
    return this.getTransport()?.sock ?? null;
  }

  set sock(value: WASocket | null) {
    const transport = this.getTransport();
    if (transport) {
      transport.sock = value;
    }
  }

  /**
   * Proxy pour récupérer les métadonnées d'un groupe
   */
  async getGroupMetadata(groupId: string, sourceChannel?: string): Promise<TransportGroupMetadata> {
    const transport = this._requireTransport(sourceChannel);
    if (typeof transport.getGroupMetadata === 'function') {
      return normalizeGroupMetadata(groupId, await transport.getGroupMetadata(groupId));
    }
    // Repli sur l'accès socket direct pour les transports qui n'exposent que Baileys
    if (transport.sock) {
      return normalizeGroupMetadata(groupId, await transport.sock.groupMetadata(groupId));
    }
    throw new Error(
      `[TransportManager] getGroupMetadata non supporté par le transport ${sourceChannel || 'par défaut'}`,
    );
  }

  // --- Proxy methods for default/target transport ---

  async sendText(
    channelId: string,
    text: string,
    options: SendTextOptions = {},
    sourceChannel?: string,
  ) {
    return this._requireTransport(sourceChannel).sendText(channelId, text, options);
  }

  async sendUniversalResponse(
    channelId: string,
    response: UniversalResponse,
    options: SendTextOptions = {},
    sourceChannel?: string,
  ) {
    return this._requireTransport(sourceChannel).sendUniversalResponse(
      channelId,
      response,
      options,
    );
  }

  async setPresence(channelId: string, presence: string, sourceChannel?: string) {
    return this._requireTransport(sourceChannel).setPresence(channelId, presence);
  }

  async sendReaction(channelId: string, key: unknown, emoji: string, sourceChannel?: string) {
    return this._requireTransport(sourceChannel).sendReaction(channelId, key, emoji);
  }

  async sendMedia(
    channelId: string,
    media: Buffer | string,
    options: SendMediaOptions = {},
    sourceChannel?: string,
  ) {
    return this._requireTransport(sourceChannel).sendMedia(channelId, media, options);
  }

  async sendVoiceNote(
    channelId: string,
    audio: Buffer | string,
    options: SendVoiceNoteOptions = {},
    sourceChannel?: string,
  ) {
    return this._requireTransport(sourceChannel).sendVoiceNote(channelId, audio, options);
  }

  async sendFile(
    channelId: string,
    filePath: string,
    fileName: string,
    caption: string = '',
    sourceChannel?: string,
  ) {
    const cwd = process.cwd();
    const allowedRoots = [
      resolveWithinRoot(cwd, 'storage_hm'),
      resolveWithinRoot(cwd, 'temp'),
      resolveWithinRoot(cwd, 'hm_storage'),
      resolveWithinRoot(cwd, 'Sandbox1'),
    ];
    const canonicalPath = allowedRoots.reduce<string | null>((resolved, root) => {
      if (resolved) return resolved;
      try {
        return resolveWithinRoot(root, filePath);
      } catch {
        return null;
      }
    }, null);

    if (!canonicalPath) {
      throw new Error(`[TransportManager] Refusing file outside allowed output roots: ${filePath}`);
    }

    const transport = this._requireTransport(sourceChannel);
    const sendFile = transport.sendFile.bind(transport);
    return sendFile(channelId, canonicalPath, fileName, caption);
  }

  async downloadMedia(message: MessageData, sourceChannel?: string): Promise<Buffer | null> {
    return this._requireTransport(sourceChannel || message.sourceChannel).downloadMedia(message);
  }

  async downloadQuotedMedia(message: MessageData, sourceChannel?: string): Promise<Buffer | null> {
    const transport = this._requireTransport(sourceChannel || message.sourceChannel);
    if (typeof transport.downloadQuotedMedia === 'function') {
      return transport.downloadQuotedMedia(message);
    }
    return null;
  }

  async sendSticker(channelId: string, stickerBuffer: Buffer, sourceChannel?: string) {
    return this._requireTransport(sourceChannel).sendSticker(channelId, stickerBuffer);
  }

  async isAdmin(groupId: string, userId: string, sourceChannel?: string) {
    return this._requireTransport(sourceChannel).isAdmin(groupId, userId);
  }

  async disconnect() {
    const disconnectPromises = this.activeTransports.map(async (name) => {
      const transport = this.transports.get(name);
      if (transport && typeof transport.disconnect === 'function') {
        await transport.disconnect();
      }
      // Arrêter le serveur WebSocket si c'est le canal TUI
      if (name === 'ink-cli' || name === 'tui') {
        try {
          const { tuiServerTransport } = await import('./TuiServerTransport.js');
          await tuiServerTransport.stop();
        } catch (e: unknown) {
          console.error(
            '[TransportManager] Erreur arrêt TuiServerTransport:',
            e instanceof Error ? e.message : String(e),
          );
        }
      }
    });
    await Promise.all(disconnectPromises);
  }
}

export const transportManager = new TransportManager();
