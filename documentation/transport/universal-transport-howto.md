# Comment Développer et Intégrer un Nouveau Transport de Messagerie dans HIVE-MIND

Ce guide pratique détaille la procédure pas-à-pas pour implémenter un nouveau connecteur de messagerie (ex. Slack, Matrix, Mattermost ou un Mock de test) en respectant le contrat `ITransport` et l'enregistrer dans `TransportManager`.

---

## Prérequis

- Node.js >= 22 (ESM natif) et TypeScript configuré.
- Dépendances du projet installées (`npm install`).
- Connaissance de l'identifiant unique du canal (ex. `'slack'`).

---

## Étapes de Réalisation

### 1. Implémenter le Contrat `ITransport`

Créez un nouveau fichier d'implémentation (par exemple `src/core/transport/slack.ts`) respectant strictement l'interface canonique `ITransport` :

```typescript
// src/core/transport/slack.ts
import type {
  ITransport,
  MessageCallback,
  GroupEventCallback,
  SendTextOptions,
  SendMediaOptions,
  SendVoiceNoteOptions,
  TransportGroupMetadata,
  PresenceType,
} from './interface.js';
import type { MessageData, UniversalResponse } from '../types/BotTypes.js';

export class SlackTransport implements ITransport {
  private messageCallback: MessageCallback | null = null;
  private groupEventCallback: GroupEventCallback | null = null;
  private isConnected = false;

  async connect(sessionPath?: string): Promise<void> {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new Error('[SlackTransport] SLACK_BOT_TOKEN manquant.');
    }
    // Initialiser le client réseau Slack ici
    this.isConnected = true;
    console.log('[SlackTransport] Connecté à Slack.');
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.messageCallback = null;
    this.groupEventCallback = null;
    console.log('[SlackTransport] Déconnecté de Slack.');
  }

  async sendText(chatId: string, text: string, options: SendTextOptions = {}): Promise<unknown> {
    if (!this.isConnected) throw new Error('[SlackTransport] Non connecté.');
    // Envoi via l'API Web Slack
    return { ok: true, channel: chatId, text };
  }

  async sendMedia(chatId: string, media: Buffer | string, options: SendMediaOptions = {}): Promise<unknown> {
    return { ok: true, channel: chatId, media };
  }

  async sendVoiceNote(chatId: string, audio: Buffer | string, options: SendVoiceNoteOptions = {}): Promise<unknown> {
    return this.sendMedia(chatId, audio, { type: 'audio', ...options });
  }

  async sendFile(chatId: string, filePath: string, fileName: string, caption: string = ''): Promise<unknown> {
    return { ok: true, channel: chatId, file: filePath, fileName, caption };
  }

  async sendSticker(chatId: string, stickerBuffer: Buffer): Promise<unknown> {
    return this.sendMedia(chatId, stickerBuffer, { type: 'image' });
  }

  async getGroupMetadata(groupId: string): Promise<TransportGroupMetadata> {
    return {
      id: groupId,
      name: 'Slack Channel',
      participants: [],
      admins: [],
    };
  }

  async downloadMedia(message: unknown): Promise<Buffer | null> {
    return null;
  }

  onMessage(callback: MessageCallback): void {
    this.messageCallback = callback;
  }

  onGroupEvent(callback: GroupEventCallback): void {
    this.groupEventCallback = callback;
  }

  async setPresence(chatId: string, presence: PresenceType | string): Promise<void> {
    // Mise à jour de l'état de frappe Slack si supporté
  }

  async sendUniversalResponse(
    chatId: string,
    response: UniversalResponse,
    options: SendTextOptions = {},
  ): Promise<unknown> {
    const text = response.markdown || response.plainText || '';
    return this.sendText(chatId, text, options);
  }

  async isAdmin(groupId: string, userId: string): Promise<boolean> {
    return false;
  }

  async sendReaction(chatId: string, key: unknown, emoji: string): Promise<boolean> {
    return true;
  }

  /**
   * Méthode d'émulation pour injecter un message entrant depuis l'API WebSocket Slack
   */
  public triggerIncomingMessage(chatId: string, sender: string, text: string): void {
    if (this.messageCallback) {
      const msg: MessageData = {
        chatId,
        sender,
        text,
        isGroup: chatId.startsWith('C'), // Préfixe habituel des canaux Slack
      };
      this.messageCallback(msg);
    }
  }
}

export const slackTransport = new SlackTransport();
```

---

### 2. Enregistrer le Transport dans `TransportManager`

Enregistrez l'instance de votre transport auprès de `TransportManager` :

```typescript
import { transportManager } from './src/core/transport/TransportManager.js';
import { slackTransport } from './src/core/transport/slack.js';

// Enregistrement dynamique
transportManager.register('slack', slackTransport);
```

---

### 3. Initialiser et Configurer l'Écoute Multi-Canaux

Spécifiez votre canal dans la liste des transports actifs et attachez le récepteur central de messages :

```typescript
import { transportManager } from './src/core/transport/TransportManager.js';
import type { MessageData } from './src/core/types/BotTypes.js';

// Initialiser WhatsApp et Slack simultanément
await transportManager.initialize(['whatsapp', 'slack']);

// Abonnement unique pour tous les canaux
transportManager.onMessage(async (message: MessageData, sourceChannel: string) => {
  console.log(`[Reçu sur ${sourceChannel}] ${message.sender}: ${message.text}`);

  // Répondre automatiquement sur le même canal
  await transportManager.sendText(
    message.chatId,
    `Réponse automatique HIVE-MIND sur ${sourceChannel}`,
    {},
    sourceChannel
  );
});
```

---

## Cas Particuliers & Variantes

### Variante A : Création d'un Transport Mock pour Tests Unitaires

Pour isoler les tests de tout appel réseau externe, créez un transport in-memory qui accumule les messages émis :

```typescript
import type { ITransport } from './src/core/transport/interface.js';

export class MemoryMockTransport implements ITransport {
  public sentTexts: Array<{ chatId: string; text: string }> = [];

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async sendText(chatId: string, text: string): Promise<unknown> {
    this.sentTexts.push({ chatId, text });
    return { ok: true };
  }
  async sendMedia(): Promise<unknown> { return {}; }
  async sendVoiceNote(): Promise<unknown> { return {}; }
  async sendFile(): Promise<unknown> { return {}; }
  async sendSticker(): Promise<unknown> { return {}; }
  async getGroupMetadata(groupId: string) { return { id: groupId, participants: [] }; }
  async downloadMedia() { return null; }
  onMessage(): void {}
  onGroupEvent(): void {}
  async setPresence(): Promise<void> {}
  async sendUniversalResponse(chatId: string, res: { plainText?: string }) {
    return this.sendText(chatId, res.plainText || '');
  }
  async isAdmin(): Promise<boolean> { return false; }
  async sendReaction(): Promise<boolean> { return true; }
}
```

---

## Vérification & Validation

Exécutez les suites de tests unitaires existantes de la couche transport pour confirmer l'intégrité de la couche de normalisation et des gestionnaires :

```bash
npx jest src/tests/unit/transport/handlers/antiDeleteHandler.test.ts src/tests/unit/transport/handlers/audioHandler.test.ts --runInBand
```

Résultat attendu dans le terminal :
```text
PASS src/tests/unit/transport/handlers/antiDeleteHandler.test.ts
PASS src/tests/unit/transport/handlers/audioHandler.test.ts

Test Suites: 2 passed, 2 total
Tests:       8 passed, 8 total
Snapshots:   0 total
Time:        ...s
Ran all test suites matching /antiDeleteHandler|audioHandler/i.
```

---

## Guide de Dépannage (Troubleshooting)

| Symptôme / Message d'Erreur | Cause Probable | Solution Immédiate |
| :--- | :--- | :--- |
| `[TransportInterface] Warning: Transport is missing method: sendVoiceNote` | Une ou plusieurs méthodes du contrat `ITransport` ne sont pas implémentées sur l'objet ou sa chaîne de prototypes. | Implémenter toutes les 15 méthodes requises par `ITransport` dans votre classe. |
| `Error: [TransportManager] Refusing file outside allowed output roots: ...` | La méthode `sendFile()` a été appelée avec un chemin en dehors des répertoires approuvés (`storage_hm/`, `temp/`, `Sandbox1/`). | Déplacer le fichier à expédier dans le répertoire temporaire `temp/` ou utiliser `resolveWithinRoot()`. |
| `Error: [TransportManager] Aucun transport disponible pour 'slack'` | Le transport n'a pas été enregistré via `transportManager.register('slack', ...)` avant d'être appelé. | S'assurer que `register()` est exécuté avant l'appel à `initialize()` ou aux méthodes d'envoi. |
