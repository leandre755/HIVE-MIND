// Implémentation concrète du transport utilisant @whiskeysockets/baileys

import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay,
  downloadMediaMessage,
  isRealMessage,
  type WAMessage,
  type GroupMetadata,
  type proto,
  type AuthenticationState,
  type AnyMessageContent,
  type BaileysEvent,
  type MiscMessageGenerationOptions,
  type WAMediaUpload,
} from '@whiskeysockets/baileys';
import createPinoLogger from 'pino';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import swarm from '../concurrency/SwarmDispatcher.js';
import type { ServiceContainer } from '../ServiceContainer.js';
import type {
  MessageCallback,
  TransportGroupEvent,
  SendTextOptions,
  SendMediaOptions,
  SendVoiceNoteOptions,
} from './interface.js';
import type { UniversalResponse, MessageData } from '../types/BotTypes.js';

/**
 * Contenu audio PTT étendu : au runtime, Baileys propage `waveform` vers le champ
 * proto `AudioMessage.waveform` via le spread `uploadData = {...message}`, mais ne
 * l'expose pas dans `AnyMessageContent`.
 */
type PttAudioMessageContent = Extract<AnyMessageContent, { audio: WAMediaUpload }> & {
  waveform?: Uint8Array;
};

/** Événements Baileys enregistrés par ce transport (nettoyage ciblé des listeners). */
const REGISTERED_SOCKET_EVENTS: readonly BaileysEvent[] = [
  'creds.update',
  'connection.update',
  'messages.upsert',
  'messages.reaction',
  'messages.update',
  'contacts.upsert',
  'contacts.update',
  'group-participants.update',
];

/**
 * Génère une waveform (64 valeurs Uint8) à partir d'un fichier audio via FFmpeg
 * Décode l'audio en PCM pour obtenir de vrais échantillons (pas les bytes bruts du conteneur)
 */
async function generateWaveformFromFile(audioPath: string): Promise<Uint8Array | null> {
  const WAVEFORM_SIZE = 64;
  try {
    const { execFileSync } = await import('child_process');
    const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg');

    // Décoder l'audio en PCM 16-bit mono 8kHz via execFileSync (args séparés = zéro injection shell)
    const pcmBuffer = execFileSync(
      ffmpegInstaller.default.path,
      ['-i', audioPath, '-f', 's16le', '-ac', '1', '-ar', '8000', '-'],
      { maxBuffer: 2 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] },
    );

    if (!pcmBuffer || pcmBuffer.length < 200) return null;

    // Chaque sample = 2 bytes (16-bit signed LE)
    const totalSamples = Math.floor(pcmBuffer.length / 2);
    const samplesPerSegment = Math.floor(totalSamples / WAVEFORM_SIZE);

    let maxRms = 0;
    const rmsValues: number[] = [];

    for (let i = 0; i < WAVEFORM_SIZE; i++) {
      const offset = i * samplesPerSegment * 2;
      let sumSquares = 0;

      for (let j = 0; j < samplesPerSegment && offset + j * 2 + 1 < pcmBuffer.length; j++) {
        const sample = pcmBuffer.readInt16LE(offset + j * 2);
        sumSquares += sample * sample;
      }

      const rms = Math.sqrt(sumSquares / samplesPerSegment);
      rmsValues.push(rms);
      if (rms > maxRms) maxRms = rms;
    }

    // Normaliser entre 0 et 100 (WhatsApp attend des valeurs 0-127, Baileys utilise 0-100)
    const normalized = rmsValues.map((rms) =>
      maxRms > 0 ? Math.max(1, Math.min(100, Math.round((rms / maxRms) * 100))) : 15,
    );

    return Uint8Array.from(normalized);
  } catch (e: unknown) {
    console.warn(
      '[Baileys] FFmpeg waveform generation failed:',
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

// DTC Phase 1: Nouveaux services unifiés
// import { userService } from '../../services/userService.js'; // REMOVED FOR DI
// import { groupService } from '../../services/groupService.js'; // REMOVED FOR DI
import { eventBus, BotEvents } from '../events.js';
import { formatForWhatsApp, sanitizeForWhatsApp } from '../../utils/helpers.js';
import { AudioHandler } from './handlers/audioHandler.js';
import { AntiDeleteHandler } from './handlers/antiDeleteHandler.js';
import { IdentityMap } from '../../services/state/IdentityMap.js';
import { safeMkdirSync, safeReadFileSync } from '../../utils/safeFs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDebug = process.env.DEBUG === 'true';

/** Type socket Baileys */
export type WASocket = ReturnType<typeof makeWASocket>;

/** Configuration de protection anti-backlog */
interface BacklogProtectionConfig {
  enabled?: boolean;
  message_stale_threshold_seconds?: number;
  max_messages_on_startup?: number;
}

/** Configuration Baileys locale */
interface BaileysConfig {
  bot_name?: string;
  backlog_protection?: BacklogProtectionConfig;
  [key: string]: unknown;
}

/** Message normalisé interne au transport Baileys */
interface NormalizedMessage extends MessageData {
  pushName?: string;
  type: string;
  mentionedJids: string[];
  timestamp: number;
  isTranscribed?: boolean;
  useNativeAudio?: boolean;
  audioBuffer?: Buffer;
}

/** Structure de présence WhatsApp */
type WAPresenceType = 'composing' | 'recording' | 'paused' | 'available' | 'unavailable';
const PRESENCE_MAP = new Map<string, WAPresenceType>([
  ['composing', 'composing'],
  ['typing', 'composing'],
  ['recording', 'recording'],
  ['paused', 'paused'],
  ['available', 'available'],
  ['unavailable', 'unavailable'],
]);

// Charger la configuration de protection contre le backlog
let config: BaileysConfig;
try {
  config = JSON.parse(
    safeReadFileSync(join(__dirname, '..', '..', 'config', 'config.json'), 'utf-8'),
  );
} catch {
  config = {
    backlog_protection: {
      enabled: true,
      message_stale_threshold_seconds: 120,
      max_messages_on_startup: 10,
    },
  };
}

class BaileysTransport extends EventEmitter {
  sock: WASocket | null;
  messageCallback: MessageCallback | null;
  groupEventCallback: ((event: TransportGroupEvent) => void) | null;
  connectionTime: number | null;
  backlogMessagesIgnored: number;
  container: ServiceContainer | null;
  isConnecting: boolean;
  state: AuthenticationState | null;
  saveCreds: (() => Promise<void>) | null;
  reconnectAttempts: number;
  audioHandler: AudioHandler;
  antiDeleteHandler: AntiDeleteHandler;

  constructor() {
    super();
    this.sock = null;
    this.messageCallback = null;
    this.groupEventCallback = null;
    this.connectionTime = null; // Timestamp de la dernière connexion
    this.backlogMessagesIgnored = 0; // Compteur de messages ignorés
    this.container = null; // DI Container
    this.isConnecting = false; // Guard to prevent parallel connections
    // State management
    this.state = null;
    this.saveCreds = null;
    this.reconnectAttempts = 0;
    this.audioHandler = new AudioHandler(this, this.logger);
    this.antiDeleteHandler = new AntiDeleteHandler(this, this.logger);
  }

  setContainer(container: ServiceContainer) {
    this.container = container;
  }

  // [COMPATIBILITY] Rétablissement des méthodes legacy
  onMessage(callback: MessageCallback) {
    this.messageCallback = callback;
    // FIX: Ne pas doubler avec this.on('message', callback) car on appelle déjà messageCallback explicitement
  }

  onGroupEvent(callback: (event: TransportGroupEvent) => void) {
    this.groupEventCallback = callback;
  }

  /**
   * Alias de compatibilité pour BotCore qui attend sendPresenceUpdate
   */
  async sendPresenceUpdate(chatId: string, type: string) {
    return this.setPresence(chatId, type);
  }

  get userService() {
    return this.container?.get('userService');
  }

  get groupService() {
    return this.container?.get('groupService');
  }

  get adminService() {
    return this.container?.get('adminService');
  }

  get logger() {
    const l = (this.container?.get('logger') || console) as unknown as Record<string, unknown>;
    let logFn: (m: string) => void = console.log;
    if (typeof l.log === 'function') {
      logFn = (l.log as (m: string) => void).bind(l);
    } else if (typeof l.info === 'function') {
      logFn = (l.info as (m: string) => void).bind(l);
    }
    const warnFn =
      typeof l.warn === 'function' ? (l.warn as (m: string) => void).bind(l) : console.warn;
    const errorFn =
      typeof l.error === 'function' ? (l.error as (m: string) => void).bind(l) : console.error;
    return { log: logFn, warn: warnFn, error: errorFn };
  }

  /**
   * Connecte au service WhatsApp via Baileys.
   * Ne retourne pas le socket : `ITransport.connect()` est typé `Promise<void>` et aucun
   * appelant ne consommait la valeur (`this.sock` reste accessible sur l'instance).
   */
  async connect(sessionPath: string = 'session'): Promise<void> {
    // Guard: Prevent multiple simultaneous connection attempts
    if (this.isConnecting) {
      console.log('[Baileys] Connexion déjà en cours, ignoré.');
      return;
    }
    this.isConnecting = true;

    // CLEANUP COMPLET : End previous socket to prevent listener accumulation
    await this._cleanupPreviousSocket();

    // Connexion silencieuse pour ne pas casser la barre de progression
    safeMkdirSync(sessionPath, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    // L'authentification WhatsApp est désormais pilotée par le menu au démarrage
    // (src/cli/startupMenu.ts) qui crée la session via whatsappAuthHelper. Si le
    // transport est démarré sans session valide (menu skippé en headless/Railway
    // ou Skip sans connexion), on échoue proprement au lieu d'afficher un QR code
    // automatique que personne ne scannera en mode serveur.
    if (!state.creds.registered) {
      this.isConnecting = false;
      throw new Error(
        'Aucune session WhatsApp valide. Connectez-vous via le menu au démarrage (npm start) en TTY local, puis redémarrez.',
      );
    }

    this.state = state;
    this.saveCreds = saveCreds;

    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      auth: this.state,
      logger: createPinoLogger({ level: 'silent' }),
      printQRInTerminal: false,
      browser: [config.bot_name || 'HIVE-MIND', 'Chrome', '1.0.0'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      emitOwnEvents: true,
      markOnlineOnConnect: true,
      retryRequestDelayMs: 5000,
      version,
      syncFullAppState: false,
    } as Parameters<typeof makeWASocket>[0]);

    // Sauvegarde automatique des credentials
    this.sock.ev.on('creds.update', this.saveCreds);

    // Gestion de la connexion
    this.sock.ev.on('connection.update', (update: Record<string, unknown>) =>
      this._handleConnectionUpdate(update, sessionPath),
    );

    // Setup event listeners
    this._setupMessageListeners();
    this._setupContactSync();
    this._setupGroupParticipantsListener();
  }

  /**
   * Nettoie le socket précédent avant une reconnexion
   */
  private async _cleanupPreviousSocket(): Promise<void> {
    if (!this.sock) return;
    try {
      console.log("[Baileys] Nettoyage de l'ancienne connexion...");
      this._removeRegisteredListeners();
      this.sock.end(new Error('Reconnecting'));
      this.sock = null;
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[Baileys] Erreur cleanup:', msg);
    }
  }

  /**
   * Gère les événements de mise à jour de connexion (open, close)
   */
  private _handleConnectionUpdate(update: Record<string, unknown>, sessionPath: string): void {
    const { connection, lastDisconnect } = update as {
      connection?: string;
      lastDisconnect?: { error?: { output?: { statusCode?: number }; message?: string } };
    };

    if (connection === 'close') {
      this._handleDisconnect(lastDisconnect, sessionPath);
    } else if (connection === 'open') {
      this._handleConnectionOpen();
    }
  }

  /**
   * Gère la déconnexion et la logique de reconnexion
   */
  private _handleDisconnect(
    lastDisconnect: { error?: { output?: { statusCode?: number }; message?: string } } | undefined,
    sessionPath: string,
  ): void {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

    console.log(
      `[Baileys] Déconnexion (statusCode: ${statusCode ?? 'undefined'}, reason: ${lastDisconnect?.error?.message ?? 'unknown'})`,
    );
    eventBus.publish(BotEvents.DISCONNECTED, { shouldReconnect });

    // Cas "Stream Errored" (conflict Error 440)
    if (lastDisconnect?.error?.message === 'Stream Errored (conflict)' || statusCode === 440) {
      this.logger.error('\x1b[31m[Baileys:CRITICAL] Session conflict detected (Error 440).\x1b[0m');
      this.logger.error(
        '\x1b[31m[Baileys:CRITICAL] This usually means another instance of this bot is running.\x1b[0m',
      );
      this.logger.error(
        '\x1b[31m[Baileys:CRITICAL] Please kill all other instances and restart.\x1b[0m',
      );
      this.isConnecting = false;
      eventBus.publish(BotEvents.FATAL_TRANSPORT_CONFLICT, {
        reason: 'Session conflict (Error 440)',
        requiresManualRestart: true,
      });
      return;
    }

    this.isConnecting = false;

    if (shouldReconnect) {
      const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      this.reconnectAttempts += 1;
      console.log(`Reconnexion dans ${delayMs / 1000}s...`);
      setTimeout(() => {
        this.connect(sessionPath).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('Echec reconnexion:', msg);
        });
      }, delayMs);
    } else {
      console.log('[Baileys] Déconnexion définitive (loggedOut)');
    }
  }

  /**
   * Gère l'établissement de connexion réussi
   */
  private _handleConnectionOpen(): void {
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.connectionTime = Math.floor(Date.now() / 1000);
    this.backlogMessagesIgnored = 0;

    // [CONSCIOUSNESS] Définir l'identité du bot
    if (this.container?.has('consciousness')) {
      const consciousness = this.container.get('consciousness');
      consciousness.setIdentity(this.sock!.user || null);
    }

    // [LID HYDRATION] Warm the JID->LID reverse cache
    const botJid = this.sock!.user?.id;
    const botLid = this.sock!.user?.lid;
    if (botJid && botLid) {
      this.userService?.registerLid(botJid, botLid).catch(() => {});
    } else if (botJid) {
      IdentityMap.hydrateLidCache(botJid).catch(() => {});
    }

    this.emit('connection_ready', {
      botJid,
      connectionTime: this.connectionTime,
    });
    this.sock!.sendPresenceUpdate('available');
    eventBus.publish(BotEvents.CONNECTED);
  }

  /**
   * Configure les listeners pour les messages entrants, réactions et anti-delete
   */
  private _setupMessageListeners(): void {
    if (!this.sock) return;

    // Monitor encryption errors
    this.sock.ev.on(
      'messages.upsert',
      async ({ messages: _msgs }: { messages: WAMessage[]; type: string }) => {
        // Possible decryption error metadata or protocol noisiness — intentionally no-op
      },
    );

    // Main message handler
    this.sock.ev.on(
      'messages.upsert',
      async ({ messages, type }: { messages: WAMessage[]; type: string }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
          await this._processIncomingMessage(msg);
        }
      },
    );

    // Reaction handler
    this.sock.ev.on('messages.reaction', (reactions) => {
      for (const reaction of reactions) {
        if (!reaction.key.fromMe) continue;
        const reactionData = {
          chatId: reaction.key.remoteJid,
          messageId: reaction.key.id,
          sender: reaction.key.participant || reaction.key.remoteJid,
          reaction: reaction.reaction.text,
          timestamp: reaction.reaction.senderTimestampMs,
        };
        console.log(
          `[Baileys] Réaction reçue: ${reactionData.reaction} dans ${reactionData.chatId} (sur message bot)`,
        );
        eventBus.publish(BotEvents.REACTION_RECEIVED, reactionData);
      }
    });

    // Anti-delete handler
    this.sock.ev.on(
      'messages.update',
      async (updates: Array<{ update: Partial<WAMessage>; key: proto.IMessageKey }>) => {
        await this.antiDeleteHandler.handleUpdate(updates);
      },
    );
  }

  /**
   * Filtres d'entrée : statuts/stories, réactions non ciblées, messages sortants,
   * messages de protocole et contenus vides.
   * @returns true si le message doit être ignoré.
   */
  private _shouldSkipMessage(msg: WAMessage): boolean {
    // Ignorer les statuts WhatsApp (Stories)
    if ((msg.key?.remoteJid || 'UNKNOWN') === 'status@broadcast') return true;

    // Filtrer les réactions non ciblées
    if (msg.message?.reactionMessage && !msg.message.reactionMessage.key?.fromMe) return true;
    if (msg.key.fromMe) return true;

    // Filtrage des messages de protocole/système
    if (!isRealMessage(msg, this.sock?.user?.id ?? '')) return true;

    // Vérification de sécurité supplémentaire
    if (!msg.message) {
      console.warn('[Baileys] Message passed isRealMessage but has no content - investigating');
      console.warn('[Baileys] Message keys:', Object.keys(msg));
      return true;
    }

    return false;
  }

  /**
   * Publie le message normalisé vers le SwarmDispatcher, l'eventBus et l'EventEmitter local.
   * No-op si le message n'a ni texte ni audio natif exploitable.
   */
  private _dispatchMessage(normalizedMsg: NormalizedMessage): void {
    if (!normalizedMsg.text && !normalizedMsg.useNativeAudio) return;

    swarm
      .dispatch(normalizedMsg.chatId, normalizedMsg, async () => {
        if (this.messageCallback) {
          await this.messageCallback(normalizedMsg as MessageData);
        }
        eventBus.publish(BotEvents.MESSAGE_RECEIVED, normalizedMsg);
        this.emit('message', normalizedMsg);
      })
      .catch((err: unknown) => {
        console.error('[Baileys] Error processing message in Swarm:', err);
      });
  }

  /**
   * Traite un message entrant individuel
   */
  private async _processIncomingMessage(msg: WAMessage): Promise<void> {
    try {
      if (this._shouldSkipMessage(msg)) return;

      // [REFACTOR] Centralized Robust Normalization
      const normalizedMsg = this._normalizeMessage(msg);

      console.log(
        `[Baileys] Type=${normalizedMsg.type}, chatId=${normalizedMsg.chatId}, isGroup=${normalizedMsg.isGroup}`,
      );

      // 1. MISE À JOUR SOCIALE (USER)
      if (this.userService) {
        await this.userService.recordInteraction(
          normalizedMsg.sender,
          normalizedMsg.pushName || '',
          normalizedMsg.isGroup ? normalizedMsg.chatId : null,
        );
      }

      // 2. AUTO-DISCOVERY (GROUPES)
      await this._handleGroupAutoDiscovery(normalizedMsg);

      // Filtre anti-backlog
      if (this._isMessageStale(msg)) return;

      // 3. TRANSCRIPTION & AUDIO HANDLING (V6)
      if (normalizedMsg.mediaType === 'audio') {
        const transcribedText = await this.audioHandler.processAudioMessage(msg, normalizedMsg);
        if (transcribedText) {
          normalizedMsg.text = transcribedText;
          normalizedMsg.isTranscribed = true;
        }
      }

      // ANTI-DELETE: Store message synchronously
      try {
        await this.antiDeleteHandler.storeMessage(normalizedMsg);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn('[Baileys] Erreur AntiDelete store:', errMsg);
      }

      this._dispatchMessage(normalizedMsg);

      // ACCUSÉS DE RÉCEPTION
      await this._sendReceipts(msg);
    } catch (err: unknown) {
      console.error('[Baileys] Erreur traitement message:', err);
    }
  }

  /**
   * Auto-discovery des métadonnées de groupe
   */
  private async _handleGroupAutoDiscovery(normalizedMsg: NormalizedMessage): Promise<void> {
    if (!normalizedMsg.isGroup || !this.groupService) return;

    const needsUpdate = await this.groupService.needsUpdate(normalizedMsg.chatId);
    if (!needsUpdate) return;

    try {
      const metadata = await this.sock!.groupMetadata(normalizedMsg.chatId);
      await this.groupService.updateGroup(normalizedMsg.chatId, metadata);
    } catch (err: unknown) {
      if (isDebug) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Discovery] Echec recup metadata groupe: ${errMsg}`);
      }
    }
  }

  /**
   * Vérifie si un message est trop ancien (anti-backlog)
   */
  private _isMessageStale(msg: WAMessage): boolean {
    if (!config.backlog_protection?.enabled || !this.connectionTime) return false;

    const messageTimestamp = msg.messageTimestamp as number;
    const now = Math.floor(Date.now() / 1000);
    const messageAge = now - messageTimestamp;
    const threshold = config.backlog_protection.message_stale_threshold_seconds ?? 120;

    if (messageAge > threshold) {
      this.backlogMessagesIgnored++;
      return true;
    }
    return false;
  }

  /**
   * Envoie les accusés de réception (humanisation)
   */
  private async _sendReceipts(msg: WAMessage): Promise<void> {
    try {
      const sendReadReceipts = process.env.SEND_READ_RECEIPTS === 'true';
      if (sendReadReceipts) {
        await this.sock!.readMessages([msg.key]);
      }
    } catch (receiptErr: unknown) {
      if (process.env.DEBUG === 'true') {
        const errMsg = receiptErr instanceof Error ? receiptErr.message : String(receiptErr);
        console.warn('[Baileys] Erreur envoi récépissé:', errMsg);
      }
    }
  }

  /**
   * Configure les listeners de synchronisation des contacts
   */
  private _setupContactSync(): void {
    if (!this.sock) return;

    this.sock.ev.on('contacts.upsert', async (contacts: Array<{ id?: string; lid?: string }>) => {
      if (!this.userService) return;
      for (const contact of contacts) {
        if (contact.id && contact.lid) {
          this.userService.registerLid(contact.id, contact.lid).catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[Baileys:Contacts] Error registering LID: ${msg}`);
          });
        }
      }
    });

    this.sock.ev.on('contacts.update', async (updates: Array<{ id?: string; lid?: string }>) => {
      if (!this.userService) return;
      for (const update of updates) {
        if (update.id && update.lid) {
          this.userService.registerLid(update.id, update.lid).catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[Baileys:Contacts] Error registering LID: ${msg}`);
          });
        }
      }
    });
  }

  /**
   * Configure le listener des événements de groupe (join/leave/promote/demote)
   */
  private _setupGroupParticipantsListener(): void {
    if (!this.sock) return;

    const eventMap = new Map<string, string>([
      ['add', BotEvents.GROUP_JOIN],
      ['remove', BotEvents.GROUP_LEAVE],
      ['promote', BotEvents.GROUP_PROMOTE],
      ['demote', BotEvents.GROUP_DEMOTE],
    ]);

    this.sock.ev.on(
      'group-participants.update',
      async (event: { id: string; participants: string[]; action: string }) => {
        const normalizedEvent: TransportGroupEvent = {
          groupId: event.id,
          participants: event.participants,
          action: event.action,
          timestamp: Date.now(),
        };

        if (this.groupEventCallback) {
          this.groupEventCallback(normalizedEvent);
        }

        const botEvent = eventMap.get(event.action);
        if (botEvent) {
          eventBus.publish(botEvent, normalizedEvent);
        }
      },
    );
  }

  /**
   * Normalise un message Baileys vers un format standard
   */
  _normalizeMessage(msg: WAMessage): NormalizedMessage {
    const chatId = msg.key.remoteJid || '';
    const sender = msg.key.participant || msg.key.remoteJid || '';
    const content = BaileysTransport._unwrapContent(msg.message);
    const contextInfo = BaileysTransport._extractContextInfo(content);

    return {
      id: msg.key.id || undefined,
      chatId,
      sender,
      senderName: msg.pushName || sender.split('@')[0],
      pushName: msg.pushName ?? undefined,
      text: BaileysTransport._extractText(content),
      isGroup: chatId.endsWith('@g.us'),
      type: msg.message ? Object.keys(msg.message)[0] : 'unknown',
      mediaType: BaileysTransport._detectMediaType(content),
      quotedMsg: BaileysTransport._buildQuotedMsg(contextInfo),
      mentionedJids: contextInfo?.mentionedJid || [],
      timestamp: msg.messageTimestamp as number,
      raw: msg,
    };
  }

  /**
   * Déballe les enveloppes Baileys (Ephemeral, ViewOnce, DocumentWithCaption)
   * pour atteindre le contenu réel du message.
   */
  private static _unwrapContent(message: proto.IMessage | null | undefined): proto.IMessage | null {
    let realMessage = message ?? null;
    if (realMessage?.ephemeralMessage) {
      realMessage = realMessage.ephemeralMessage.message ?? null;
    }
    if (realMessage?.viewOnceMessage) {
      realMessage = realMessage.viewOnceMessage.message ?? null;
    }
    if (realMessage?.viewOnceMessageV2) {
      realMessage = realMessage.viewOnceMessageV2.message ?? null;
    }
    if (realMessage?.documentWithCaptionMessage) {
      realMessage = realMessage.documentWithCaptionMessage.message ?? null;
    }
    return realMessage;
  }

  /**
   * Extrait le texte utile (corps ou légende) d'un contenu de message.
   */
  private static _extractText(content: proto.IMessage | null): string {
    return (
      content?.conversation ||
      content?.extendedTextMessage?.text ||
      content?.imageMessage?.caption ||
      content?.videoMessage?.caption ||
      ''
    );
  }

  /**
   * Détermine le type de média porté par le message, ou undefined si texte pur.
   */
  private static _detectMediaType(content: proto.IMessage | null): string | undefined {
    if (content?.imageMessage) return 'image';
    if (content?.videoMessage) return 'video';
    if (content?.audioMessage) return 'audio';
    if (content?.documentMessage) return 'document';
    if (content?.stickerMessage) return 'sticker';
    return undefined;
  }

  /**
   * Récupère le contextInfo, quel que soit le sous-type de message porteur.
   */
  private static _extractContextInfo(content: proto.IMessage | null): proto.IContextInfo | null {
    return (
      content?.extendedTextMessage?.contextInfo ||
      content?.imageMessage?.contextInfo ||
      content?.videoMessage?.contextInfo ||
      content?.audioMessage?.contextInfo ||
      content?.documentMessage?.contextInfo ||
      content?.stickerMessage?.contextInfo ||
      null
    );
  }

  /**
   * Construit la structure de message cité, ou null si le message n'en cite aucun.
   */
  private static _buildQuotedMsg(contextInfo: proto.IContextInfo | null): {
    text: string;
    sender: string;
    message: proto.IMessage | null;
    id: string;
  } | null {
    if (!contextInfo?.stanzaId || !contextInfo?.participant) return null;

    return {
      text:
        contextInfo.quotedMessage?.conversation ||
        contextInfo.quotedMessage?.extendedTextMessage?.text ||
        '',
      sender: contextInfo.participant,
      message: contextInfo.quotedMessage || null,
      id: contextInfo.stanzaId,
    };
  }

  /**
   * Envoie un message texte avec résolution automatique des @mentions
   */
  async sendText(chatId: string, text: string, options: SendTextOptions = {}) {
    return this._executeSendText(chatId, text, options);
  }

  /**
   * Envoie une réponse universelle formatée pour WhatsApp
   */
  async sendUniversalResponse(
    chatId: string,
    response: UniversalResponse,
    options: SendTextOptions = {},
  ) {
    let text = response.plainText || response.markdown;

    // 1. Sanitize
    text = sanitizeForWhatsApp(text);

    // 2. Format
    text = formatForWhatsApp(text);

    return this._executeSendText(chatId, text, options);
  }

  async sendMedia(chatId: string, media: Buffer | string, options: SendMediaOptions = {}) {
    if (!this.sock) {
      console.error('[Baileys] ❌ Erreur sendMedia: Socket non initialisé');
      return {};
    }

    try {
      const type = options.type || 'image';

      // Résolution de la source média
      let mediaSource: WAMediaUpload;
      if (
        typeof media === 'string' &&
        (media.startsWith('http') || media.startsWith('/') || media.includes('./'))
      ) {
        mediaSource = { url: media };
      } else if (typeof media === 'string') {
        mediaSource = Buffer.from(media);
      } else {
        mediaSource = media;
      }

      // Union discriminée : chaque branche construit le type concret attendu
      let message: AnyMessageContent;
      if (type === 'video') {
        message = { video: mediaSource, caption: options.caption };
      } else if (type === 'audio') {
        message = {
          audio: mediaSource,
          ptt: options.ptt || false,
          mimetype: options.mimetype || 'audio/mp4',
        };
      } else if (type === 'document') {
        message = {
          document: mediaSource,
          fileName: options.fileName || 'document',
          mimetype: options.mimetype || 'application/octet-stream',
          caption: options.caption,
        };
      } else {
        message = { image: mediaSource, caption: options.caption };
      }

      const socketOptions: MiscMessageGenerationOptions = {};
      if (options.reply) socketOptions.quoted = options.reply as WAMessage;

      return await this.sock.sendMessage(chatId, message, socketOptions);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Baileys] Erreur sendMedia:', errMsg);
      return {};
    }
  }

  async sendSticker(chatId: string, stickerBuffer: Buffer) {
    if (!this.sock) {
      console.error('[Baileys] ❌ Erreur sendSticker: Socket non initialisé');
      return {};
    }

    try {
      return await this.sock.sendMessage(chatId, {
        sticker: stickerBuffer,
      });
    } catch (error: unknown) {
      console.error('[Baileys] Erreur sendSticker:', error);
      return {};
    }
  }

  async downloadMedia(message: MessageData | WAMessage) {
    if (!message || (!(message as MessageData).raw && !(message as WAMessage).message)) {
      throw new Error('Message object is invalid for media download');
    }
    if (!this.sock) {
      throw new Error('Socket not initialized for media download');
    }
    const rawMessage = (message as MessageData).raw || message;
    return await downloadMediaMessage(
      rawMessage as WAMessage,
      'buffer',
      {},
      {
        logger: this.sock.logger,
        reuploadRequest: this.sock.updateMediaMessage,
      },
    );
  }

  async downloadQuotedMedia(message: MessageData): Promise<Buffer | null> {
    if (!message || !message.quotedMsg || !message.raw) {
      return null;
    }

    const rawMsg = message.raw as WAMessage;
    const contextInfo =
      rawMsg.message?.extendedTextMessage?.contextInfo ||
      rawMsg.message?.imageMessage?.contextInfo ||
      rawMsg.message?.videoMessage?.contextInfo ||
      rawMsg.message?.documentMessage?.contextInfo;

    const quotedMsgRaw = contextInfo?.quotedMessage;
    const stanzaId = contextInfo?.stanzaId;

    if (!quotedMsgRaw || !stanzaId) return null;
    if (!this.sock) return null;

    const fakeRawMessage = {
      key: { ...rawMsg.key, id: stanzaId },
      message: quotedMsgRaw,
    };

    return await downloadMediaMessage(
      fakeRawMessage as WAMessage,
      'buffer',
      {},
      {
        logger: this.sock.logger,
        reuploadRequest: this.sock.updateMediaMessage,
      },
    );
  }

  async isAdmin(groupId: string, userId: string) {
    try {
      const metadata = await this.getGroupMetadata(groupId);
      if (!metadata || !metadata.participants) return false;

      const participant = metadata.participants.find(
        (p: { id: string; admin?: string | null }) => p.id === userId,
      );
      return participant
        ? participant.admin === 'admin' || participant.admin === 'superadmin'
        : false;
    } catch (error) {
      console.error('[Baileys] Erreur dans isAdmin:', error);
      return false;
    }
  }

  /**
   * Méthode d'exécution interne pour l'envoi de texte
   */
  async _executeSendText(chatId: string, text: string, options: SendTextOptions = {}) {
    if (!text) return;

    // SPLITTING : Gestion des messages trop longs (WhatsApp limit ~65536, mais pour UX ~4096)
    const MAX_LENGTH = 4000;
    if (text.length > MAX_LENGTH) {
      return this._sendLongText(chatId, text, options, MAX_LENGTH);
    }

    // Formatage automatique
    let formattedText = formatForWhatsApp(text);
    let mentions = (options.mentions as string[]) || [];

    // Résolution des @mentions (groupes uniquement)
    if (chatId.endsWith('@g.us') && this.container) {
      const resolved = await this._resolveMentions(chatId, formattedText, mentions);
      formattedText = resolved.text;
      mentions = resolved.mentions;
    }

    const message: Extract<AnyMessageContent, { text: string }> = { text: formattedText };
    if (mentions.length > 0) {
      message.mentions = mentions;
    }

    const socketOptions: MiscMessageGenerationOptions = {};
    if (options.reply) {
      socketOptions.quoted = options.reply as WAMessage;
    }

    const sent = await this.sock!.sendMessage(chatId, message, socketOptions);
    eventBus.publish(BotEvents.MESSAGE_SENT, { chatId, text });
    return sent;
  }

  /**
   * Envoie un message long en le découpant en morceaux
   */
  private async _sendLongText(
    chatId: string,
    text: string,
    options: SendTextOptions,
    maxLength: number,
  ): Promise<unknown> {
    console.log(`[Baileys] Message trop long (${text.length} chars), découpage...`);

    // Découpage par slice (pas de RegExp dynamique) : préserve les sauts de ligne,
    // que le pattern `.{1,N}` supprimait car `.` n'englobe pas `\n`.
    const chunks: string[] = [];
    for (let offset = 0; offset < text.length; offset += maxLength) {
      chunks.push(text.slice(offset, offset + maxLength));
    }

    let lastSent: unknown = null;
    let isFirstChunk = true;
    for (const chunk of chunks) {
      const chunkOptions = { ...options };
      if (!isFirstChunk) delete chunkOptions.reply;
      isFirstChunk = false;
      lastSent = await this.sendText(chatId, chunk, chunkOptions);
      await delay(500);
    }
    return lastSent;
  }

  /**
   * Résout les @mentions dans un texte pour un groupe
   */
  private async _resolveMentions(
    chatId: string,
    text: string,
    existingMentions: string[],
  ): Promise<{ text: string; mentions: string[] }> {
    let formattedText = text;
    let mentions = [...existingMentions];

    try {
      const groupService = this.container!.get('groupService');
      if (!groupService) return { text: formattedText, mentions };

      const members = await groupService.getGroupMembers(chatId);
      if (!members || members.length === 0) return { text: formattedText, mentions };

      const { resolveMentionsInText } = await import('../../utils/fuzzyMatcher.js');
      const resolved = resolveMentionsInText(
        formattedText,
        members.map((m) => ({ ...m, name: m.name || '', phoneNumber: m.phoneNumber || undefined })),
      );
      if (resolved.mentions.length > 0) {
        formattedText = resolved.text;
        mentions = [...mentions, ...resolved.mentions];
      }

      // Dédoublonnage
      mentions = [...new Set(mentions)];
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn('[Baileys] Erreur résolution mentions:', errMsg);
    }

    return { text: formattedText, mentions };
  }

  /**
   * Envoie une réaction (emoji) sur un message
   * @param {string} chatId
   * @param {Object} key - Clé du message cible
   * @param {string} emoji
   */
  async sendReaction(chatId: string, key: proto.IMessageKey, emoji: string) {
    if (!this.sock) return false;
    try {
      await this.sock.sendMessage(chatId, {
        react: {
          text: emoji,
          key,
        },
      });
      return true;
    } catch (error: unknown) {
      console.error('[Baileys] Erreur sendReaction:', error);
      return false;
    }
  }

  /**
   * Envoie une note vocale (PTT)
   */
  async sendVoice(
    chatId: string,
    audio: Buffer | string | { url: string },
    options: SendVoiceNoteOptions = {},
  ) {
    let audioSource: Buffer | { url: string };
    if (Buffer.isBuffer(audio)) {
      audioSource = audio;
    } else if (typeof audio === 'string') {
      audioSource = { url: audio };
    } else {
      audioSource = audio;
    }

    let waveform: Uint8Array | null = options.waveform ?? null;
    if (!waveform) {
      // Résoudre le chemin du fichier audio pour FFmpeg
      let filePath: string | null = null;
      if (typeof audio === 'string') {
        filePath = audio;
      } else if (
        typeof audio === 'object' &&
        'url' in audio &&
        typeof audio.url === 'string' &&
        !audio.url.startsWith('http')
      ) {
        filePath = audio.url;
      }

      if (filePath) {
        waveform = await generateWaveformFromFile(filePath);
      }
    }
    if (!waveform) {
      // Fallback statique si FFmpeg échoue ou si l'audio est un Buffer/URL distant
      // WhatsApp attend des valeurs 0-100 (max 127), aligné avec Baileys getAudioWaveform
      waveform = Uint8Array.from([
        15, 35, 58, 78, 55, 32, 12, 28, 52, 85, 65, 38, 22, 35, 62, 90, 72, 45, 25, 38, 68, 100, 78,
        48, 28, 42, 72, 95, 65, 35, 15, 32, 55, 85, 68, 42, 24, 33, 57, 82, 62, 37, 20, 30, 52, 78,
        60, 40, 22, 32, 55, 83, 65, 44, 25, 35, 53, 72, 58, 37, 21, 30, 47, 28,
      ]);
    }

    const message: PttAudioMessageContent = {
      audio: audioSource,
      mimetype: options.mimetype || 'audio/ogg; codecs=opus',
      ptt: true, // Affiche comme une note vocale
    };

    if (waveform) {
      message.waveform = waveform;
      const vals = Array.from(waveform) as number[];
      console.log(
        `[Baileys] Waveform: ${waveform.length} samples, range=[${Math.min(...vals)}-${Math.max(...vals)}], first8=[${vals.slice(0, 8).join(',')}]`,
      );
    }

    const socketOptions: MiscMessageGenerationOptions = {};
    if (options.reply) {
      socketOptions.quoted = options.reply as WAMessage;
    }

    if (!this.sock) {
      console.error('[Baileys] ❌ Erreur sendVoice: Socket non initialisé');
      return {};
    }
    return await this.sock.sendMessage(chatId, message, socketOptions);
  }

  /**
   * Alias pour sendVoice compatible avec les plugins V3
   */
  async sendVoiceNote(
    chatId: string,
    audioPath: Buffer | string,
    options: SendVoiceNoteOptions = {},
  ) {
    return this.sendVoice(chatId, audioPath, options);
  }

  /**
   * Envoie un fichier (Document)
   */
  async sendFile(chatId: string, filePath: string, fileName: string, caption: string = '') {
    if (!this.sock) {
      throw new Error('Socket not initialized for sendFile');
    }
    try {
      await this.sock.sendMessage(chatId, {
        document: { url: filePath },
        fileName,
        mimetype: 'application/pdf',
        caption,
      });
      return true;
    } catch (error: unknown) {
      console.error('[Baileys] Erreur sendFile:', error);
      throw error;
    }
  }

  /**
   * Tag tous les membres du groupe
   */
  async tagAll(groupId: string, customMessage: string = '') {
    if (!this.sock) return false;
    try {
      const metadata = await this.getGroupMetadata(groupId);
      const participants = metadata.participants.map((p: { id: string }) => p.id);

      const text = customMessage
        ? `📢 *Annonce Groupe*\n${formatForWhatsApp(customMessage)}`
        : '📢 *Tag All*';

      await this.sock.sendMessage(groupId, {
        text,
        mentions: participants,
      });
      return true;
    } catch (error: unknown) {
      console.error('[Baileys] Erreur TagAll:', error);
      return false;
    }
  }

  /**
   * Envoie un sondage natif
   */
  async sendPoll(chatId: string, name: string, values: string[], selectableCount: number = 1) {
    if (!this.sock) return false;
    try {
      return await this.sock.sendMessage(chatId, {
        poll: {
          name,
          values,
          selectableCount,
        },
      });
    } catch (error: unknown) {
      console.error('[Baileys] Erreur sendPoll:', error);
      return false;
    }
  }

  /**
   * Envoie une fiche contact
   */
  async sendContact(chatId: string, displayName: string, phoneNumber: string) {
    if (!this.sock) return false;
    try {
      // Vcard format minimal
      const vcard =
        'BEGIN:VCARD\n' + // metadata of the contact card
        'VERSION:3.0\n' +
        `FN:${displayName}\n` + // full name
        'ORG:Contact;\n' + // the organization of the contact
        `TEL;type=CELL;type=VOICE;waid=${phoneNumber}:${phoneNumber}\n` + // WhatsApp ID + phone number
        'END:VCARD';

      return await this.sock.sendMessage(chatId, {
        contacts: {
          displayName,
          contacts: [{ vcard }],
        },
      });
    } catch (error: unknown) {
      console.error('[Baileys] Erreur sendContact:', error);
      return false;
    }
  }

  /**
   * Édite un message existant (Le bot ne peut éditer que ses propres messages)
   */
  async editMessage(chatId: string, key: proto.IMessageKey, newText: string) {
    if (!this.sock) return false;
    try {
      return await this.sock.sendMessage(chatId, {
        text: newText,
        edit: key,
      });
    } catch (error: unknown) {
      console.error('[Baileys] Erreur editMessage:', error);
      return false;
    }
  }

  /**
   * Définit le statut de présence (typing, recording, etc.)
   */
  async setPresence(chatId: string, type: string) {
    if (!this.sock) return;

    // Garde stricte : ignorer les JIDs internes/virtuels ou invalides
    // WHY: Only real WhatsApp JIDs (@s.whatsapp.net, @g.us, @lid) are valid targets
    // for Baileys sendPresenceUpdate. Internal system JIDs like 'system_internal_mind'
    // or 'system@internal' must be rejected to prevent jidDecode() crashes.
    const VALID_JID_SUFFIXES = ['@s.whatsapp.net', '@g.us', '@lid', '@broadcast'];
    if (
      !chatId ||
      typeof chatId !== 'string' ||
      !VALID_JID_SUFFIXES.some((suffix) => chatId.endsWith(suffix))
    ) {
      return;
    }

    // Mapping types hive-mind -> baileys (Map: pas d'accès dynamique sur objet)
    const status: WAPresenceType = PRESENCE_MAP.get(type) ?? 'composing';
    console.log(`[Baileys] setPresence: ${status} -> ${chatId}`);
    try {
      await this.sock.sendPresenceUpdate(status, chatId);
      console.log(`[Baileys] ✓ setPresence ${status} sent successfully`);
    } catch (err: unknown) {
      console.warn(
        `[Baileys] Warning setPresence: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * (Module 2) Bannit un utilisateur du groupe
   */
  async banUser(groupId: string, participant: string): Promise<boolean> {
    if (!this.sock) return false;

    try {
      const userJid = await this._resolveParticipantJid(groupId, participant);
      if (!userJid) return false;

      console.log(`[DEBUG Ban] Tentative de ban avec JID: ${userJid}`);

      await this.sock.groupParticipantsUpdate(groupId, [userJid], 'remove');
      return true;
    } catch (error: unknown) {
      console.error('[Baileys] Erreur Ban:', error);
      return false;
    }
  }

  /**
   * Résout un identifiant participant (LID, numéro brut ou JID) en JID WhatsApp réel.
   * @returns Le JID résolu, ou null si le LID est introuvable dans le groupe.
   */
  private async _resolveParticipantJid(
    groupId: string,
    participant: string,
  ): Promise<string | null> {
    console.log(`[DEBUG Ban] Input participant: ${participant}`);

    if (!participant.includes('@lid')) {
      // Numéro simple -> format s.whatsapp.net, sinon JID déjà complet
      return participant.includes('@') ? participant : `${participant}@s.whatsapp.net`;
    }

    const lidNumber = participant.split('@')[0];
    const metadata = await this.getGroupMetadata(groupId);
    console.log(
      '[DEBUG Ban] Participants du groupe:',
      metadata.participants.map((p) => ({ id: p.id, lid: p.lid })),
    );

    const found = metadata.participants.find(
      (p) => p.id.includes(lidNumber) || p.lid?.includes(lidNumber),
    );
    if (!found) {
      console.error(`[Baileys] Impossible de résoudre LID ${lidNumber} en JID`);
      return null;
    }

    console.log(`[DEBUG Ban] Résolu via Group Metadata: ${participant} -> ${found.id}`);
    return found.id;
  }

  /**
   * Promeut un utilisateur en admin
   */
  async promoteUser(groupId: string, userJid: string): Promise<boolean> {
    if (!this.sock) return false;
    try {
      await this.sock.groupParticipantsUpdate(groupId, [userJid], 'promote');
      return true;
    } catch (error: unknown) {
      console.error('[Baileys] Erreur Promote:', error);
      return false;
    }
  }

  /**
   * Rétrograde un admin en membre
   */
  async demoteUser(groupId: string, userJid: string): Promise<boolean> {
    if (!this.sock) return false;
    try {
      await this.sock.groupParticipantsUpdate(groupId, [userJid], 'demote');
      return true;
    } catch (error: unknown) {
      console.error('[Baileys] Erreur Demote:', error);
      return false;
    }
  }

  /**
   * Retire tous les listeners enregistrés par ce transport sur le socket.
   * `BaileysEventEmitter.removeAllListeners` exige un nom d'événement explicite.
   */
  private _removeRegisteredListeners(): void {
    if (!this.sock) return;
    for (const event of REGISTERED_SOCKET_EVENTS) {
      this.sock.ev.removeAllListeners(event);
    }
  }

  /**
   * Récupère les métadonnées d'un groupe (nécessaire pour banUser/resolveMentions)
   */
  async getGroupMetadata(groupId: string): Promise<GroupMetadata> {
    if (!this.sock) throw new Error('Socket not initialized');
    return await this.sock.groupMetadata(groupId);
  }

  /**
   * Termine proprement la connexion WhatsApp
   */
  async disconnect() {
    if (!this.sock) return;

    console.log('[Baileys] 🔌 Déconnexion demandée...');

    try {
      // 1. Flush pending credentials to disk before closing the socket.
      //    A pending creds.update write is lost if sock.end() fires first.
      if (this.saveCreds) {
        await this.saveCreds();
      }

      // 2. Notifier WhatsApp (best-effort): failure must never block socket closure.
      try {
        await this.sock.sendPresenceUpdate('unavailable');
      } catch (presenceErr: unknown) {
        console.warn(
          '[Baileys] sendPresenceUpdate unavailable ignoré:',
          presenceErr instanceof Error ? presenceErr.message : String(presenceErr),
        );
      }

      // 3. Fermer le socket proprement (toujours atteint)
      this.sock.end(undefined);

      // 4. Nettoyer les listeners
      this._removeRegisteredListeners();
      this.sock = null;

      console.log('[Baileys] ✅ Connexion fermée proprement.');
    } catch (error: unknown) {
      console.error(
        '[Baileys] ⚠️ Erreur lors de la déconnexion:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

// Export singleton
const baileysTransport = new BaileysTransport();
export { baileysTransport };
export default baileysTransport;
