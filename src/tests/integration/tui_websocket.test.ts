import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { join } from 'node:path';
import WebSocketModule, { type RawData } from 'ws';
import { safeExistsSync, safeReadFileSync } from '../../utils/safeFs.js';
import { TuiServerTransport } from '../../core/transport/TuiServerTransport.js';
import { hiveTransport } from '../../core/transport/tui/HiveTransport.js';

const WebSocket = WebSocketModule;

interface WsMessage {
  type: string;
  data?: Record<string, unknown>;
  connected?: boolean;
  [key: string]: unknown;
}

class TestWebSocketClient {
  public ws: InstanceType<typeof WebSocket> | null = null;
  public messages: WsMessage[] = [];
  private messageListeners: Array<(msg: WsMessage) => void> = [];

  async connect(port: number, token: string): Promise<WsMessage> {
    return new Promise<WsMessage>((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${port}`);

      this.ws.on('open', () => {
        this.ws?.send(
          JSON.stringify({
            type: 'auth',
            token,
          }),
        );
      });

      this.ws.on('message', (raw: RawData) => {
        try {
          const parsed = JSON.parse(raw.toString()) as WsMessage;
          this.messages.push(parsed);
          for (const listener of this.messageListeners) {
            listener(parsed);
          }
          if (parsed.type === 'auth_success') {
            resolve(parsed);
          }
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on('error', (err) => {
        reject(err);
      });
    });
  }

  async waitForMessage(
    predicate: (msg: WsMessage) => boolean,
    timeoutMs = 3000,
  ): Promise<WsMessage> {
    const existing = this.messages.find(predicate);
    if (existing) return existing;

    return new Promise<WsMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for message matching predicate after ${timeoutMs}ms`));
      }, timeoutMs);

      const listener = (msg: WsMessage) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          const index = this.messageListeners.indexOf(listener);
          if (index !== -1) this.messageListeners.splice(index, 1);
          resolve(msg);
        }
      };

      this.messageListeners.push(listener);
    });
  }

  send(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.messages = [];
    this.messageListeners = [];
  }
}

describe('TUI WebSocket Integration Suite', () => {
  let server: TuiServerTransport;
  let client: TestWebSocketClient;
  const configPath = join(process.cwd(), 'tui-connection.json');

  beforeEach(() => {
    server = new TuiServerTransport();
    client = new TestWebSocketClient();
  });

  afterEach(async () => {
    try {
      await client.disconnect();
    } catch {
      /* ignore */
    }
    try {
      await server.stop();
    } catch {
      /* ignore */
    }
  });

  it('démarrage du serveur et création du fichier de configuration tui-connection.json', async () => {
    await server.start();
    expect(safeExistsSync(configPath)).toBe(true);
  });

  it('authentification réussie du client WebSocket avec jeton dynamique', async () => {
    await server.start();

    const config = JSON.parse(safeReadFileSync(configPath, 'utf-8'));
    const authResult = await client.connect(config.port, config.token);

    expect(authResult.type).toBe('auth_success');

    const statusMsg = await client.waitForMessage((m) => m.type === 'connection_status');
    expect(statusMsg.type).toBe('connection_status');
    expect(typeof statusMsg.connected).toBe('boolean');
  });

  it('rejet des connexions avec un token invalide', async () => {
    await server.start();

    const config = JSON.parse(safeReadFileSync(configPath, 'utf-8'));
    const rawWs = new WebSocket(`ws://127.0.0.1:${config.port}`);

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      rawWs.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    rawWs.on('open', () => {
      rawWs.send(
        JSON.stringify({
          type: 'auth',
          token: 'INVALID_TOKEN_12345',
        }),
      );
    });

    const res = await closePromise;
    expect(res.code).toBe(4403);
  });

  it('transmission des événements de présence du Core vers le client TUI', async () => {
    await server.start();
    const config = JSON.parse(safeReadFileSync(configPath, 'utf-8'));
    await client.connect(config.port, config.token);

    const presencePromise = client.waitForMessage(
      (m) =>
        m.type === 'presence' &&
        Boolean(m.data && m.data.chatId === 'tui-local' && m.data.presence === 'composing'),
    );

    hiveTransport.emit('presence', { chatId: 'tui-local', presence: 'composing' });

    const received = await presencePromise;
    expect(received.type).toBe('presence');
    expect(received.data?.chatId).toBe('tui-local');
    expect(received.data?.presence).toBe('composing');
  });

  it('transmission du message utilisateur depuis le client TUI vers hiveTransport', async () => {
    await server.start();
    const config = JSON.parse(safeReadFileSync(configPath, 'utf-8'));
    await client.connect(config.port, config.token);

    let receivedUserText = '';
    hiveTransport.onMessage((msg) => {
      receivedUserText = msg.text;
    });

    client.send({
      type: 'user_message',
      text: 'Bonjour HIVE-MIND !',
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(receivedUserText).toBe('Bonjour HIVE-MIND !');
  });

  it('flux de confirmation de sécurité HITL (demande -> réponse client -> Core)', async () => {
    await server.start();
    const config = JSON.parse(safeReadFileSync(configPath, 'utf-8'));
    await client.connect(config.port, config.token);

    const requestPromise = client.waitForMessage((m) => m.type === 'confirmation_request');

    const confirmPromise = hiveTransport.requestConfirmation(
      'permission_request',
      {},
      'Autoriser la suppression du fichier temp.txt',
    );

    const receivedReq = await requestPromise;
    expect(receivedReq.data).toBeDefined();
    const reqData = receivedReq.data as { id: string; type: string; description: string };
    expect(reqData.description).toBe('Autoriser la suppression du fichier temp.txt');

    client.send({
      type: 'confirmation_response',
      id: reqData.id,
      approved: true,
    });

    const result = await confirmPromise;

    expect(result).not.toBeNull();
    expect(result.approved).toBe(true);
  });

  it("nettoyage propre lors de l'arrêt du serveur", async () => {
    await server.start();
    expect(safeExistsSync(configPath)).toBe(true);

    await server.stop();
    expect(safeExistsSync(configPath)).toBe(false);
  });
});
