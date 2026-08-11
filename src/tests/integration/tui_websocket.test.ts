import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import WebSocketModule from 'ws';
import { TuiServerTransport } from '../../core/transport/TuiServerTransport.js';
import { HiveCoreConnection } from '../../tui/core/connection.js';
import { hiveTransport } from '../../tui/transport/HiveTransport.js';
import { ToolConfirmationOutcome } from '../../tui/ui/contexts/UIStateContext.js';

const WebSocket = WebSocketModule;

describe('TUI WebSocket Integration Suite', () => {
  let server: TuiServerTransport;
  let client: HiveCoreConnection;
  const configPath = join(process.cwd(), 'tui-connection.json');

  beforeEach(() => {
    server = new TuiServerTransport();
    client = new HiveCoreConnection();
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
    expect(existsSync(configPath)).toBe(true);
  });

  it('authentification réussie du client HiveCoreConnection', async () => {
    await server.start();

    let connectedStatus: string | null = null;
    client.onStatusChange((status) => {
      connectedStatus = status;
    });

    await client.connect();

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (client.getConnectionStatus() === 'connected') {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    expect(client.getConnectionStatus()).toBe('connected');
    expect(connectedStatus).toBe('connected');
  });

  it('rejet des connexions avec un token invalide', async () => {
    await server.start();

    const rawWs = new WebSocket('ws://127.0.0.1:5001');

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
    await client.connect();

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (client.getConnectionStatus() === 'connected') {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    const receivedEvents: Array<{ type: string }> = [];
    client.subscribe((event) => {
      receivedEvents.push(event as { type: string });
    });

    hiveTransport.emit('presence', { chatId: 'tui-local', presence: 'composing' });

    await new Promise((r) => setTimeout(r, 100));

    expect(receivedEvents.some((e) => e.type === 'agent_start')).toBe(true);
  });

  it('transmission du message utilisateur depuis le client TUI vers hiveTransport', async () => {
    await server.start();
    await client.connect();

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (client.getConnectionStatus() === 'connected') {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    let receivedUserText = '';
    hiveTransport.onMessage((msg) => {
      receivedUserText = msg.text;
    });

    await client.send({
      message: {
        content: [{ type: 'text', text: 'Bonjour HIVE-MIND !' }],
      },
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(receivedUserText).toBe('Bonjour HIVE-MIND !');
  });

  it('flux de confirmation de sécurité HITL (demande -> réponse client -> Core)', async () => {
    await server.start();
    await client.connect();

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (client.getConnectionStatus() === 'connected') {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    let confirmationReceived: { type: string; name?: string } | null = null;
    client.subscribe((event) => {
      const typed = event as { type: string; name?: string };
      if (typed.type === 'tool_request' && typed.name === 'security_confirmation') {
        confirmationReceived = typed;
      }
    });

    const confirmPromise = hiveTransport.requestConfirmation(
      'permission_request',
      {},
      'Autoriser la suppression du fichier temp.txt',
    );

    await new Promise((r) => setTimeout(r, 100));

    expect(confirmationReceived).not.toBeNull();
    const typedConfirmation = confirmationReceived as unknown as {
      confirmationDetails: {
        onConfirm: (
          outcome: ToolConfirmationOutcome,
          details: { approved: boolean },
        ) => Promise<void>;
      };
    };
    expect(typedConfirmation.confirmationDetails).toBeDefined();

    const details = typedConfirmation.confirmationDetails;
    await details.onConfirm(ToolConfirmationOutcome.Proceed, { approved: true });

    const result = await confirmPromise;

    expect(result).not.toBeNull();
    expect(result.approved).toBe(true);
  });

  it("nettoyage propre lors de l'arrêt du serveur", async () => {
    await server.start();
    expect(existsSync(configPath)).toBe(true);

    await server.stop();
    expect(existsSync(configPath)).toBe(false);
  });
});
