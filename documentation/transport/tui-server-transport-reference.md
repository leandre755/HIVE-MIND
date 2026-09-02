# SS-16 : Headless Daemon TUI IPC Server Transport & HiveTransport — Référence Technique

Ce document constitue la référence d'API autoritaire pour le sous-système **SS-16** (`Headless Daemon TUI IPC Server Transport`), décrivant le serveur WebSocket local `TuiServerTransport`, l'adaptateur `HiveTransportImpl` et le protocole IPC de liaison avec les interfaces terminales détachées.

- **Fichiers sources :** `src/core/transport/TuiServerTransport.ts`, `src/core/transport/tui/HiveTransport.ts`
- **Conteneur IoC :** `tuiServerTransport` (singleton) et `hiveTransport` (singleton exporté)
- **Dépendances directes :** `ws`, `node:crypto`, `node:events`, `src/utils/safeFs.ts`, `src/core/types/BotTypes.ts`

---

## 1. Interfaces & Types TypeScript

### Commandes Reçues du Client TUI (`src/core/transport/TuiServerTransport.ts`)

```typescript
import type { MessageData } from '../types/BotTypes.js';

/** Commande d'authentification initiale */
export interface AuthCommand {
  type: 'auth';
  token?: string;
}

/** Commande d'envoi d'un message utilisateur vers le cœur */
export interface UserMessageCommand {
  type: 'user_message';
  text: string;
  options?: Partial<MessageData>;
}

/** Commande de réponse à une demande d'approbation HITL */
export interface ConfirmationResponseCommand {
  type: 'confirmation_response';
  id: string;
  approved: boolean;
  feedback?: string;
}

export type ClientCommand = AuthCommand | UserMessageCommand | ConfirmationResponseCommand;
```

### Payloads des Événements Émis vers le Client TUI (`src/core/transport/tui/HiveTransport.ts`)

```typescript
import type { MessageData } from '../../types/BotTypes.js';
import type { SendVoiceNoteOptions } from '../interface.js';

/** Indicateur d'état de saisie ou présence */
export interface PresencePayload {
  chatId: string;
  presence: string;
}

/** Demande de validation humaine (HITL) en attente d'une décision de l'opérateur */
export interface ConfirmationRequestPayload {
  id: string;
  type: string;
  data: unknown;
  description: string;
}

/** Contenu multimédia diffusé au client */
export interface MediaPayload {
  chatId: string;
  media: Buffer | string;
  type: string;
  filename: string;
  caption: string;
}

/** Note vocale transmise au client */
export interface VoicePayload {
  chatId: string;
  audio: Buffer | string;
  options: SendVoiceNoteOptions;
}

/** Fichier local transmis au client */
export interface FilePayload {
  chatId: string;
  filePath: string;
  fileName: string;
  caption: string;
}

/** Sticker WebP transmis au client */
export interface StickerPayload {
  chatId: string;
  stickerBuffer: Buffer;
}

/** Réponse visuelle riche (cartes, tables, graphes) */
export interface VisualResponsePayload {
  chatId: string;
  visual: unknown;
}

/** État de la connexion du transport */
export interface ConnectionStatusPayload {
  connected: boolean;
}

/** Réaction émoji transmise au client */
export interface ReactionPayload {
  chatId: string;
  key: unknown;
  emoji: string;
}

/**
 * Carte exhaustive des événements émis par HiveTransport
 */
export interface HiveTransportEvents {
  message: [MessageData];
  presence: [PresencePayload];
  confirmation_request: [ConfirmationRequestPayload];
  media: [MediaPayload];
  voice: [VoicePayload];
  file: [FilePayload];
  sticker: [StickerPayload];
  visual_response: [VisualResponsePayload];
  connection_status: [ConnectionStatusPayload];
  reaction: [ReactionPayload];
}
```

---

## 2. Classes & Signatures de Méthodes

### `TuiServerTransport` (`src/core/transport/TuiServerTransport.ts`)

Serveur WebSocket local de synchronisation inter-processus.

#### Propriétés Privées
- `wss: WebSocketServer | null` : Instance du serveur WebSocket.
- `port: number` : Port effectif après négociation dynamique (base : 5001).
- `token: string` : Jeton UUID cryptographique éphémère.
- `configPath: string` : Chemin absolu vers `tui-connection.json`.
- `authenticatedClients: Set<WebSocket>` : Ensemble des sockets clientes authentifiées.

#### Méthodes Publiques

##### `start(): Promise<void>`
Démarre l'écoute WebSocket sur `127.0.0.1`, négocie un port libre (5001 à 5021), écrit `tui-connection.json`, attache les gestionnaires de connexion et abonne les diffuseurs aux événements de `hiveTransport`.

##### `stop(): Promise<void>`
Désabonne tous les écouteurs d'événements, déconnecte tous les clients avec le code `1001`, ferme le serveur WebSocket et supprime `tui-connection.json` du disque via `safeUnlinkSync`.

---

### `HiveTransportImpl` (`src/core/transport/tui/HiveTransport.ts`)

Adaptateur de transport reliant le cœur décisionnel à l'interface terminale détachable (implémente `ITransport` et hérite de `EventEmitter<HiveTransportEvents>`).

#### Méthodes Publiques Principales

| Méthode | Signature | Description |
| :--- | :--- | :--- |
| `connect` | `() => Promise<void>` | Active le transport et émet l'événement `connection_status: true`. |
| `disconnect` | `() => Promise<void>` | Réinitialise les callbacks et émet l'événement `connection_status: false`. |
| `sendText` | `(chatId: string, text: string, options?: SendTextOptions) => Promise<unknown>` | Émet l'événement `message` vers la TUI avec `sender: 'assistant'`. |
| `sendMedia` | `(chatId: string, media: Buffer \| string, options?: SendMediaOptions) => Promise<unknown>` | Émet l'événement `media` vers la TUI. |
| `sendVoiceNote` | `(chatId: string, audio: Buffer \| string, options?: SendVoiceNoteOptions) => Promise<unknown>` | Émet l'événement `voice` vers la TUI. |
| `sendFile` | `(chatId: string, filePath: string, fileName: string, caption?: string) => Promise<unknown>` | Émet l'événement `file` vers la TUI. |
| `sendSticker` | `(chatId: string, stickerBuffer: Buffer) => Promise<unknown>` | Émet l'événement `sticker` vers la TUI. |
| `sendUniversalResponse` | `(chatId: string, response: UniversalResponse, options?: SendTextOptions) => Promise<unknown>` | Transmet le texte et émet `visual_response` si un contenu visuel est présent. |
| `sendReaction` | `(chatId: string, key: unknown, emoji: string) => Promise<boolean>` | Émet l'événement `reaction` vers la TUI. |
| `setPresence` | `(chatId: string, presence: string) => Promise<void>` | Émet l'événement `presence` vers la TUI. |
| `submitUserMessage` | `(text: string, options?: Partial<MessageData>) => void` | Injecte une saisie utilisateur de la TUI vers les `messageCallbacks` enregistrés. |
| `requestConfirmation` | `(type: string, data: unknown, description: string) => Promise<{ approved: boolean; feedback?: string }>` | Génère un identifiant unique `conf-<UUID>`, émet `confirmation_request` et attend la décision opérateur. |
| `submitConfirmationResponse` | `(id: string, approved: boolean, feedback?: string) => void` | Résout la promesse de confirmation HITL associée à l'identifiant. |
| `setSessionId` / `getSessionId` | `(id: string) => void` / `() => string` | Définit et récupère l'identifiant de session de la TUI locale (`'tui-local'` par défaut). |
| `isConnected` | `() => boolean` | Indique si le transport est initialisé. |

---

## 3. Schéma de Configuration & Fichier `tui-connection.json`

Au démarrage du serveur, le fichier `tui-connection.json` est généré à la racine du projet avec la structure suivante :

```json
{
  "host": "localhost",
  "port": 5001,
  "token": "<votre-jeton-uuid-aleatoire>"
}
```

| Propriété | Type | Description |
| :--- | :--- | :--- |
| `host` | `string` | Hôte d'écoute (toujours `'localhost'` / `127.0.0.1`). |
| `port` | `number` | Port d'écoute WebSocket alloué (ex. `5001`, `5002`...). |
| `token` | `string` | Jeton UUIDv4 à transmettre lors de la première trame d'authentification. |

---

## 4. Codes de Statut & Fermetures WebSocket

| Code Statut | Motif (*Reason*) | Condition de Déclenchement |
| :--- | :--- | :--- |
| `4401` | `Unauthorized timeout` | Le client ne s'est pas authentifié dans le délai imparti de 3 000 ms après la connexion. |
| `4403` | `Invalid token` | Le jeton transmis dans la trame `auth` ne correspond pas au jeton de session du serveur. |
| `1001` | `Server shutting down` | Le serveur `TuiServerTransport` s'arrête (fermeture ordonnée du démon). |

---

## 5. Exemple d'Utilisation Minimal

### Démarrage et Utilisation Côté Démon

```typescript
import { tuiServerTransport } from '../../src/core/transport/TuiServerTransport.js';
import { hiveTransport } from '../../src/core/transport/tui/HiveTransport.js';

// 1. Démarrer le transport et le serveur IPC
await hiveTransport.connect();
await tuiServerTransport.start();

// 2. Envoyer un message vers la TUI
await hiveTransport.sendText('tui-local', 'Bonjour depuis le démon headless HIVE-MIND !');

// 3. Demander une approbation HITL
const result = await hiveTransport.requestConfirmation(
  'shell_exec',
  { command: 'npm run build' },
  'Exécuter la compilation TypeScript ?'
);
console.log('Décision opérateur :', result.approved, result.feedback);

// 4. Arrêt propre
await tuiServerTransport.stop();
```

---

## 6. Limitations & Invariants Opérationnels

- **Confinement Réseau :** Écoute strictement limitée à `127.0.0.1`.
- **Portée HITL :** Les requêtes de confirmation en attente sont conservées en mémoire vive dans une `Map<string, PromiseResolver>`. Un redémarrage du démon annule les requêtes en cours.
- **Cycle de Vie du Fichier de Liaison :** `tui-connection.json` est éphémère et ne doit en aucun cas être commité dans le gestionnaire de versions Git (inscrit dans `.gitignore`).
