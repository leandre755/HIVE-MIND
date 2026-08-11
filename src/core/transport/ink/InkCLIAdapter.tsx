import { useState, useEffect } from 'react';
import { render, Instance } from 'ink';
import { App } from './App.js';
import type { Message } from '../../../utils/collapseReadSearch.js';
import type { MessageData, UniversalResponse } from '../../types/BotTypes.js';
import type {
  GroupEventCallback,
  MessageCallback,
  PresenceType,
  SendMediaOptions,
  SendTextOptions,
  TransportGroupMetadata,
} from '../interface.js';

export const InkCLIAdapter = {
  appInstance: null as Instance | null,
  messageCallback: null as MessageCallback | null,
  groupEventCallback: null as GroupEventCallback | null,
  messages: [] as Message[],
  isTyping: false as boolean,

  // Hook exposé par le composant React pour mettre à jour l'état interne
  updateMessages: null as ((messages: Message[]) => void) | null,
  updateIsTyping: null as ((isTyping: boolean) => void) | null,

  /**
   * Helper pour ajouter un message à l'interface
   */
  addMessage: (msg: Message) => {
    InkCLIAdapter.messages = [...InkCLIAdapter.messages, msg];
    InkCLIAdapter.isTyping = false;
    if (InkCLIAdapter.updateMessages) {
      InkCLIAdapter.updateMessages(InkCLIAdapter.messages);
    }
    if (InkCLIAdapter.updateIsTyping) {
      InkCLIAdapter.updateIsTyping(false);
    }
  },

  /**
   * Connecte au service de messagerie (ici le terminal via Ink)
   */
  connect: async () => {
    // Au lieu d'utiliser readline, on lance l'application Ink
    // Pour pouvoir mettre à jour l'état depuis l'extérieur, on crée un composant conteneur

    const Container = () => {
      const [messages, setMessages] = useState<Message[]>(InkCLIAdapter.messages);
      const [isTyping, setIsTyping] = useState<boolean>(InkCLIAdapter.isTyping);

      // On expose le setter
      useEffect(() => {
        InkCLIAdapter.updateMessages = setMessages;
        InkCLIAdapter.updateIsTyping = setIsTyping;
        return () => {
          InkCLIAdapter.updateMessages = null;
          InkCLIAdapter.updateIsTyping = null;
        };
      }, []);

      const handleMessage = (text: string) => {
        if (text === '.exit') {
          process.exit(0);
        }

        // Afficher le message de l'utilisateur
        InkCLIAdapter.addMessage({ id: 'cli_' + Date.now(), sender: 'user', text });

        if (InkCLIAdapter.messageCallback) {
          const messageObj: MessageData = {
            id: 'cli_' + Date.now(),
            chatId: 'cli_chat',
            sender: 'cli_user',
            senderName: 'Admin CLI',
            text,
            isGroup: false,
            raw: { text },
          };
          InkCLIAdapter.messageCallback(messageObj);
        }
      };

      return <App messages={messages} onMessage={handleMessage} isTyping={isTyping} />;
    };

    console.clear();
    InkCLIAdapter.appInstance = render(<Container />);
  },

  /**
   * Déconnecte du service
   */
  disconnect: async () => {
    if (InkCLIAdapter.appInstance) {
      InkCLIAdapter.appInstance.unmount();
      InkCLIAdapter.appInstance = null;
    }
  },

  /**
   * Envoie un message texte
   */
  sendText: async (_chatId: string, text: string, _options: SendTextOptions = {}) => {
    InkCLIAdapter.addMessage({ id: 'sent_' + Date.now(), sender: 'agent', text });
    return { id: 'sent_' + Date.now() };
  },

  /**
   * Envoie une réponse universelle formatée pour le Terminal (Pattern du Double Rendu)
   */
  sendUniversalResponse: async (
    _chatId: string,
    response: UniversalResponse,
    _options: SendTextOptions = {},
  ) => {
    // On récupère le markdown complet, avec repli sur la variante texte brut
    const text = response.markdown || response.plainText || '';

    InkCLIAdapter.addMessage({ id: 'sent_' + Date.now(), sender: 'agent', text });
    return { id: 'sent_' + Date.now() };
  },

  /**
   * Envoie un média
   */
  sendMedia: async (_chatId: string, _media: Buffer | string, options: SendMediaOptions = {}) => {
    InkCLIAdapter.addMessage({
      id: 'sent_' + Date.now(),
      sender: 'agent',
      text: `[MÉDIA ENVOYÉ: ${options.caption || 'Sans légende'}]`,
    });
    return { id: 'sent_media_' + Date.now() };
  },

  /**
   * Envoie un sticker
   */
  sendSticker: async (_chatId: string, _stickerBuffer: Buffer) => {
    InkCLIAdapter.addMessage({
      id: 'sent_' + Date.now(),
      sender: 'agent',
      text: '[STICKER ENVOYÉ]',
    });
    return { id: 'sent_sticker_' + Date.now() };
  },

  /**
   * Récupère les métadonnées d'un groupe
   */
  getGroupMetadata: async (groupId: string): Promise<TransportGroupMetadata> => {
    return {
      id: groupId,
      subject: 'CLI Group',
      participants: [{ id: 'cli_user', isAdmin: true }],
      admins: ['cli_user'],
    };
  },

  /**
   * Télécharge un média depuis un message
   */
  downloadMedia: async (_message: unknown): Promise<Buffer | null> => {
    return Buffer.from('');
  },

  /**
   * Définit le callback pour les nouveaux messages
   */
  onMessage: (callback: MessageCallback) => {
    InkCLIAdapter.messageCallback = callback;
  },

  /**
   * Définit le callback pour les événements de groupe
   */
  onGroupEvent: (callback: GroupEventCallback) => {
    InkCLIAdapter.groupEventCallback = callback;
  },

  /**
   * Met à jour la présence (typing, online, etc.)
   */
  setPresence: async (_chatId: string, presence: PresenceType | string) => {
    InkCLIAdapter.isTyping = presence === 'composing' || presence === 'recording';
    if (InkCLIAdapter.updateIsTyping) {
      InkCLIAdapter.updateIsTyping(InkCLIAdapter.isTyping);
    }
  },

  /**
   * Vérifie si un utilisateur est admin d'un groupe
   */
  isAdmin: async (_groupId: string, _userId: string): Promise<boolean> => {
    return true;
  },
};
