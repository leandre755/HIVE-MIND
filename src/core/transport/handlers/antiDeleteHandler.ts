import { proto, type WAMessage } from '@whiskeysockets/baileys';
import { workingMemory } from '../../../services/workingMemory.js';
import type { MessageData } from '../../types/BotTypes.js';

/** Message normalisé consommé par le handler (surensemble de `MessageData`). */
interface AntiDeleteMessage extends MessageData {
  id?: string;
  pushName?: string;
  type?: string;
  timestamp?: number;
}

/** Sous-ensemble du transport Baileys consommé ici (découplage : pas d'import de la classe). */
interface AntiDeleteTransportHost {
  sock: {
    sendMessage: (jid: string, content: { text: string }) => Promise<unknown>;
  } | null;
}

/** Logger minimal (container logger ou console). */
interface HandlerLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Payload d'un événement `messages.update` Baileys. */
interface MessageUpdateEntry {
  update: Partial<WAMessage>;
  key: proto.IMessageKey;
}

export class AntiDeleteHandler {
  transport: AntiDeleteTransportHost;
  logger: HandlerLogger;

  constructor(transport: AntiDeleteTransportHost, logger: HandlerLogger) {
    this.transport = transport;
    this.logger = logger;
  }

  /**
   * Enregistre un message pour pouvoir le restaurer s'il est supprimé
   * CORRIGÉ: Stockage synchrone rapide pour éviter race condition
   * @param normalizedMsg Message normalisé
   */
  async storeMessage(normalizedMsg: AntiDeleteMessage): Promise<void> {
    if (!normalizedMsg.text || !normalizedMsg.isGroup || !normalizedMsg.id) return;
    const messageId = normalizedMsg.id;

    try {
      // 🛡️ APPROCHE 1: Stockage SYNCHRONE rapide (Redis local)
      // On ne bloque pas sur les opérations longues
      await this._fastStoreMessage(normalizedMsg);

      // 🛡️ APPROCHE 2: Logging asynchrone (non-bloquant)
      // Métadonnées et tracking dans un second temps
      setImmediate(() => {
        workingMemory
          .trackDeletedMessage(normalizedMsg.chatId, messageId, {
            sender: normalizedMsg.sender,
            senderName: AntiDeleteHandler._resolveSenderName(normalizedMsg),
            text: normalizedMsg.text,
            mediaType: normalizedMsg.type,
            timestamp: normalizedMsg.timestamp,
          })
          .catch(() => {
            // Silencieux - tracking non critique
          });
      });
    } catch (e: unknown) {
      // Silencieux car non critique
      const errMsg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[AntiDelete] Store échoué: ${errMsg}`);
    }
  }

  /**
   * Nom d'affichage de l'expéditeur, avec repli sur le préfixe du JID.
   */
  private static _resolveSenderName(normalizedMsg: AntiDeleteMessage): string {
    return (
      normalizedMsg.senderName || normalizedMsg.pushName || normalizedMsg.sender.split('@')[0] || ''
    );
  }

  /**
   * Stockage rapide et synchrone (non-bloquant)
   */
  async _fastStoreMessage(normalizedMsg: AntiDeleteMessage): Promise<void> {
    if (!normalizedMsg.id) return;

    // Utiliser une méthode rapide du workingMemory
    // Cette méthode doit être implémentée pour stocker rapidement sans validation complexe
    const minimalData = {
      sender: normalizedMsg.sender,
      senderName: AntiDeleteHandler._resolveSenderName(normalizedMsg),
      text: normalizedMsg.text,
      mediaType: normalizedMsg.type,
      timestamp: normalizedMsg.timestamp,
    };

    // Store sync rapide
    await workingMemory.storeMessage(normalizedMsg.chatId, normalizedMsg.id, minimalData);
  }

  /**
   * Gère les mises à jour de messages (détection de suppression)
   * @param updates Tableau d'updates Baileys
   */
  async handleUpdate(updates: MessageUpdateEntry[]): Promise<void> {
    for (const update of updates) {
      if (!AntiDeleteHandler._isRevocation(update)) continue;

      const chatId = update.key.remoteJid;
      const messageId = update.key.id;
      if (!chatId?.endsWith('@g.us') || !messageId) continue;

      await this._restoreDeletedMessage(chatId, messageId);
    }
  }

  /**
   * Détecte une suppression : `messageStubType === REVOKE` ou contenu de message vidé.
   */
  private static _isRevocation(update: MessageUpdateEntry): boolean {
    return (
      update.update?.messageStubType === proto.WebMessageInfo.StubType.REVOKE ||
      update.update?.message === null
    );
  }

  /**
   * Reposte un message supprimé dans le groupe s'il était mémorisé.
   */
  private async _restoreDeletedMessage(chatId: string, messageId: string): Promise<void> {
    try {
      const isEnabled = await workingMemory.isAntiDeleteEnabled(chatId);
      if (!isEnabled) return;

      // Store is now synchronous (done in messages.upsert before dispatch),
      // so no delay needed before reading.
      const storedMsg = await workingMemory.getStoredMessage(chatId, messageId);
      if (!storedMsg) return;

      this.logger.log(`[AntiDelete] 🗑️ Message supprimé détecté de ${storedMsg.senderName}`);

      // Logger dans Supabase si nécessaire via workingMemory
      await workingMemory.trackDeletedMessage(chatId, messageId, storedMsg);

      const sock = this.transport.sock;
      if (!sock) {
        this.logger.warn('[AntiDelete] Repost impossible: socket non initialisé');
        return;
      }

      // Restaurer le message (repost)
      const repostText = `🗑️ *Message supprimé par ${storedMsg.senderName}:*\n\n"${storedMsg.text}"`;
      await sock.sendMessage(chatId, { text: repostText });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[AntiDelete] Erreur restauration: ${errMsg}`);
    }
  }
}
