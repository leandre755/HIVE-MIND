// core/handlers/groupHandler.js
// Gère les événements de groupe (join, leave, promote, demote)
// Extrait de core/index.js pour modularité

import { groupService } from '../../services/groupService.js';
import { db } from '../../services/supabase.js';
import type { TransportGroupEvent, TransportGroupMetadata } from '../transport/interface.js';
import type { BotEvent } from '../types/BotTypes.js';

export interface GroupHandlerTransport {
  sendText(chatId: string, text: string, options?: unknown): Promise<unknown>;
  getGroupMetadata(groupId: string): Promise<TransportGroupMetadata>;
}

export interface GroupEventEnvelope {
  type?: 'message' | 'scheduled' | 'proactive' | 'group_event';
  data: TransportGroupEvent;
}

export type GroupWelcomeHandler = ((event: BotEvent) => Promise<void>) | null;

/**
 * Gestionnaire des événements de groupe
 */
export class GroupHandler {
  transport: GroupHandlerTransport;
  welcomeHandler: GroupWelcomeHandler;

  constructor(transport: GroupHandlerTransport, welcomeHandler: GroupWelcomeHandler = null) {
    this.transport = transport;
    this.welcomeHandler = welcomeHandler;
  }

  /**
   * Définit le handler de bienvenue
   */
  setWelcomeHandler(handler: GroupWelcomeHandler) {
    this.welcomeHandler = handler;
  }

  /**
   * Gère un événement de groupe
   * @param {GroupEventEnvelope} event - Événement de groupe
   */
  async handleEvent(event: GroupEventEnvelope) {
    const { groupId, participants, action } = event.data;

    // Invalider le cache Redis sur les événements critiques
    if (['promote', 'demote', 'remove'].includes(action)) {
      await groupService.invalidateCache(groupId);
    }

    // Tracking des événements membres dans la base
    for (const participant of participants) {
      await this._trackMemberEvent(groupId, participant, action);
    }

    // Gestionnaire spécifique pour les arrivées (Welcome)
    if (action === 'add') {
      if (this.welcomeHandler) {
        const botEvent: BotEvent = {
          type: event.type || 'group_event',
          chatId: groupId,
          data: event.data,
        };
        await this.welcomeHandler(botEvent);
      }
      await this._checkFounder(groupId);
    }

    // Messages de notification
    await this._sendNotification(groupId, participants, action);
  }

  /**
   * Track un événement membre dans la base de données
   */
  async _trackMemberEvent(groupId: string, participant: string, action: string) {
    try {
      await db.recordMemberEvent(groupId, participant, action);

      if (action === 'add') {
        await this._handleRejoin(groupId, participant);
      }
    } catch (error: unknown) {
      await this._handleTrackError(groupId, participant, action, error);
    }
  }

  private async _handleRejoin(groupId: string, participant: string) {
    const hasLeftBefore = await db.hasLeftBefore(groupId, participant);
    if (hasLeftBefore) {
      const username = participant.split('@')[0];
      console.log(`[GroupEvent] 🔄 Utilisateur ${username} a rejoint à nouveau`);

      await this.transport.sendText(groupId, `👀 @${username} est de retour dans le groupe!`, {
        mentions: [participant],
      });
    }
  }

  private async _handleTrackError(
    groupId: string,
    participant: string,
    action: string,
    error: unknown,
  ) {
    const isObject = typeof error === 'object' && error !== null;
    const code = isObject && 'code' in error ? error.code : undefined;
    const message =
      isObject && 'message' in error && typeof error.message === 'string'
        ? error.message
        : undefined;

    if (code === '23503' || message?.includes('foreign key constraint')) {
      console.log("[GroupEvent] 🔄 Groupe inconnu en DB, synchronisation d'urgence...");
      try {
        const metadata = await this.transport.getGroupMetadata(groupId);
        await groupService.updateGroup(groupId, metadata);
        await db.recordMemberEvent(groupId, participant, action);
        console.log('[GroupEvent] ✓ Synchronisation et tracking réussis');
      } catch (syncError: unknown) {
        console.error('[GroupEvent] Échec récupération sync:', syncError);
      }
    } else {
      console.error('[GroupEvent] Erreur tracking:', error);
    }
  }

  /**
   * Vérifie et définit le fondateur du groupe si nécessaire
   */
  async _checkFounder(groupId: string) {
    try {
      const founder = await db.getGroupFounder(groupId);
      if (!founder) {
        const metadata = await this.transport.getGroupMetadata(groupId);
        const creatorJid = metadata.owner || metadata.subjectOwner;

        if (typeof creatorJid === 'string' && creatorJid) {
          await db.setGroupFounder(groupId, creatorJid);
          console.log(`[GroupEvent] ✓ Fondateur défini: ${creatorJid}`);
        }
      }
    } catch (error: unknown) {
      console.error('[GroupEvent] Erreur définition fondateur:', error);
    }
  }

  /**
   * Envoie les notifications de groupe
   */
  async _sendNotification(groupId: string, participants: string[], action: string) {
    const firstParticipant = participants[0] ? participants[0].split('@')[0] : '';
    const messages = new Map<string, string>([
      ['remove', `👋 Au revoir @${firstParticipant}...`],
      ['promote', `🎉 Félicitations @${firstParticipant} est maintenant admin !`],
      ['demote', `📉 @${firstParticipant} n'est plus admin.`],
    ]);

    const messageText = messages.get(action);
    if (messageText) {
      await this.transport.sendText(groupId, messageText, {
        mentions: participants,
      });
    }
  }
}

export default GroupHandler;
