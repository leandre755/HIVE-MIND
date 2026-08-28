import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  hiveTransport,
  type PresencePayload,
  type ConfirmationRequestPayload,
  type MediaPayload,
  type VoicePayload,
  type FilePayload,
  type StickerPayload,
  type VisualResponsePayload,
  type ConnectionStatusPayload,
  type ReactionPayload,
} from '../../../core/transport/tui/HiveTransport.js';
import type { MessageData } from '../../../core/types/BotTypes.js';

describe('HiveTransport Challenge Suite — Part 1: Basic Event Routing', () => {
  beforeEach(async () => {
    hiveTransport.removeAllListeners();
    await hiveTransport.connect();
    hiveTransport.setSessionId('test-session-challenge');
  });

  afterEach(async () => {
    await hiveTransport.disconnect();
    hiveTransport.removeAllListeners();
  });

  it('routes "message" with exact shape, defaults, and custom options', async () => {
    let received: MessageData | null = null;
    hiveTransport.on('message', (msg: MessageData) => {
      received = msg;
    });

    const options = {
      quotedMessage: { text: 'quoted parent', sender: 'user1' },
      sourceChannel: 'custom-channel',
      rawMessage: { key: { id: 'msg-999' } },
    };

    const res = (await hiveTransport.sendText('chat-target-1', 'Hello Empirical World', options)) as {
      success: boolean;
      messageId: string;
    };

    expect(res.success).toBe(true);
    expect(res.messageId).toMatch(/^tui-msg-\d+$/);
    expect(received).not.toBeNull();
    expect(received).toEqual({
      chatId: 'chat-target-1',
      sender: 'assistant',
      text: 'Hello Empirical World',
      isGroup: false,
      sourceChannel: 'custom-channel',
      quotedMessage: { text: 'quoted parent', sender: 'user1' },
      rawMessage: { key: { id: 'msg-999' } },
    });
  });

  it('falls back to getSessionId() when chatId is empty in sendText', async () => {
    let received: MessageData | null = null;
    hiveTransport.on('message', (msg: MessageData) => {
      received = msg;
    });

    await hiveTransport.sendText('', 'Fallback Chat ID Test');

    expect(received).not.toBeNull();
    const typedMsg = received as unknown as MessageData;
    expect(typedMsg.chatId).toBe('test-session-challenge');
    expect(typedMsg.text).toBe('Fallback Chat ID Test');
  });

  it('routes "presence" with exact shape for diverse presence states', async () => {
    const receivedStates: PresencePayload[] = [];
    hiveTransport.on('presence', (p: PresencePayload) => {
      receivedStates.push(p);
    });

    const presences = ['composing', 'recording', 'paused', 'available', 'unavailable'];
    for (const presence of presences) {
      await hiveTransport.setPresence('chat-presence-1', presence);
    }

    expect(receivedStates).toHaveLength(5);
    for (let i = 0; i < presences.length; i++) {
      const item = receivedStates.at(i);
      expect(item).toEqual({
        chatId: 'chat-presence-1',
        presence: presences.at(i),
      });
    }
  });

  it('routes "confirmation_request" with exact shape, uuid id, and nested data preservation', async () => {
    let received: ConfirmationRequestPayload | null = null;
    hiveTransport.on('confirmation_request', (req: ConfirmationRequestPayload) => {
      received = req;
    });

    const complexData = {
      command: 'status_check',
      nested: { depth: 3, items: [1, 'two', { key: 'value' }] },
      flag: true,
      count: 42,
    };

    const confirmationPromise = hiveTransport.requestConfirmation(
      'permission_request',
      complexData,
      'Execute status check',
    );

    expect(received).not.toBeNull();
    const typedReq = received as unknown as ConfirmationRequestPayload;
    expect(typedReq.id).toMatch(/^conf-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(typedReq.type).toBe('permission_request');
    expect(typedReq.description).toBe('Execute status check');
    expect(typedReq.data).toEqual(complexData);

    hiveTransport.submitConfirmationResponse(typedReq.id, true, 'User approved via challenge');
    const resolution = await confirmationPromise;
    expect(resolution).toEqual({
      approved: true,
      feedback: 'User approved via challenge',
    });
  });

  it('routes "reaction" with exact shape, emoji, and key object', async () => {
    let received: ReactionPayload | null = null;
    hiveTransport.on('reaction', (r: ReactionPayload) => {
      received = r;
    });

    const messageKey = { id: 'msg-reaction-target', fromMe: false, participant: 'user@whatsapp' };
    const success = await hiveTransport.sendReaction('chat-react-1', messageKey, '🔥');

    expect(success).toBe(true);
    expect(received).not.toBeNull();
    expect(received).toEqual({
      chatId: 'chat-react-1',
      key: messageKey,
      emoji: '🔥',
    });
  });
});

describe('HiveTransport Challenge Suite — Part 2: Media, Voice, File, Visual', () => {
  beforeEach(async () => {
    hiveTransport.removeAllListeners();
    await hiveTransport.connect();
    hiveTransport.setSessionId('test-session-media');
  });

  afterEach(async () => {
    await hiveTransport.disconnect();
    hiveTransport.removeAllListeners();
  });

  it('routes "voice" with exact shape, buffer/string audio, and options', async () => {
    let received: VoicePayload | null = null;
    hiveTransport.on('voice', (v: VoicePayload) => {
      received = v;
    });

    const voiceBuffer = Buffer.from('RIFF_FAKE_WAV_BYTES_DATA');
    const voiceOptions = { ptt: true, duration: 12.5 };

    const res = (await hiveTransport.sendVoiceNote('chat-voice-1', voiceBuffer, voiceOptions)) as {
      success: boolean;
    };

    expect(res.success).toBe(true);
    expect(received).not.toBeNull();
    const typedVoice = received as unknown as VoicePayload;
    expect(typedVoice.chatId).toBe('chat-voice-1');
    expect(typedVoice.audio).toEqual(voiceBuffer);
    expect(typedVoice.options).toEqual(voiceOptions);
  });

  it('routes "media" with exact shape, filename mapping, and options', async () => {
    let received: MediaPayload | null = null;
    hiveTransport.on('media', (m: MediaPayload) => {
      received = m;
    });

    const mediaBuffer = Buffer.from('FAKE_IMAGE_DATA_BYTES');
    const res = (await hiveTransport.sendMedia('chat-media-1', mediaBuffer, {
      type: 'image',
      fileName: 'custom_chart.png',
      caption: 'Adversarial report chart',
    })) as { success: boolean };

    expect(res.success).toBe(true);
    expect(received).not.toBeNull();
    expect(received).toEqual({
      chatId: 'chat-media-1',
      media: mediaBuffer,
      type: 'image',
      filename: 'custom_chart.png',
      caption: 'Adversarial report chart',
    });
  });

  it('routes "file" with exact shape', async () => {
    let received: FilePayload | null = null;
    hiveTransport.on('file', (f: FilePayload) => {
      received = f;
    });

    const res = (await hiveTransport.sendFile(
      'chat-file-1',
      'var/data/dump.bin',
      'dump.bin',
      'Raw binary dump',
    )) as { success: boolean };

    expect(res.success).toBe(true);
    expect(received).not.toBeNull();
    expect(received).toEqual({
      chatId: 'chat-file-1',
      filePath: 'var/data/dump.bin',
      fileName: 'dump.bin',
      caption: 'Raw binary dump',
    });
  });

  it('routes "sticker" with exact shape', async () => {
    let received: StickerPayload | null = null;
    hiveTransport.on('sticker', (s: StickerPayload) => {
      received = s;
    });

    const stickerBuffer = Buffer.from('WEBP_STICKER_BYTES');
    const res = (await hiveTransport.sendSticker('chat-sticker-1', stickerBuffer)) as {
      success: boolean;
    };

    expect(res.success).toBe(true);
    expect(received).not.toBeNull();
    expect(received).toEqual({
      chatId: 'chat-sticker-1',
      stickerBuffer,
    });
  });

  it('routes "visual_response" and text in sendUniversalResponse', async () => {
    let receivedVisual: VisualResponsePayload | null = null;
    let receivedMessage: MessageData | null = null;

    hiveTransport.on('visual_response', (vr: VisualResponsePayload) => {
      receivedVisual = vr;
    });
    hiveTransport.on('message', (msg: MessageData) => {
      receivedMessage = msg;
    });

    const visualData = { type: 'chart', data: [10, 20, 30] };
    const res = (await hiveTransport.sendUniversalResponse('chat-univ-1', {
      markdown: '# Heading\nDetailed visual analysis',
      visual: visualData,
    })) as { success: boolean };

    expect(res.success).toBe(true);
    expect(receivedMessage).not.toBeNull();
    const typedMsg = receivedMessage as unknown as MessageData;
    expect(typedMsg.text).toBe('# Heading\nDetailed visual analysis');
    expect(receivedVisual).not.toBeNull();
    expect(receivedVisual).toEqual({
      chatId: 'chat-univ-1',
      visual: visualData,
    });
  });

  it('routes "connection_status" on connect() and disconnect()', async () => {
    const statuses: ConnectionStatusPayload[] = [];
    hiveTransport.on('connection_status', (s: ConnectionStatusPayload) => {
      statuses.push(s);
    });

    await hiveTransport.disconnect();
    expect(hiveTransport.isConnected()).toBe(false);

    await hiveTransport.connect();
    expect(hiveTransport.isConnected()).toBe(true);

    expect(statuses).toEqual([{ connected: false }, { connected: true }]);
  });
});

describe('HiveTransport Challenge Suite — Part 3: Concurrency & Stress', () => {
  beforeEach(async () => {
    hiveTransport.removeAllListeners();
    await hiveTransport.connect();
  });

  afterEach(async () => {
    await hiveTransport.disconnect();
    hiveTransport.removeAllListeners();
  });

  it('handles 100 concurrent HITL confirmation requests resolved out-of-order', async () => {
    const confirmationCount = 100;
    const emittedRequests: ConfirmationRequestPayload[] = [];

    hiveTransport.on('confirmation_request', (req: ConfirmationRequestPayload) => {
      emittedRequests.push(req);
    });

    const promises: Array<Promise<{ approved: boolean; feedback?: string }>> = [];
    for (let i = 0; i < confirmationCount; i++) {
      promises.push(
        hiveTransport.requestConfirmation(
          'batch_operation',
          { index: i, nonce: `nonce-${i}` },
          `Action #${i}`,
        ),
      );
    }

    expect(emittedRequests).toHaveLength(confirmationCount);

    const ids = new Set(emittedRequests.map((r) => r.id));
    expect(ids.size).toBe(confirmationCount);

    const reversedRequests = [...emittedRequests].reverse();
    for (const req of reversedRequests) {
      const reqIndex = (req.data as { index: number }).index;
      const isApproved = reqIndex % 2 === 0;
      const feedback = `Result for item ${reqIndex}`;
      hiveTransport.submitConfirmationResponse(req.id, isApproved, feedback);
    }

    const results = await Promise.all(promises);
    expect(results).toHaveLength(confirmationCount);

    for (let i = 0; i < confirmationCount; i++) {
      const itemResult = results.at(i);
      expect(itemResult).toEqual({
        approved: i % 2 === 0,
        feedback: `Result for item ${i}`,
      });
    }
  });

  it('broadcasts to 50 concurrent listeners across 100 rapidly emitted events without drop or corruption', async () => {
    const listenerCount = 50;
    const eventCount = 100;
    const listenerCounters = new Array<number>(listenerCount).fill(0);

    for (let i = 0; i < listenerCount; i++) {
      const listenerIndex = i;
      hiveTransport.on('presence', (_payload: PresencePayload) => {
        const prev = listenerCounters.at(listenerIndex) ?? 0;
        Reflect.set(listenerCounters, listenerIndex, prev + 1);
      });
    }

    for (let i = 0; i < eventCount; i++) {
      await hiveTransport.setPresence('chat-stress', `typing-seq-${i}`);
    }

    for (let i = 0; i < listenerCount; i++) {
      expect(listenerCounters.at(i)).toBe(eventCount);
    }
  });

  it('isolates user message callback errors and ensures all other callbacks execute', () => {
    const successfulExecutions: string[] = [];

    hiveTransport.onMessage((msg: MessageData) => {
      successfulExecutions.push(`first:${msg.text}`);
    });

    hiveTransport.onMessage((_msg: MessageData) => {
      throw new Error('Fatal error simulated in callback 2');
    });

    hiveTransport.onMessage((msg: MessageData) => {
      successfulExecutions.push(`third:${msg.text}`);
    });

    hiveTransport.submitUserMessage('Resilience check');

    expect(successfulExecutions).toEqual([
      'first:Resilience check',
      'third:Resilience check',
    ]);
  });

  it('handles submitConfirmationResponse for unknown or duplicate IDs gracefully without throwing', () => {
    expect(() => {
      hiveTransport.submitConfirmationResponse('non-existent-id', true, 'Ghost response');
    }).not.toThrow();

    expect(() => {
      hiveTransport.submitConfirmationResponse('', false);
    }).not.toThrow();
  });
});

describe('HiveTransport Challenge Suite — Part 4: Cleanup & Edge Cases', () => {
  beforeEach(async () => {
    hiveTransport.removeAllListeners();
    await hiveTransport.connect();
  });

  afterEach(async () => {
    await hiveTransport.disconnect();
    hiveTransport.removeAllListeners();
  });

  it('detaches single listeners cleanly with off() / removeListener()', async () => {
    let callCount = 0;
    const handler = () => {
      callCount++;
    };

    hiveTransport.on('presence', handler);
    await hiveTransport.setPresence('chat-1', 'composing');
    expect(callCount).toBe(1);

    hiveTransport.off('presence', handler);
    await hiveTransport.setPresence('chat-1', 'paused');
    expect(callCount).toBe(1);
  });

  it('removes all listeners for specific event or globally with removeAllListeners()', async () => {
    let messageCalls = 0;
    let presenceCalls = 0;

    hiveTransport.on('message', () => {
      messageCalls++;
    });
    hiveTransport.on('presence', () => {
      presenceCalls++;
    });

    hiveTransport.removeAllListeners('message');
    await hiveTransport.sendText('chat-1', 'Test msg');
    await hiveTransport.setPresence('chat-1', 'composing');

    expect(messageCalls).toBe(0);
    expect(presenceCalls).toBe(1);

    hiveTransport.removeAllListeners();
    await hiveTransport.setPresence('chat-1', 'paused');
    expect(presenceCalls).toBe(1);
  });

  it('clears messageCallbacks and groupEventCallbacks on disconnect()', async () => {
    let callbackReceived = false;
    hiveTransport.onMessage(() => {
      callbackReceived = true;
    });

    await hiveTransport.disconnect();
    hiveTransport.submitUserMessage('Message after disconnect');

    expect(callbackReceived).toBe(false);
  });

  it('handles empty strings, special characters, and unicode emojis across text and captions', async () => {
    let receivedMsg: MessageData | null = null;
    hiveTransport.on('message', (m: MessageData) => {
      receivedMsg = m;
    });

    const complexText = '🔥 Multi-line\n\t"Quotes" & <XML> $100% — 日本語/العربية/Ñ/é';
    await hiveTransport.sendText('chat-unicode', complexText);

    const typedMsg = receivedMsg as unknown as MessageData;
    expect(typedMsg?.text).toBe(complexText);
  });

  it('handles null and empty values in sendUniversalResponse', async () => {
    let receivedVisual: VisualResponsePayload | null = null;
    let receivedMsg: MessageData | null = null;

    hiveTransport.on('visual_response', (vr: VisualResponsePayload) => {
      receivedVisual = vr;
    });
    hiveTransport.on('message', (m: MessageData) => {
      receivedMsg = m;
    });

    await hiveTransport.sendUniversalResponse('chat-null', {});

    expect(receivedMsg).toBeNull();
    expect(receivedVisual).toBeNull();
  });

  it('returns valid group metadata mock and empty buffer for downloadMedia', async () => {
    const meta = await hiveTransport.getGroupMetadata('grp-123');
    expect(meta).toEqual({ id: 'grp-123', name: 'TUI Group', participants: [], admins: [] });

    const buf = await hiveTransport.downloadMedia({});
    expect(buf).toEqual(Buffer.from(''));

    const isAdmin = await hiveTransport.isAdmin('grp-123', 'usr-456');
    expect(isAdmin).toBe(true);

    const workspace = hiveTransport.getWorkspace();
    expect(workspace).toBe(process.cwd());
  });
});
