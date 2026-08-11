// tests/unit/transport/handlers/antiDeleteHandler.test.ts
import { describe, it, beforeEach, jest, expect } from '@jest/globals';
import { proto, type WAMessage } from '@whiskeysockets/baileys';
import { AntiDeleteHandler } from '../../../../core/transport/handlers/antiDeleteHandler.js';
import { workingMemory } from '../../../../services/workingMemory.js';

interface MessageUpdateEntry {
  update: Partial<WAMessage>;
  key: proto.IMessageKey;
}

describe('AntiDeleteHandler unit tests', () => {
  let sendMessage: jest.Mock<(jid: string, content: { text: string }) => Promise<unknown>>;
  let mockTransport: { sock: { sendMessage: typeof sendMessage } };
  let mockLogger: { log: jest.Mock; error: jest.Mock; warn: jest.Mock };
  let handler: AntiDeleteHandler;

  beforeEach(() => {
    jest.restoreAllMocks();

    sendMessage = jest.fn(async () => ({}));
    mockTransport = { sock: { sendMessage } };

    mockLogger = {
      log: jest.fn(() => {}),
      error: jest.fn(() => {}),
      warn: jest.fn(() => {}),
    };

    handler = new AntiDeleteHandler(mockTransport, mockLogger);

    // Mock workingMemory
    jest.spyOn(workingMemory, 'isAntiDeleteEnabled').mockImplementation(async () => true);
    jest.spyOn(workingMemory, 'getStoredMessage').mockImplementation(async () => null);
    jest.spyOn(workingMemory, 'trackDeletedMessage').mockImplementation(async () => {});
    jest.spyOn(workingMemory, 'storeMessage').mockImplementation(async () => {});
  });

  it('should not handle update if not a delete', async () => {
    const updates: MessageUpdateEntry[] = [
      {
        key: { remoteJid: '123@g.us', id: 'msg1' },
        update: { messageStubType: proto.WebMessageInfo.StubType.UNKNOWN },
      },
    ];
    await handler.handleUpdate(updates);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('should skip if not a group', async () => {
    const updates: MessageUpdateEntry[] = [
      {
        key: { remoteJid: '123@s.whatsapp.net', id: 'msg1' },
        update: { messageStubType: proto.WebMessageInfo.StubType.REVOKE },
      },
    ];
    await handler.handleUpdate(updates);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('should restore message if stored and enabled', async () => {
    const chatId = '123@g.us';
    const updates: MessageUpdateEntry[] = [
      {
        key: { remoteJid: chatId, id: 'msg1' },
        update: { messageStubType: proto.WebMessageInfo.StubType.REVOKE },
      },
    ];

    jest.spyOn(workingMemory, 'getStoredMessage').mockImplementation(async () => ({
      senderName: 'TestUser',
      text: 'Hello world',
      storedAt: Date.now(),
    }));

    await handler.handleUpdate(updates);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sentContent = sendMessage.mock.calls[0]?.[1];
    expect(sentContent?.text).toContain('Hello world');
    expect(sentContent?.text).toContain('TestUser');
  });
});
