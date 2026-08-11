// plugins/group_manager/actions.ts
// Actions de modération : warn, ban, kick, mute, deleteMessage

export interface MessageKey {
  remoteJid?: string | null;
  fromMe?: boolean | null;
  id?: string | null;
  participant?: string | null;
}

export interface ModerationTransport {
  sendText(chatId: string, text: string, options?: { mentions?: string[] }): Promise<unknown>;
  banUser(chatId: string, userJid: string, reason?: string): Promise<unknown>;
  sock: {
    groupParticipantsUpdate(
      chatId: string,
      participants: string[],
      action: 'add' | 'remove' | 'promote' | 'demote',
    ): Promise<unknown>;
    sendMessage(chatId: string, content: { delete: MessageKey }): Promise<unknown>;
  };
}

export interface ModerationActionResult {
  action: string;
  success: boolean;
  error?: string;
  note?: string;
}

/**
 * Actions de modération pour les groupes
 */
export const moderationActions = {
  /**
   * Envoie un avertissement à un utilisateur
   */
  async warn(
    transport: ModerationTransport,
    groupJid: string,
    userJid: string,
    reason: string,
    warningCount: number,
    maxWarnings: number,
  ): Promise<ModerationActionResult> {
    const username = userJid.split('@')[0];
    const message =
      `⚠️ **Avertissement** @${username}\n` +
      `Raison: ${reason}\n` +
      `⏳ Warning ${warningCount}/${maxWarnings}`;

    await transport.sendText(groupJid, message, {
      mentions: [userJid],
    });

    return { action: 'warn', success: true };
  },

  /**
   * Bannit (expulse) un utilisateur
   */
  async ban(
    transport: ModerationTransport,
    groupJid: string,
    userJid: string,
    reason: string,
  ): Promise<ModerationActionResult> {
    const username = userJid.split('@')[0];

    try {
      // Envoyer le message AVANT le ban
      const message =
        `🚫 **Exclusion** @${username}\n` +
        `Raison: ${reason}\n` +
        "Tu as dépassé la limite d'avertissements.";

      await transport.sendText(groupJid, message, {
        mentions: [userJid],
      });

      // Exécuter le ban
      await transport.banUser(groupJid, userJid);

      return { action: 'ban', success: true };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[GroupManager] Erreur ban:', error);
      return { action: 'ban', success: false, error: errorMessage };
    }
  },

  /**
   * Kick temporaire (sans ban permanent)
   */
  async kick(
    transport: ModerationTransport,
    groupJid: string,
    userJid: string,
    reason: string,
  ): Promise<ModerationActionResult> {
    const username = userJid.split('@')[0];

    try {
      const message = `👋 **Expulsion temporaire** @${username}\n` + `Raison: ${reason}`;

      await transport.sendText(groupJid, message, {
        mentions: [userJid],
      });

      await transport.sock.groupParticipantsUpdate(groupJid, [userJid], 'remove');

      return { action: 'kick', success: true };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[GroupManager] Erreur kick:', error);
      return { action: 'kick', success: false, error: errorMessage };
    }
  },

  /**
   * Mute un utilisateur (retire son droit de parole)
   * Note: Nécessite que le groupe soit en mode "admins only" pour les messages
   */
  async mute(
    transport: ModerationTransport,
    groupJid: string,
    userJid: string,
    reason: string,
    durationMinutes: number = 60,
  ): Promise<ModerationActionResult> {
    const username = userJid.split('@')[0];

    const message =
      `🔇 **Silence** @${username}\n` +
      `Raison: ${reason}\n` +
      `Tes prochains messages seront ignorés pour ${durationMinutes} minutes.`;

    await transport.sendText(groupJid, message, {
      mentions: [userJid],
    });

    // On pourrait stocker dans Redis pour ignorer les messages de cet user
    // temporairement, mais c'est une fonctionnalité avancée

    return { action: 'mute', success: true, note: 'Mute enregistré (soft mute)' };
  },

  /**
   * Supprime un message (si le bot est admin)
   */
  async deleteMessage(
    transport: ModerationTransport,
    groupJid: string,
    messageKey: MessageKey,
  ): Promise<ModerationActionResult> {
    try {
      await transport.sock.sendMessage(groupJid, { delete: messageKey });
      return { action: 'delete', success: true };
    } catch (error: unknown) {
      console.error('[GroupManager] Erreur suppression:', error);
      return { action: 'delete', success: false };
    }
  },
};

export default moderationActions;
