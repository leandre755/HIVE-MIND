import { WebSocketServer, WebSocket } from 'ws';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeUnlinkSync, safeWriteFileSync } from '../../utils/safeFs.js';
import {
  hiveTransport,
  type ConfirmationRequestPayload,
  type ConnectionStatusPayload,
  type FilePayload,
  type HiveTransportEvents,
  type MediaPayload,
  type PresencePayload,
  type StickerPayload,
  type VisualResponsePayload,
  type VoicePayload,
} from '../../tui/transport/HiveTransport.js';
import type { MessageData } from '../types/BotTypes.js';

/** Commandes acceptées depuis un client TUI authentifié. */
interface AuthCommand {
  type: 'auth';
  token?: string;
}

interface UserMessageCommand {
  type: 'user_message';
  text: string;
  options?: Partial<MessageData>;
}

interface ConfirmationResponseCommand {
  type: 'confirmation_response';
  id: string;
  approved: boolean;
  feedback?: string;
}

type ClientCommand = AuthCommand | UserMessageCommand | ConfirmationResponseCommand;

/**
 * Valide la forme d'un payload client avant tout déréférencement.
 * Fail closed : un JSON qui n'est pas un objet porteur d'un `type` string est rejeté.
 */
function parseClientCommand(raw: string): ClientCommand | null {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as { type?: unknown };
  if (typeof candidate.type !== 'string') return null;
  return parsed as ClientCommand;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** `code` n'existe pas sur `Error` : les erreurs `net` le portent en supplément. */
const errorCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;

export class TuiServerTransport {
  private wss: WebSocketServer | null = null;
  private port = 5001;
  private token = '';
  private configPath = join(process.cwd(), 'tui-connection.json');
  private authenticatedClients = new Set<WebSocket>();

  // Liens vers les listeners pour pouvoir les désabonner proprement au shutdown
  private onMessageListener = (message: MessageData) => this.broadcast('message', message);
  private onPresenceListener = (presence: PresencePayload) => this.broadcast('presence', presence);
  private onConfirmRequestListener = (request: ConfirmationRequestPayload) =>
    this.broadcast('confirmation_request', request);
  private onMediaListener = (media: MediaPayload) => this.broadcast('media', media);
  private onVoiceListener = (voice: VoicePayload) => this.broadcast('voice', voice);
  private onFileListener = (file: FilePayload) => this.broadcast('file', file);
  private onStickerListener = (sticker: StickerPayload) => this.broadcast('sticker', sticker);
  private onVisualResponseListener = (visual: VisualResponsePayload) =>
    this.broadcast('visual_response', visual);
  private onConnectionStatusListener = (status: ConnectionStatusPayload) =>
    this.broadcast('connection_status', status);

  constructor() {
    this.token = randomUUID();
  }

  /**
   * Journalise les erreurs socket survenant après la liaison réussie du port.
   * Extraite de `listenOnFreePort` : imbriquée, elle dépassait la profondeur autorisée.
   */
  private static onRuntimeSocketError(runtimeErr: unknown): void {
    console.error('[TuiServerTransport] ❌ Erreur runtime socket:', errorMessage(runtimeErr));
  }

  /**
   * Tente d'instancier un WebSocketServer sur un port libre (fallback dynamique si EADDRINUSE).
   */
  private async listenOnFreePort(
    basePort: number,
    maxAttempts: number = 20,
  ): Promise<{ wss: WebSocketServer; boundPort: number }> {
    return new Promise((resolve, reject) => {
      let attempt = 0;

      const tryNext = (port: number) => {
        const server = new WebSocketServer({ port, host: '127.0.0.1' });

        const onError = (err: unknown) => {
          server.removeListener('error', onError);
          server.removeListener('listening', onListening);
          try {
            server.close();
          } catch {
            /* le serveur n'a jamais été lié : rien à fermer */
          }

          if (errorCode(err) === 'EADDRINUSE' && attempt < maxAttempts - 1) {
            attempt++;
            console.warn(
              `[TuiServerTransport] ⚠️ Port ${port} déjà utilisé. Essai du port ${port + 1}...`,
            );
            tryNext(port + 1);
          } else {
            reject(err instanceof Error ? err : new Error(errorMessage(err)));
          }
        };

        const onListening = () => {
          server.removeListener('error', onError);
          server.removeListener('listening', onListening);
          server.on('error', TuiServerTransport.onRuntimeSocketError);
          resolve({ wss: server, boundPort: port });
        };

        server.once('error', onError);
        server.once('listening', onListening);
      };

      tryNext(basePort);
    });
  }

  /**
   * Démarre le serveur WebSocket et écrit le fichier de configuration.
   */
  async start(): Promise<void> {
    try {
      // Recherche et liaison dynamique sur un port libre à partir de 5001
      const { wss, boundPort } = await this.listenOnFreePort(5001);
      this.wss = wss;
      this.port = boundPort;

      // Écrire le fichier de configuration avec le port effectif retenu
      const configData = {
        host: 'localhost',
        port: this.port,
        token: this.token,
      };
      safeWriteFileSync(this.configPath, JSON.stringify(configData, null, 2), 'utf-8');
      console.log(`[TuiServerTransport] 📄 Configuration écrite dans ${this.configPath}`);

      this.wss.on('connection', (ws) => {
        let isAuthenticated = false;

        // Timeout pour s'authentifier
        const authTimeout = setTimeout(() => {
          if (!isAuthenticated) {
            console.warn(
              "[TuiServerTransport] ⚠️ Déconnexion client : délai d'authentification dépassé.",
            );
            ws.close(4401, 'Unauthorized timeout');
          }
        }, 3000);

        ws.on('message', (data) => {
          try {
            const command = parseClientCommand(data.toString());
            if (!command) {
              console.warn('[TuiServerTransport] ⚠️ Payload client ignoré : forme invalide.');
              return;
            }

            if (!isAuthenticated) {
              if (command.type === 'auth' && command.token === this.token) {
                isAuthenticated = true;
                clearTimeout(authTimeout);
                this.authenticatedClients.add(ws);
                ws.send(JSON.stringify({ type: 'auth_success' }));
                console.log('[TuiServerTransport] 🔑 Client TUI authentifié avec succès.');
                // Envoyer l'état de connexion de hiveTransport
                ws.send(
                  JSON.stringify({
                    type: 'connection_status',
                    connected: hiveTransport.isConnected(),
                  }),
                );
              } else {
                console.warn(
                  '[TuiServerTransport] ❌ Tentative de connexion avec un token invalide.',
                );
                ws.close(4403, 'Invalid token');
              }
              return;
            }

            // Traitement des commandes une fois authentifié
            if (command.type === 'user_message') {
              hiveTransport.submitUserMessage(command.text, command.options || {});
            } else if (command.type === 'confirmation_response') {
              hiveTransport.submitConfirmationResponse(
                command.id,
                command.approved,
                command.feedback,
              );
            }
          } catch (err: unknown) {
            console.error(
              '[TuiServerTransport] Erreur traitement message client:',
              errorMessage(err),
            );
          }
        });

        ws.on('close', () => {
          clearTimeout(authTimeout);
          this.authenticatedClients.delete(ws);
          console.log('[TuiServerTransport] 🔌 Client TUI déconnecté.');
        });

        ws.on('error', (err) => {
          console.error('[TuiServerTransport] Erreur socket client:', err.message);
        });
      });

      // S'abonner aux événements de hiveTransport
      hiveTransport.on('message', this.onMessageListener);
      hiveTransport.on('presence', this.onPresenceListener);
      hiveTransport.on('confirmation_request', this.onConfirmRequestListener);
      hiveTransport.on('media', this.onMediaListener);
      hiveTransport.on('voice', this.onVoiceListener);
      hiveTransport.on('file', this.onFileListener);
      hiveTransport.on('sticker', this.onStickerListener);
      hiveTransport.on('visual_response', this.onVisualResponseListener);
      hiveTransport.on('connection_status', this.onConnectionStatusListener);

      console.log(
        `[TuiServerTransport] 🚀 Serveur WebSocket démarré sur ws://localhost:${this.port}`,
      );
    } catch (error: unknown) {
      console.error(
        '[TuiServerTransport] ❌ Impossible de démarrer le serveur WebSocket:',
        errorMessage(error),
      );
    }
  }

  /**
   * Arrête le serveur et nettoie les fichiers temporaires.
   */
  async stop(): Promise<void> {
    // Désabonner les listeners
    hiveTransport.off('message', this.onMessageListener);
    hiveTransport.off('presence', this.onPresenceListener);
    hiveTransport.off('confirmation_request', this.onConfirmRequestListener);
    hiveTransport.off('media', this.onMediaListener);
    hiveTransport.off('voice', this.onVoiceListener);
    hiveTransport.off('file', this.onFileListener);
    hiveTransport.off('sticker', this.onStickerListener);
    hiveTransport.off('visual_response', this.onVisualResponseListener);
    hiveTransport.off('connection_status', this.onConnectionStatusListener);

    // Fermer tous les clients connectés
    for (const ws of this.authenticatedClients) {
      try {
        ws.close(1001, 'Server shutting down');
      } catch {
        /* ignore */
      }
    }
    this.authenticatedClients.clear();

    // Fermer le serveur
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    // Supprimer le fichier de liaison
    try {
      safeUnlinkSync(this.configPath);
      console.log('[TuiServerTransport] 🗑️ Fichier tui-connection.json supprimé.');
    } catch {
      // ignore si déjà supprimé
    }

    console.log('[TuiServerTransport] 🛑 Serveur WebSocket arrêté.');
  }

  /**
   * Diffuse un événement à tous les clients TUI authentifiés.
   * Le type est la clé d'événement de `hiveTransport` et `data` son payload associé :
   * l'appariement des deux est donc vérifié à la compilation.
   */
  private broadcast<K extends keyof HiveTransportEvents>(
    type: K,
    data: HiveTransportEvents[K][0],
  ): void {
    const payload = JSON.stringify({ type, data });
    for (const ws of this.authenticatedClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch (err: unknown) {
          console.error('[TuiServerTransport] Erreur envoi broadcast:', errorMessage(err));
        }
      }
    }
  }
}

export const tuiServerTransport = new TuiServerTransport();
export default tuiServerTransport;
