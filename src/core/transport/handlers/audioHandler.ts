import { downloadMediaMessage, type WAMessage, type proto } from '@whiskeysockets/baileys';
import createPinoLogger from 'pino';
import { join } from 'path';
import { promises as fsPromises } from 'fs';
import { resolveWithinRoot, safeWriteFile, safeUnlink } from '../../../utils/safeFs.js';
import { workingMemory } from '../../../services/workingMemory.js';
import { botIdentity } from '../../../utils/botIdentity.js';
import { config as globalConfig } from '../../../config/index.js';
import type { ServiceContainer } from '../../ServiceContainer.js';
import type { MessageData } from '../../types/BotTypes.js';

/** Service de transcription tel qu'enregistré dans le ServiceContainer. */
interface TranscriptionService {
  transcribe(filePath: string): Promise<string>;
}

/** Service de groupe : seul `getGroupSettings` est consommé ici. */
interface GroupSettingsReader {
  getGroupSettings(groupJid: string): Promise<Record<string, unknown>>;
}

/** Sous-ensemble du transport Baileys consommé par AudioHandler (découplage : pas d'import de la classe). */
interface AudioTransportHost {
  container: ServiceContainer | null;
  groupService?: GroupSettingsReader | null;
  sock: {
    updateMediaMessage: (message: proto.IWebMessageInfo) => Promise<proto.IWebMessageInfo>;
    user?: { id?: string; lid?: string };
  } | null;
}

/** Logger minimal (container logger ou console). */
interface HandlerLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export class AudioHandler {
  transport: AudioTransportHost;
  logger: HandlerLogger;

  constructor(transport: AudioTransportHost, logger: HandlerLogger) {
    this.transport = transport; // Reference to BaileysTransport
    this.logger = logger;
  }

  /**
   * Traite un message audio (Transcription ou Audio Natif)
   * @param msg Message Baileys brut
   * @param normalizedMsg Message normalisé en cours de construction
   * @returns Texte transcrit ou null
   */
  async processAudioMessage(msg: WAMessage, normalizedMsg: MessageData): Promise<string | null> {
    const isAudio = msg.message?.audioMessage;
    if (!isAudio) return null;

    const isGroup = normalizedMsg.isGroup;
    const container = this.transport.container;

    if (!container?.has('transcriptionService')) {
      this.logger.warn('[AudioHandler] transcriptionService non disponible');
      return null;
    }

    let transcribedText: string | null = null;

    try {
      if (!isGroup) {
        transcribedText = await this._handlePvAudio(msg, normalizedMsg);
      } else {
        transcribedText = await this._handleGroupAudio(msg, normalizedMsg);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[AudioHandler] Erreur globale: ${errMsg}`);
    }

    return transcribedText;
  }

  async _handlePvAudio(msg: WAMessage, normalizedMsg: MessageData): Promise<string | null> {
    const pvAudioDisabled = await workingMemory.isPvAudioDisabled();
    if (pvAudioDisabled) {
      this.logger.log('[AudioHandler] ⏭️ Audio PV ignoré (désactivé globalement)');
      return null;
    }

    const audioStrategy = globalConfig.models?.reglages_generaux?.audio_strategy;
    const useNativeAudio = Boolean(
      audioStrategy?.prefer_native && this.transport.container?.has('geminiLiveProvider'),
    );

    if (useNativeAudio) {
      const buffer = await this._downloadAudio(msg);
      if (buffer) {
        normalizedMsg.audioBuffer = buffer;
        normalizedMsg.useNativeAudio = true;
        normalizedMsg.text = '[AUDIO_NATIVE]';
        this.logger.log(`[AudioHandler] 🎙️ Mode Audio NATIF PV (${buffer.length} bytes)`);
        return '[AUDIO_NATIVE]';
      }
    }

    // Mode Cascade (STT)
    return await this._transcribeAudio(msg, `stt_pv_${msg.key.id}.ogg`);
  }

  async _handleGroupAudio(msg: WAMessage, normalizedMsg: MessageData): Promise<string | null> {
    const groupService = this.transport.groupService;
    const groupSettings: Record<string, unknown> = groupService
      ? await groupService.getGroupSettings(normalizedMsg.chatId)
      : {};
    const mode =
      typeof groupSettings.audio_mode === 'string' ? groupSettings.audio_mode : 'mention_only';

    if (mode === 'off') {
      this.logger.log('[AudioHandler] ⏭️ Audio Groupe ignoré (Mode OFF)');
      return null;
    }

    const buffer = await this._downloadAudio(msg);
    if (!buffer) return null;

    const audioStrategy = globalConfig.models?.reglages_generaux?.audio_strategy;
    const useNativeAudio = Boolean(
      audioStrategy?.prefer_native && this.transport.container?.has('geminiLiveProvider'),
    );

    // Check if reply to bot
    const isQuotedReplyToBot = this._isReplyToBot(msg);

    if (useNativeAudio && (mode === 'full' || isQuotedReplyToBot)) {
      normalizedMsg.audioBuffer = buffer;
      normalizedMsg.useNativeAudio = true;
      normalizedMsg.text = '[AUDIO_NATIVE]';
      this.logger.log(
        `[AudioHandler] 🎙️ Mode Audio NATIF GROUPE (mode=${mode}, reply=${isQuotedReplyToBot})`,
      );
      return '[AUDIO_NATIVE]';
    }

    // STT Fallback
    const transcribedText = await this._transcribeFromBuffer(buffer, `stt_${msg.key.id}.ogg`);
    if (!transcribedText) return null;

    const mentionsBot = botIdentity.isVocallyMentioned(transcribedText);
    if (!mentionsBot && !isQuotedReplyToBot && mode !== 'full') {
      return null;
    }

    return transcribedText;
  }

  async _downloadAudio(msg: WAMessage): Promise<Buffer | null> {
    const sock = this.transport.sock;
    if (!sock) {
      this.logger.error('[AudioHandler] Erreur téléchargement: socket non initialisé');
      return null;
    }
    try {
      return await downloadMediaMessage(
        msg,
        'buffer',
        {},
        {
          reuploadRequest: sock.updateMediaMessage,
          logger: createPinoLogger({ level: 'silent' }),
        },
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[AudioHandler] Erreur téléchargement: ${errMsg}`);
      return null;
    }
  }

  async _transcribeAudio(msg: WAMessage, fileName: string): Promise<string | null> {
    const buffer = await this._downloadAudio(msg);
    if (!buffer) return null;
    return await this._transcribeFromBuffer(buffer, fileName);
  }

  async _transcribeFromBuffer(buffer: Buffer, fileName: string): Promise<string | null> {
    const container = this.transport.container;
    if (!container) return null;

    const tempDir = join(process.cwd(), 'temp', 'stt');
    await fsPromises.mkdir(tempDir, { recursive: true });
    const tempPath = resolveWithinRoot(tempDir, fileName);

    try {
      await safeWriteFile(tempPath, buffer);
      const transcriptionService = container.get<TranscriptionService>('transcriptionService');
      const text = await transcriptionService.transcribe(tempPath);
      return text;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[AudioHandler] Erreur STT: ${errMsg}`);
      return null;
    } finally {
      try {
        await safeUnlink(tempPath);
      } catch {
        // Nettoyage best-effort : le fichier temporaire peut déjà être absent
      }
    }
  }

  _isReplyToBot(msg: WAMessage): boolean {
    const audioCtx = msg.message?.audioMessage?.contextInfo;
    if (!audioCtx?.participant) return false;

    const rawBotId = this.transport.sock?.user?.id;
    const botLid = this.transport.sock?.user?.lid;
    const quotedSender = audioCtx.participant;

    return Boolean(
      (rawBotId && quotedSender.includes(rawBotId.split(':')[0]?.split('@')[0] ?? '')) ||
      (botLid && quotedSender.includes(botLid.split(':')[0]?.split('@')[0] ?? '')),
    );
  }
}
