import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { join } from 'node:path';
import { WebSocket as WsClient, type RawData } from 'ws';
import { safeReadFileSync } from '../../utils/safeFs.js';
import { TuiServerTransport } from '../../core/transport/TuiServerTransport.js';
import { hiveTransport } from '../../core/transport/tui/HiveTransport.js';

interface WebSocketMessage {
  type: string;
  data?: unknown;
  connected?: boolean;
}

interface ClientHandle {
  ws: WsClient;
  messages: WebSocketMessage[];
  waitForMessage: (
    predicate: (msg: WebSocketMessage) => boolean,
    timeoutMs?: number,
  ) => Promise<WebSocketMessage>;
}

async function createAuthenticatedClient(configPath: string): Promise<ClientHandle> {
  const config = JSON.parse(safeReadFileSync(configPath, 'utf-8'));
  const ws = new WsClient(`ws://127.0.0.1:${config.port}`);
  const messages: WebSocketMessage[] = [];

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: config.token }));
    });
    ws.on('message', (raw: RawData) => {
      try {
        const parsed = JSON.parse(raw.toString()) as WebSocketMessage;
        messages.push(parsed);
        if (parsed.type === 'auth_success') {
          resolve();
        }
      } catch (e) {
        reject(e);
      }
    });
    ws.on('error', reject);
  });

  const waitForMessage = (
    predicate: (msg: WebSocketMessage) => boolean,
    timeoutMs: number = 2000,
  ): Promise<WebSocketMessage> => {
    return new Promise<WebSocketMessage>((resolve, reject) => {
      const existing = messages.find(predicate);
      if (existing) {
        return resolve(existing);
      }

      const timer = setTimeout(() => {
        ws.off('message', onMsg);
        reject(new Error(`Timed out waiting for message matching predicate after ${timeoutMs}ms.`));
      }, timeoutMs);

      const onMsg = (raw: RawData) => {
        try {
          const parsed = JSON.parse(raw.toString()) as WebSocketMessage;
          if (predicate(parsed)) {
            clearTimeout(timer);
            ws.off('message', onMsg);
            resolve(parsed);
          }
        } catch {
          /* ignore */
        }
      };

      ws.on('message', onMsg);
    });
  };

  return { ws, messages, waitForMessage };
}

describe('HiveTransport ↔ TuiServerTransport Stream Challenge — Core Events', () => {
  let server: TuiServerTransport;
  const configPath = join(process.cwd(), 'tui-connection.json');

  beforeEach(() => {
    server = new TuiServerTransport();
  });

  afterEach(async () => {
    try {
      await server.stop();
    } catch {
      /* ignore */
    }
  });

  it('streams message, presence, and confirmation_request over WebSocket', async () => {
    await server.start();
    const { ws, waitForMessage } = await createAuthenticatedClient(configPath);

    // 1. Message
    await hiveTransport.sendText('ws-chat-1', 'Streaming text payload test', {
      sourceChannel: 'ink-cli',
    });
    const msgEvt = await waitForMessage((m) => m.type === 'message');
    const msgData = msgEvt.data as { chatId: string; text: string; sender: string };
    expect(msgData.chatId).toBe('ws-chat-1');
    expect(msgData.text).toBe('Streaming text payload test');
    expect(msgData.sender).toBe('assistant');

    // 2. Presence
    await hiveTransport.setPresence('ws-chat-1', 'recording');
    const presenceEvt = await waitForMessage((m) => m.type === 'presence');
    const presenceData = presenceEvt.data as { chatId: string; presence: string };
    expect(presenceData).toEqual({ chatId: 'ws-chat-1', presence: 'recording' });

    // 3. Confirmation request
    const confPromise = hiveTransport.requestConfirmation(
      'exec_command',
      { cmd: 'status' },
      'Check status',
    );
    const confEvt = await waitForMessage((m) => m.type === 'confirmation_request');
    const confData = confEvt.data as {
      id: string;
      type: string;
      description: string;
      data: { cmd: string };
    };
    expect(confData.type).toBe('exec_command');
    expect(confData.description).toBe('Check status');
    expect(confData.data).toEqual({ cmd: 'status' });
    expect(confData.id).toMatch(/^conf-/);

    // Client responds to confirmation
    ws.send(
      JSON.stringify({
        type: 'confirmation_response',
        id: confData.id,
        approved: true,
        feedback: 'Approved by test client',
      }),
    );
    const confResult = await confPromise;
    expect(confResult).toEqual({ approved: true, feedback: 'Approved by test client' });

    ws.close();
  });
});

describe('HiveTransport ↔ TuiServerTransport Stream Challenge — Rich Payloads & Multi-Client', () => {
  let server: TuiServerTransport;
  const configPath = join(process.cwd(), 'tui-connection.json');

  beforeEach(() => {
    server = new TuiServerTransport();
  });

  afterEach(async () => {
    try {
      await server.stop();
    } catch {
      /* ignore */
    }
  });

  it('streams media, voice, file, sticker, and visual_response over WebSocket with fidelity', async () => {
    await server.start();
    const { ws, waitForMessage } = await createAuthenticatedClient(configPath);

    // Media
    await hiveTransport.sendMedia('ws-chat-1', 'https://example.com/image.jpg', {
      type: 'image',
      fileName: 'image.jpg',
      caption: 'Example image',
    });
    const mediaEvt = await waitForMessage((m) => m.type === 'media');
    const mediaData = mediaEvt.data as {
      chatId: string;
      media: string;
      type: string;
      filename: string;
      caption: string;
    };
    expect(mediaData).toEqual({
      chatId: 'ws-chat-1',
      media: 'https://example.com/image.jpg',
      type: 'image',
      filename: 'image.jpg',
      caption: 'Example image',
    });

    // Voice
    await hiveTransport.sendVoiceNote('ws-chat-1', 'base64-fake-audio', {
      duration: 3.5,
      ptt: true,
    });
    const voiceEvt = await waitForMessage((m) => m.type === 'voice');
    const voiceData = voiceEvt.data as {
      chatId: string;
      audio: string;
      options: { duration: number; ptt: boolean };
    };
    expect(voiceData).toEqual({
      chatId: 'ws-chat-1',
      audio: 'base64-fake-audio',
      options: { duration: 3.5, ptt: true },
    });

    // File
    await hiveTransport.sendFile('ws-chat-1', 'docs/sample.pdf', 'sample.pdf', 'PDF document');
    const fileEvt = await waitForMessage((m) => m.type === 'file');
    const fileData = fileEvt.data as {
      chatId: string;
      filePath: string;
      fileName: string;
      caption: string;
    };
    expect(fileData).toEqual({
      chatId: 'ws-chat-1',
      filePath: 'docs/sample.pdf',
      fileName: 'sample.pdf',
      caption: 'PDF document',
    });

    // Sticker
    const stickerBuffer = Buffer.from('TEST_STICKER');
    await hiveTransport.sendSticker('ws-chat-1', stickerBuffer);
    const stickerEvt = await waitForMessage((m) => m.type === 'sticker');
    const stickerData = stickerEvt.data as {
      chatId: string;
      stickerBuffer: { type: string; data: number[] };
    };
    expect(stickerData.chatId).toBe('ws-chat-1');
    expect(Buffer.from(stickerData.stickerBuffer.data)).toEqual(stickerBuffer);

    // Visual Response
    await hiveTransport.sendUniversalResponse('ws-chat-1', {
      markdown: 'Dashboard chart',
      visual: { type: 'bar_chart', values: [1, 2, 3] },
    });
    const visualEvt = await waitForMessage((m) => m.type === 'visual_response');
    const visualData = visualEvt.data as {
      chatId: string;
      visual: { type: string; values: number[] };
    };
    expect(visualData).toEqual({
      chatId: 'ws-chat-1',
      visual: { type: 'bar_chart', values: [1, 2, 3] },
    });

    ws.close();
  });

  it('handles multiple concurrent WebSocket clients simultaneously receiving broadcasted events', async () => {
    await server.start();

    const clientCount = 5;
    const clients: ClientHandle[] = [];
    for (let i = 0; i < clientCount; i++) {
      const client = await createAuthenticatedClient(configPath);
      clients.push(client);
    }

    const receivedCountPerClient = Array.from<number>({ length: clientCount }).fill(0);
    const eventTotal = 20;

    for (let i = 0; i < clientCount; i++) {
      const clientIndex = i;
      const targetClient = clients.at(clientIndex);
      targetClient?.ws.on('message', (raw: RawData) => {
        try {
          const parsed = JSON.parse(raw.toString()) as WebSocketMessage;
          if (parsed.type === 'presence') {
            const current = receivedCountPerClient.at(clientIndex) ?? 0;
            Reflect.set(receivedCountPerClient, clientIndex, current + 1);
          }
        } catch {
          /* ignore */
        }
      });
    }

    for (let i = 0; i < eventTotal; i++) {
      await hiveTransport.setPresence('broadcast-chat', `state-${i}`);
    }

    await new Promise((r) => setTimeout(r, 200));

    for (let i = 0; i < clientCount; i++) {
      expect(receivedCountPerClient.at(i)).toBe(eventTotal);
      clients.at(i)?.ws.close();
    }
  });

  it('investigates reaction routing across WebSocket boundary', async () => {
    await server.start();
    const { ws, waitForMessage } = await createAuthenticatedClient(configPath);

    let reactionEmittedOnHiveTransport = false;
    hiveTransport.on('reaction', () => {
      reactionEmittedOnHiveTransport = true;
    });

    await hiveTransport.sendReaction('ws-chat-1', { id: 'msg-target' }, '👍');
    expect(reactionEmittedOnHiveTransport).toBe(true);

    let receivedOnWs: boolean;
    try {
      await waitForMessage((m) => m.type === 'reaction', 300);
      receivedOnWs = true;
    } catch {
      receivedOnWs = false;
    }

    expect(reactionEmittedOnHiveTransport).toBe(true);
    expect(receivedOnWs).toBe(false);

    ws.close();
  });
});
