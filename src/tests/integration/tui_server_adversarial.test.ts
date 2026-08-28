import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { join } from 'node:path';
import WebSocketModule from 'ws';
import { safeExistsSync, safeReadFileSync, safeUnlinkSync } from '../../utils/safeFs.js';
import { TuiServerTransport } from '../../core/transport/TuiServerTransport.js';
import { hiveTransport } from '../../core/transport/tui/HiveTransport.js';
import type { MessageData } from '../../core/types/BotTypes.js';

const WebSocket = WebSocketModule;

interface ServerConfig {
  host: string;
  port: number;
  token: string;
}

const configPath = join(process.cwd(), 'tui-connection.json');

const cleanupConfig = () => {
  if (safeExistsSync(configPath)) {
    try {
      safeUnlinkSync(configPath);
    } catch {
      /* ignore */
    }
  }
};

describe('Adversarial TUI Server - Authentication & Injection Vectors', () => {
  let server: TuiServerTransport;

  beforeEach(async () => {
    cleanupConfig();
    await hiveTransport.disconnect();
    server = new TuiServerTransport();
  });

  afterEach(async () => {
    try {
      await server.stop();
    } catch {
      /* ignore */
    }
    await hiveTransport.disconnect();
    cleanupConfig();
  });

  it('VECTEUR 1: Rejet immédiat avec code 4403 sur token invalide ou manquant', async () => {
    await server.start();
    const config: ServerConfig = JSON.parse(safeReadFileSync(configPath, 'utf-8'));

    // Test 1.1: Faux token
    const wsWrong = new WebSocket(`ws://127.0.0.1:${config.port}`);
    const closeWrongPromise = new Promise<{ code: number; reason: string }>((resolve) => {
      wsWrong.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    wsWrong.on('open', () => {
      wsWrong.send(JSON.stringify({ type: 'auth', token: 'ATTACKER_TOKEN_00000000' }));
    });
    const resWrong = await closeWrongPromise;
    expect(resWrong.code).toBe(4403);
    expect(resWrong.reason).toContain('Invalid token');

    // Test 1.2: Token vide
    const wsEmpty = new WebSocket(`ws://127.0.0.1:${config.port}`);
    const closeEmptyPromise = new Promise<{ code: number; reason: string }>((resolve) => {
      wsEmpty.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    wsEmpty.on('open', () => {
      wsEmpty.send(JSON.stringify({ type: 'auth', token: '' }));
    });
    const resEmpty = await closeEmptyPromise;
    expect(resEmpty.code).toBe(4403);

    // Test 1.3: Auth sans propriété token
    const wsMissing = new WebSocket(`ws://127.0.0.1:${config.port}`);
    const closeMissingPromise = new Promise<{ code: number; reason: string }>((resolve) => {
      wsMissing.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    wsMissing.on('open', () => {
      wsMissing.send(JSON.stringify({ type: 'auth' }));
    });
    const resMissing = await closeMissingPromise;
    expect(resMissing.code).toBe(4403);
  });

  it("VECTEUR 2: Expiration et clôture avec code 4401 après délai d'inactivité auth (3s)", async () => {
    await server.start();
    const config: ServerConfig = JSON.parse(safeReadFileSync(configPath, 'utf-8'));

    const wsSilent = new WebSocket(`ws://127.0.0.1:${config.port}`);
    const startTime = Date.now();

    const closePromise = new Promise<{ code: number; reason: string; elapsed: number }>((resolve) => {
      wsSilent.on('close', (code, reason) => {
        const elapsed = Date.now() - startTime;
        resolve({ code, reason: reason.toString(), elapsed });
      });
    });

    const res = await closePromise;
    expect(res.code).toBe(4401);
    expect(res.reason).toContain('Unauthorized timeout');
    expect(res.elapsed).toBeGreaterThanOrEqual(2900);
    expect(res.elapsed).toBeLessThanOrEqual(4500);
  }, 6000);

  it('VECTEUR 3: Authentification valide et transmission bidirectionnelle', async () => {
    await server.start();
    const config: ServerConfig = JSON.parse(safeReadFileSync(configPath, 'utf-8'));

    const wsValid = new WebSocket(`ws://127.0.0.1:${config.port}`);
    const receivedMessages: unknown[] = [];

    const authSuccessPromise = new Promise<void>((resolve) => {
      wsValid.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        receivedMessages.push(msg);
        if (msg.type === 'auth_success') resolve();
      });
    });

    wsValid.on('open', () => {
      wsValid.send(JSON.stringify({ type: 'auth', token: config.token }));
    });

    await authSuccessPromise;
    expect(receivedMessages.some((m: unknown) => (m as { type?: string }).type === 'auth_success')).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    expect(receivedMessages.some((m: unknown) => (m as { type?: string }).type === 'connection_status')).toBe(true);

    let capturedUserMessage = '';
    hiveTransport.onMessage((msg: MessageData) => {
      capturedUserMessage = msg.text;
    });

    wsValid.send(JSON.stringify({ type: 'user_message', text: 'Ping from adversary harness' }));
    await new Promise((r) => setTimeout(r, 100));
    expect(capturedUserMessage).toBe('Ping from adversary harness');

    const broadcastReceivedPromise = new Promise<unknown>((resolve) => {
      wsValid.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'presence') resolve(msg);
      });
    });

    hiveTransport.emit('presence', { chatId: 'adv-test', presence: 'composing' });
    const broadcastMsg = await broadcastReceivedPromise;
    expect(broadcastMsg).toBeDefined();
    expect((broadcastMsg as { data: { presence: string } }).data.presence).toBe('composing');

    wsValid.close();
  });

  it('VECTEUR 5: Injection de charges malveillantes / JSON corrompu avant authentification', async () => {
    await server.start();
    const config: ServerConfig = JSON.parse(safeReadFileSync(configPath, 'utf-8'));

    const wsAttacker = new WebSocket(`ws://127.0.0.1:${config.port}`);
    let receivedAnyMessage = false;

    wsAttacker.on('message', () => {
      receivedAnyMessage = true;
    });

    let interceptedCoreMessage = '';
    hiveTransport.onMessage((msg: MessageData) => {
      interceptedCoreMessage = msg.text;
    });

    await new Promise<void>((resolve) => {
      wsAttacker.on('open', () => resolve());
    });

    wsAttacker.send('{malformed-json: true,');
    wsAttacker.send('12345');
    wsAttacker.send('"string-payload"');
    wsAttacker.send('null');
    wsAttacker.send(JSON.stringify({ type: 'user_message', text: 'INJECTED_UNAUTH_COMMAND' }));
    wsAttacker.send(JSON.stringify({ type: 'confirmation_response', id: 'fake-id', approved: true }));

    await new Promise((r) => setTimeout(r, 200));

    expect(interceptedCoreMessage).toBe('');
    expect(receivedAnyMessage).toBe(false);

    wsAttacker.close();
  });
});

describe('Adversarial TUI Server - Lifecycle, Port Conflict & Concurrency', () => {
  let server: TuiServerTransport;

  beforeEach(async () => {
    cleanupConfig();
    await hiveTransport.disconnect();
    server = new TuiServerTransport();
  });

  afterEach(async () => {
    try {
      await server.stop();
    } catch {
      /* ignore */
    }
    await hiveTransport.disconnect();
    cleanupConfig();
  });

  it('VECTEUR 4: Cycle de vie du fichier tui-connection.json et ports dynamiques', async () => {
    expect(safeExistsSync(configPath)).toBe(false);

    await server.start();
    expect(safeExistsSync(configPath)).toBe(true);

    const config1: ServerConfig = JSON.parse(safeReadFileSync(configPath, 'utf-8'));
    expect(config1.host).toBe('localhost');
    expect(typeof config1.port).toBe('number');
    expect(config1.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const server2 = new TuiServerTransport();
    await server2.start();

    const config2: ServerConfig = JSON.parse(safeReadFileSync(configPath, 'utf-8'));
    expect(config2.port).not.toBe(config1.port);
    expect(config2.port).toBeGreaterThanOrEqual(config1.port);

    await server2.stop();
    await server.stop();
    expect(safeExistsSync(configPath)).toBe(false);
  });

  it('VECTEUR 6: Concurrence massive (Clients valides vs Clients attaquants sous charge)', async () => {
    await server.start();
    const config: ServerConfig = JSON.parse(safeReadFileSync(configPath, 'utf-8'));

    const VALID_COUNT = 5;
    const ATTACKER_COUNT = 5;

    const validSockets: WebSocketModule[] = [];
    const validAuthPromises: Promise<boolean>[] = [];
    const attackerClosePromises: Promise<number>[] = [];

    for (let i = 0; i < ATTACKER_COUNT; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${config.port}`);
      attackerClosePromises.push(
        new Promise<number>((resolve) => {
          ws.on('close', (code) => resolve(code));
          ws.on('open', () => {
            ws.send(JSON.stringify({ type: 'auth', token: `INVALID_FLOOD_${i}` }));
          });
        }),
      );
    }

    for (let i = 0; i < VALID_COUNT; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${config.port}`);
      validSockets.push(ws);

      validAuthPromises.push(
        new Promise<boolean>((resolve) => {
          ws.on('message', (raw) => {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'auth_success') resolve(true);
          });
          ws.on('open', () => {
            ws.send(JSON.stringify({ type: 'auth', token: config.token }));
          });
        }),
      );
    }

    const attackerResults = await Promise.all(attackerClosePromises);
    expect(attackerResults.every((code) => code === 4403)).toBe(true);

    const validResults = await Promise.all(validAuthPromises);
    expect(validResults.every((auth) => auth === true)).toBe(true);

    const broadcastCountPromises = validSockets.map(
      (ws) =>
        new Promise<boolean>((resolve) => {
          ws.on('message', (raw) => {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'presence') resolve(true);
          });
        }),
    );

    hiveTransport.emit('presence', { chatId: 'stress-chat', presence: 'paused' });

    const broadcastResults = await Promise.all(broadcastCountPromises);
    expect(broadcastResults.every((rec) => rec === true)).toBe(true);

    validSockets.forEach((ws) => ws.close());
  });

  it('VECTEUR 7: Arrêt du serveur notifie tous les clients connectés avec code 1001', async () => {
    await server.start();
    const config: ServerConfig = JSON.parse(safeReadFileSync(configPath, 'utf-8'));

    const ws = new WebSocket(`ws://127.0.0.1:${config.port}`);
    await new Promise<void>((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'auth_success') resolve();
      });
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: config.token }));
      });
    });

    const shutdownPromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    await server.stop();
    const shutdownRes = await shutdownPromise;

    expect(shutdownRes.code).toBe(1001);
    expect(shutdownRes.reason).toContain('Server shutting down');
  });
});
