# SS-15 : Universal Multi-Channel Transport Layer & ITransport Abstraction — Référence Technique

Ce document constitue la spécification technique et la référence d'API autoritaire pour le sous-système **SS-15** (`Universal Multi-Channel Transport Layer`), couvrant le contrat d'interface `ITransport`, le gestionnaire central `TransportManager` et les adaptateurs multi-canaux.

- **Fichiers sources :** `src/core/transport/interface.ts`, `src/core/transport/TransportManager.ts`, `src/core/transport/baileys.ts`, `src/core/transport/discord.ts`, `src/core/transport/telegram.ts`, `src/core/transport/cli.ts`, `src/core/transport/handlers/*`
- **Conteneur IoC :** `ServiceContainer.get<TransportManager>('transportManager')` ou singleton exporté `transportManager`
- **Dépendances directes :** `@whiskeysockets/baileys`, `discord.js-selfbot-v13`, `telegram` (GramJS), `src/utils/safeFs.ts`, `src/core/types/BotTypes.ts`

---

## 1. Interfaces & Types TypeScript

### Types Transport-Agnostiques (`src/core/transport/interface.ts`)

```typescript
import type { UniversalResponse, MessageData } from '../types/BotTypes.js';

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

/** Métadonnées de groupe transport-agnostiques */
export interface TransportGroupMetadata {
  id: string;
  subject?: string;
  name?: string;
  participants: TransportGroupParticipant[];
  admins?: string[];
  owner?: string;
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
  sourceChannel?: string;
}

/** Callback pour les messages entrants */
export type MessageCallback = (message: MessageData) => void;

/** Callback pour les événements de groupe */
export type GroupEventCallback = (event: TransportGroupEvent) => void;

/** Types de présence supportés */
export type PresenceType = 'composing' | 'recording' | 'paused' | 'available' | 'unavailable';
```

### Contrat Pivot `ITransport`

```typescript
export interface ITransport {
  connect(sessionPath?: string): Promise<void>;
  disconnect(): Promise<void>;
  sendText(chatId: string, text: string, options?: SendTextOptions): Promise<unknown>;
  sendMedia(chatId: string, media: Buffer | string, options?: SendMediaOptions): Promise<unknown>;
  sendVoiceNote(chatId: string, audio: Buffer | string, options?: SendVoiceNoteOptions): Promise<unknown>;
  sendFile(chatId: string, filePath: string, fileName: string, caption?: string): Promise<unknown>;
  sendSticker(chatId: string, stickerBuffer: Buffer): Promise<unknown>;
  getGroupMetadata(groupId: string): Promise<TransportGroupMetadata>;
  downloadMedia(message: unknown): Promise<Buffer | null>;
  onMessage(callback: MessageCallback): void;
  onGroupEvent(callback: GroupEventCallback): void;
  setPresence(chatId: string, presence: PresenceType | string): Promise<void>;
  sendUniversalResponse(chatId: string, response: UniversalResponse, options?: SendTextOptions): Promise<unknown>;
  isAdmin(groupId: string, userId: string): Promise<boolean>;
  sendReaction(chatId: string, key: unknown, emoji: string): Promise<boolean>;
}
```

### Types Internes de `TransportManager` (`src/core/transport/TransportManager.ts`)

```typescript
export interface TransportCapabilities {
  sock?: WASocket | null;
  messageCallback?: MessageCallback | null;
  setContainer?(container: ServiceContainer): void;
  downloadQuotedMedia?(message: MessageData): Promise<Buffer | null>;
}

export type RegisteredTransport = Omit<ITransport, 'getGroupMetadata'> &
  TransportCapabilities & {
    getGroupMetadata(groupId: string): Promise<TransportGroupMetadata | Record<string, unknown>>;
  };
```

---

## 2. Classes & Signatures de Méthodes

### `TransportManager` (`src/core/transport/TransportManager.ts`)

Gestionnaire centralisé du cycle de vie multi-transports et routeur bidirectionnel.

#### Constructeur
```typescript
constructor()
```
Enregistre par défaut les transports intégrés : `whatsapp`, `cli`, `discord`, `telegram`, ainsi que les canaux internes inertes `internal` et `system`.

#### Méthodes de Gestion de Cycle de Vie

##### `register(name: string, transportInstance: RegisteredTransport): void`
Enregistre une nouvelle instance de transport dans la table interne après validation via `validateTransport()`.
- **Paramètres :**
  - `name` (`string`) : Identifiant unique du canal (ex. `'whatsapp'`, `'discord'`, `'slack'`).
  - `transportInstance` (`RegisteredTransport`) : Objet ou classe implémentant `ITransport`.

##### `setContainer(container: ServiceContainer): void`
Propage l'instance du conteneur IoC à tous les transports enregistrés implémentant la méthode optionnelle `setContainer`.

##### `initialize(activeTransportNames?: string[]): Promise<void>`
Initialise et connecte en parallèle tous les transports désignés comme actifs (défaut : `['whatsapp']`). Si le nom `'tui'` ou `'ink-cli'` est présent, charge dynamiquement `HiveTransport` et démarre `TuiServerTransport`.

##### `disconnect(): Promise<void>`
Déconnecte proprement tous les transports actifs et arrête le serveur WebSocket TUI si nécessaire.

#### Méthodes de Réception & Routage

##### `onMessage(callback: (message: MessageData, sourceChannel: string) => void): void`
Enregistre un écouteur global de messages. Enveloppe les callbacks de chaque transport actif pour injecter automatiquement le champ `message.sourceChannel`.

##### `onGroupEvent(callback: (event: BotEvent, sourceChannel: string) => void): void`
Enregistre un écouteur global d'événements de groupe (rejoindre, quitter, promotion d'admin) et convertit les `TransportGroupEvent` en `BotEvent` normalisés.

##### `getTransport(name?: string): RegisteredTransport | undefined`
Résout l'instance d'un transport. Si `name` vaut `'current'`, `undefined` ou cible un canal inactif, bascule sur le transport actif par défaut.

#### Méthodes Proxy d'Émission

| Méthode | Signature | Description |
| :--- | :--- | :--- |
| `sendText` | `(chatId: string, text: string, options?: SendTextOptions, sourceChannel?: string) => Promise<unknown>` | Envoie un message texte sur le canal ciblé. |
| `sendUniversalResponse` | `(chatId: string, response: UniversalResponse, options?: SendTextOptions, sourceChannel?: string) => Promise<unknown>` | Envoie une réponse structurée (Markdown, PlainText, Visual). |
| `sendMedia` | `(chatId: string, media: Buffer \| string, options?: SendMediaOptions, sourceChannel?: string) => Promise<unknown>` | Transmet une image, vidéo ou document. |
| `sendVoiceNote` | `(chatId: string, audio: Buffer \| string, options?: SendVoiceNoteOptions, sourceChannel?: string) => Promise<unknown>` | Envoie une note vocale PTT avec waveform éventuelle. |
| `sendFile` | `(chatId: string, filePath: string, fileName: string, caption?: string, sourceChannel?: string) => Promise<unknown>` | Envoie un fichier local après validation de confinement `resolveWithinRoot`. |
| `sendSticker` | `(chatId: string, stickerBuffer: Buffer, sourceChannel?: string) => Promise<unknown>` | Transmet un sticker WebP. |
| `sendReaction` | `(chatId: string, key: unknown, emoji: string, sourceChannel?: string) => Promise<boolean>` | Appose une réaction émoji sur un message. |
| `setPresence` | `(chatId: string, presence: string, sourceChannel?: string) => Promise<void>` | Met à jour l'indicateur de saisie (`composing`, `recording`). |
| `getGroupMetadata` | `(groupId: string, sourceChannel?: string) => Promise<TransportGroupMetadata>` | Récupère la liste des participants et administrateurs d'un salon. |
| `downloadMedia` | `(message: MessageData, sourceChannel?: string) => Promise<Buffer \| null>` | Télécharge la charge binaire d'un message reçu. |
| `downloadQuotedMedia` | `(message: MessageData, sourceChannel?: string) => Promise<Buffer \| null>` | Télécharge le média du message cité en référence. |
| `isAdmin` | `(groupId: string, userId: string, sourceChannel?: string) => Promise<boolean>` | Vérifie si un identifiant dispose des privilèges administrateur. |

---

### `AntiDeleteHandler` (`src/core/transport/handlers/antiDeleteHandler.ts`)

Gestionnaire de détection et de restauration des messages supprimés dans les groupes WhatsApp.

#### Méthodes
- `storeMessage(normalizedMsg: AntiDeleteMessage): Promise<void>` : Stocke de façon synchrone et rapide le message dans `workingMemory` (`_fastStoreMessage`) puis programme le tracking asynchrone non-bloquant.
- `handleUpdate(updates: MessageUpdateEntry[]): Promise<void>` : Analyse les événements `messages.update` Baileys, filtre les révocations (`StubType.REVOKE` ou `message === null`) et republie le contenu supprimé si `isAntiDeleteEnabled(chatId)` est actif.

---

### `AudioHandler` (`src/core/transport/handlers/audioHandler.ts`)

Gestionnaire de traitement des notes vocales et flux audio entrants.

#### Méthodes
- `processAudioMessage(msg: WAMessage, normalizedMsg: MessageData): Promise<string | null>` : Point d'entrée principal. Détermine si le message provient d'un groupe ou d'un canal privé, applique la politique audio (`prefer_native` vs cascade STT) et renvoie le texte transcrit ou le marqueur `[AUDIO_NATIVE]`.

---

## 3. Schéma de Configuration & Variables d'Environnement

| Variable d'Environnement | Type | Défaut | Obligatoire | Description |
| :--- | :--- | :--- | :--- | :--- |
| `ACTIVE_TRANSPORT` | `string` | `'whatsapp'` | Non | Liste séparée par des virgules des canaux actifs (ex. `'whatsapp,cli'`, `'discord,telegram'`). |
| `DEFAULT_TRANSPORT` | `string` | `'whatsapp'` | Non | Identifiant du canal prioritaire par défaut. |
| `DISCORD_TOKEN` | `string` | — | Conditionnel | Jeton d'authentification utilisateur Discord (requis si Discord actif). |
| `TELEGRAM_API_ID` | `number` | — | Conditionnel | Identifiant d'application API Telegram GramJS (requis si Telegram actif). |
| `TELEGRAM_API_HASH` | `string` | — | Conditionnel | Hash d'application API Telegram GramJS (requis si Telegram actif). |
| `TELEGRAM_BOT_TOKEN` | `string` | — | Non | Jeton de Bot Telegram (si connexion en mode Bot). |
| `TELEGRAM_SESSION` | `string` | — | Non | Chaîne de session GramJS `StringSession` (si connexion en mode compte utilisateur). |

---

## 4. Codes d'Erreur & Exceptions Levées

| Code / Exception | Condition de Déclenchement | Comportement Système |
| :--- | :--- | :--- |
| `Error: [TransportManager] Aucun transport disponible pour '...'` | Tentative d'appel d'une méthode proxy alors qu'aucun transport correspondant ni fallback actif n'est enregistré. | Rejet immédiat de la promesse avec message explicite. |
| `Error: [TransportManager] Refusing file outside allowed output roots: ...` | `sendFile()` invoqué avec un chemin absolu ne résolvant pas dans `storage_hm/`, `temp/`, `hm_storage/` ou `Sandbox1/`. | Interception de sécurité, blocage du transfert réseau et émission d'une erreur. |
| `Error: [DiscordTransport] DISCORD_TOKEN is missing...` | `discordTransport.connect()` appelé sans jeton Discord configuré. | Échec de l'initialisation du canal Discord. |
| `Error: [TelegramTransport] TELEGRAM_API_ID and TELEGRAM_API_HASH are required.` | `telegramTransport.connect()` appelé sans identifiants MTProto valides. | Échec de l'initialisation du canal Telegram. |
| `Error: [TransportManager] getGroupMetadata non supporté par le transport ...` | Requête de métadonnées sur un transport ne supportant ni la méthode ni le socket Baileys direct. | Échec de la résolution des permissions de groupe. |

---

## 5. Exemple d'Utilisation Minimal

```typescript
import { transportManager } from '../../src/core/transport/TransportManager.js';
import type { MessageData, UniversalResponse } from '../../src/core/types/BotTypes.js';

// 1. Initialiser les transports actifs
await transportManager.initialize(['whatsapp', 'discord']);

// 2. S'abonner aux messages entrants
transportManager.onMessage(async (message: MessageData, sourceChannel: string) => {
  console.log(`[Message reçu sur ${sourceChannel}] de ${message.sender}: ${message.text}`);

  // 3. Envoyer une réponse universelle ciblée
  const response: UniversalResponse = {
    markdown: `Bonjour **${message.senderName || 'Utilisateur'}**, votre message a bien été reçu.`,
    plainText: `Bonjour ${message.senderName || 'Utilisateur'}, votre message a bien été reçu.`,
  };

  await transportManager.sendUniversalResponse(
    message.chatId,
    response,
    {},
    sourceChannel // Routage précis vers le canal émetteur
  );
});
```

---

## 6. Limitations & Invariants Opérationnels

- **Concurrence & Thread-Safety :** `TransportManager` est un singleton non réentrant qui gère les événements de façon asynchrone via la boucle d'événements Node.js.
- **Limites de Découpage (*Chunking*) :**
  - Discord : Les charges textuelles excédant 2 000 caractères sont automatiquement découpées en blocs de 1 990 caractères via expression régulière (`[\s\S]{1,1990}`).
  - Telegram : Les charges excédant 4 096 caractères sont découpées en blocs de 4 000 caractères.
- **Sanctuarisation Disque :** Tout envoi de fichier local via `sendFile` est strictement restreint aux sous-dossiers approuvés sous la racine du projet.
