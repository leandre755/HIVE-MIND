// core/transport/interface.ts
// Interface générique pour l'abstraction du transport (WhatsApp, Telegram, Discord...)

import type { UniversalResponse, MessageData } from '../types/BotTypes.js';

// ─── Types transport-agnostiques ────────────────────────────────────────────

/** Options génériques pour l'envoi de messages texte */
export interface SendTextOptions {
  mentions?: string[];
  reply?: unknown;
  [key: string]: unknown;
}

/** Options génériques pour l'envoi de médias */
export interface SendMediaOptions {
  type?: 'image' | 'video' | 'audio' | 'document';
  caption?: string;
  fileName?: string;
  mimetype?: string;
  ptt?: boolean;
  reply?: unknown;
  [key: string]: unknown;
}

/** Options génériques pour l'envoi de notes vocales */
export interface SendVoiceNoteOptions {
  mimetype?: string;
  waveform?: Uint8Array;
  reply?: unknown;
  [key: string]: unknown;
}

/** Participant de groupe transport-agnostique */
export interface TransportGroupParticipant {
  id: string;
  admin?: 'admin' | 'superadmin' | null;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  lid?: string;
}

/**
 * Métadonnées de groupe transport-agnostiques.
 * Le sur-ensemble est calqué sur `GroupMetadata` de Baileys : c'est la seule implémentation
 * qui renseigne réellement ces champs, et `groupService.updateGroup()` les consomme tels quels.
 */
export interface TransportGroupMetadata {
  id: string;
  subject?: string;
  name?: string;
  participants: TransportGroupParticipant[];
  admins?: string[];
  owner?: string;
  /** Auteur du dernier changement de sujet ; sert de fondateur de repli (cf. `_checkFounder`). */
  subjectOwner?: string;
  creation?: number;
  desc?: string;
}

/** Événement de groupe transport-agnostique */
export interface TransportGroupEvent {
  groupId: string;
  participants: string[];
  action: string;
  timestamp: number;
  /** Injecté par `TransportManager.onGroupEvent()` : nom du transport émetteur. */
  sourceChannel?: string;
}

/** Callback pour les messages entrants */
export type MessageCallback = (message: MessageData) => void;

/** Callback pour les événements de groupe */
export type GroupEventCallback = (event: TransportGroupEvent) => void;

/** Types de présence supportés */
export type PresenceType = 'composing' | 'recording' | 'paused' | 'available' | 'unavailable';

// ─── Interface transport ────────────────────────────────────────────────────

/**
 * Interface TypeScript que tout transport doit implémenter.
 * Permet de découpler la logique métier du protocole de messagerie.
 */
export interface ITransport {
  connect(sessionPath?: string): Promise<void>;
  disconnect(): Promise<void>;
  sendText(chatId: string, text: string, options?: SendTextOptions): Promise<unknown>;
  sendMedia(chatId: string, media: Buffer | string, options?: SendMediaOptions): Promise<unknown>;
  sendVoiceNote(
    chatId: string,
    audio: Buffer | string,
    options?: SendVoiceNoteOptions,
  ): Promise<unknown>;
  sendFile(chatId: string, filePath: string, fileName: string, caption?: string): Promise<unknown>;
  sendSticker(chatId: string, stickerBuffer: Buffer): Promise<unknown>;
  getGroupMetadata(groupId: string): Promise<TransportGroupMetadata>;
  downloadMedia(message: unknown): Promise<Buffer | null>;
  onMessage(callback: MessageCallback): void;
  onGroupEvent(callback: GroupEventCallback): void;
  setPresence(chatId: string, presence: PresenceType | string): Promise<void>;
  sendUniversalResponse(
    chatId: string,
    response: UniversalResponse,
    options?: SendTextOptions,
  ): Promise<unknown>;
  isAdmin(groupId: string, userId: string): Promise<boolean>;
  sendReaction(chatId: string, key: unknown, emoji: string): Promise<boolean>;
}

/**
 * Objet de référence listant les méthodes obligatoires d'un transport.
 * Utilisé uniquement pour la validation runtime par validateTransport().
 */
export const TransportInterface: ITransport = {
  connect: async () => {
    throw new Error('connect() must be implemented');
  },

  disconnect: async () => {
    throw new Error('disconnect() must be implemented');
  },

  sendText: async (_chatId: string, _text: string, _options: SendTextOptions = {}) => {
    throw new Error('sendText() must be implemented');
  },

  sendMedia: async (_chatId: string, _media: Buffer | string, _options: SendMediaOptions = {}) => {
    throw new Error('sendMedia() must be implemented');
  },

  sendVoiceNote: async (
    _chatId: string,
    _audio: Buffer | string,
    _options: SendVoiceNoteOptions = {},
  ) => {
    throw new Error('sendVoiceNote() must be implemented');
  },

  sendFile: async (
    _chatId: string,
    _filePath: string,
    _fileName: string,
    _caption: string = '',
  ) => {
    throw new Error('sendFile() must be implemented');
  },

  sendSticker: async (_chatId: string, _stickerBuffer: Buffer) => {
    throw new Error('sendSticker() must be implemented');
  },

  getGroupMetadata: async (_groupId: string): Promise<TransportGroupMetadata> => {
    throw new Error('getGroupMetadata() must be implemented');
  },

  downloadMedia: async (_message: unknown): Promise<Buffer | null> => {
    throw new Error('downloadMedia() must be implemented');
  },

  onMessage: (_callback: MessageCallback) => {
    throw new Error('onMessage() must be implemented');
  },

  onGroupEvent: (_callback: GroupEventCallback) => {
    throw new Error('onGroupEvent() must be implemented');
  },

  setPresence: async (_chatId: string, _presence: PresenceType | string) => {
    throw new Error('setPresence() must be implemented');
  },

  sendUniversalResponse: async (
    _chatId: string,
    _response: UniversalResponse,
    _options: SendTextOptions = {},
  ) => {
    throw new Error('sendUniversalResponse() must be implemented');
  },

  isAdmin: async (_groupId: string, _userId: string): Promise<boolean> => {
    throw new Error('isAdmin() must be implemented');
  },

  sendReaction: async (_chatId: string, _key: unknown, _emoji: string): Promise<boolean> => {
    throw new Error('sendReaction() must be implemented');
  },
};

/**
 * Valide qu'un objet implémente les méthodes obligatoires de ITransport.
 *
 * `Reflect.get` (et non `Object.entries`) : les transports classe — `BaileysTransport`,
 * `HiveTransportImpl` — portent leurs méthodes sur le prototype, absentes des clés propres.
 * L'ancienne énumération par `Object.entries` les déclarait donc toutes manquantes.
 * @param transport - Objet à valider
 * @returns true si valide (warnings émis pour les méthodes manquantes)
 */
export function validateTransport(transport: object): boolean {
  for (const method of Object.keys(TransportInterface)) {
    if (typeof Reflect.get(transport, method) !== 'function') {
      console.warn(`[TransportInterface] Warning: Transport is missing method: ${method}`);
    }
  }
  return true;
}
