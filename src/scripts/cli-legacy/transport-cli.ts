import * as readline from 'readline';
import type { MessageCallback, GroupEventCallback } from '../../core/transport/interface.js';

export const cliTransport = {
  rl: null as readline.Interface | null,
  messageCallback: null as MessageCallback | null,
  groupEventCallback: null as GroupEventCallback | null,

  /**
   * Connecte au service de messagerie (ici le terminal)
   */
  connect: async () => {
    // En mode test automatisé ou batterie, ne pas s'abonner à process.stdin
    // pour éviter le blocage SIGTTIN et la pollution du readline interactif.
    const isTest = process.env.APP_ENV === 'test' || process.env.NODE_ENV === 'test';
    const isBattery = process.env.APP_ENV === 'battery';
    if (isTest) {
      console.log('\n======================================');
      console.log('🤖 HIVE-MIND CLI Transport (Mode Test - Entrée standard désactivée)');
      console.log('======================================\n');
      return;
    }
    if (isBattery) {
      console.log('\n======================================');
      console.log(
        '🤖 HIVE-MIND CLI Transport (Mode Battery - messageCallback actif, readline désactivé)',
      );
      console.log('======================================\n');
      return;
    }

    cliTransport.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'YOU > ',
    });

    console.log('\n======================================');
    console.log('🤖 HIVE-MIND CLI Transport Connecté');
    console.log('Tapez vos messages. Tapez .exit pour quitter.');
    console.log('======================================\n');

    cliTransport.rl.prompt();

    cliTransport.rl.on('line', (line) => {
      const text = line.trim();
      if (text === '.exit') {
        process.exit(0);
      }
      if (text && cliTransport.messageCallback) {
        // Simuler un objet MessageData
        const messageObj = {
          id: 'cli_' + Date.now(),
          chatId: 'cli_chat',
          sender: 'cli_user',
          senderName: 'Admin CLI',
          text,
          isGroup: false,
          isSystem: false,
          raw: { text },
        };
        cliTransport.messageCallback(messageObj);
      }
    });
  },

  /**
   * Déconnecte du service
   */
  disconnect: async () => {
    if (cliTransport.rl) {
      cliTransport.rl.close();
      console.log('CLI Transport déconnecté.');
    }
  },

  /**
   * Envoie un message texte
   */
  sendText: async (_chatId: string, text: string, _options: Record<string, unknown> = {}) => {
    console.log(`\n🤖 HIVE-MIND > ${text}\n`);
    if (cliTransport.rl) {
      cliTransport.rl.prompt();
    }
    return { id: 'sent_' + Date.now() };
  },

  /**
   * Envoie une réponse universelle formatée pour le Terminal
   */
  sendUniversalResponse: async (
    _chatId: string,
    response: { markdown?: string },
    _options: Record<string, unknown> = {},
  ) => {
    const text = response.markdown;

    // Pour le moment on affiche juste le markdown
    // On pourrait ajouter des couleurs ici si chalk était installé
    console.log(`\n🤖 HIVE-MIND [CLI] >\n${text}\n`);

    if (cliTransport.rl) {
      cliTransport.rl.prompt();
    }
    return { id: 'sent_' + Date.now() };
  },

  /**
   * Envoie un média
   */
  sendMedia: async (_chatId: string, _media: unknown, options: { caption?: string } = {}) => {
    console.log(`\n🤖 HIVE-MIND > [MÉDIA ENVOYÉ: ${options.caption || 'Sans légende'}]\n`);
    if (cliTransport.rl) {
      cliTransport.rl.prompt();
    }
    return { id: 'sent_media_' + Date.now() };
  },

  /**
   * Envoie un sticker
   */
  sendSticker: async (_chatId: string, _stickerBuffer: Buffer) => {
    console.log('\n🤖 HIVE-MIND > [STICKER ENVOYÉ]\n');
    if (cliTransport.rl) {
      cliTransport.rl.prompt();
    }
    return { id: 'sent_sticker_' + Date.now() };
  },

  /**
   * Envoie une note vocale
   */
  sendVoiceNote: async (_chatId: string, _audio: unknown) => {
    console.log('\n🤖 HIVE-MIND > [VOCAL ENVOYÉ]\n');
    if (cliTransport.rl) {
      cliTransport.rl.prompt();
    }
    return { id: 'sent_voice_' + Date.now() };
  },

  /**
   * Envoie un fichier
   */
  sendFile: async (_chatId: string, _filePath: string, fileName: string) => {
    console.log(`\n🤖 HIVE-MIND > [FICHIER ENVOYÉ: ${fileName}]\n`);
    if (cliTransport.rl) {
      cliTransport.rl.prompt();
    }
    return { id: 'sent_file_' + Date.now() };
  },

  /**
   * Récupère les métadonnées d'un groupe
   */
  getGroupMetadata: async (groupId: string) => {
    return {
      id: groupId,
      subject: 'CLI Group',
      participants: ['cli_user'],
      admins: ['cli_user'],
    };
  },

  /**
   * Télécharge un média depuis un message
   */
  downloadMedia: async (_message: unknown) => {
    return Buffer.from('');
  },

  /**
   * Définit le callback pour les nouveaux messages
   */
  onMessage: (callback: MessageCallback) => {
    cliTransport.messageCallback = callback;
  },

  /**
   * Définit le callback pour les événements de groupe
   */
  onGroupEvent: (callback: GroupEventCallback) => {
    cliTransport.groupEventCallback = callback;
  },

  /**
   * Met à jour la présence (typing, online, etc.)
   */
  setPresence: async (_chatId: string, presence: string) => {
    // En CLI on peut simuler un indicateur de frappe, mais c'est cosmétique
    if (presence === 'composing') {
      process.stdout.write('🤖 HIVE-MIND écrit...\r');
    } else {
      process.stdout.write('                     \r');
    }
  },

  /**
   * Vérifie si un utilisateur est admin d'un groupe
   */
  isAdmin: async (_groupId: string, _userId: string) => {
    return true; // En CLI, l'utilisateur est toujours admin
  },

  /**
   * Envoie une réaction (emoji) sur un message
   */
  sendReaction: async (_chatId: string, _key: unknown, emoji: string) => {
    console.log(`\n🤖 HIVE-MIND > [RÉACTION: ${emoji}]\n`);
    if (cliTransport.rl) {
      cliTransport.rl.prompt();
    }
    return true;
  },
};
