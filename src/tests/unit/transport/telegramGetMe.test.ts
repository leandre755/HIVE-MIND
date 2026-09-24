// tests/unit/transport/telegramGetMe.test.ts
// Issue #33 — getMe() doit être résolu UNE SEULE FOIS par connexion et mis en
// cache : le handler par message ne doit jamais déclencher d'aller-retour
// réseau supplémentaire (latence 50-250 ms + risque FLOOD_WAIT).
import { describe, it, beforeEach, afterEach, jest, expect } from '@jest/globals';

const getMeMock = jest.fn(async () => ({ id: 7 }));
const startMock = jest.fn(async () => undefined);
const connectMock = jest.fn(async () => undefined);
const disconnectMock = jest.fn(async () => undefined);
const addEventHandlerMock = jest.fn();

jest.unstable_mockModule('telegram', () => ({
  TelegramClient: jest.fn(
    () =>
      ({
        start: startMock,
        connect: connectMock,
        disconnect: disconnectMock,
        getMe: getMeMock,
        addEventHandler: addEventHandlerMock,
      }) as unknown,
  ),
  Api: {
    Message: class ApiMessage {},
    User: class ApiUser {},
    Chat: class ApiChat {},
    Channel: class ApiChannel {},
    ChatForbidden: class ApiChatForbidden {},
    ChannelForbidden: class ApiChannelForbidden {},
    PeerUser: class ApiPeerUser {},
    PeerChat: class ApiPeerChat {},
    PeerChannel: class ApiPeerChannel {},
    DocumentAttributeFilename: class ApiDocAttr {
      constructor(_params: unknown) {}
    },
  },
}));

jest.unstable_mockModule('telegram/sessions/index.js', () => ({
  StringSession: class FakeStringSession {
    constructor(_session: string) {}
  },
}));

jest.unstable_mockModule('telegram/events/index.js', () => ({
  NewMessage: class FakeNewMessage {
    constructor(_params: unknown) {}
  },
  NewMessageEvent: class FakeNewMessageEvent {},
}));

const { telegramTransport } = await import('../../../core/transport/telegram.js');

function makeEvent(senderId: string): unknown {
  return {
    message: {
      id: 1,
      senderId: { toString: () => senderId },
      peerId: undefined,
      senderName: undefined,
      message: 'hello',
      date: 1_700_000_000,
      isGroup: true,
      getSender: async () => {
        throw new Error('entity resolution unavailable in tests');
      },
    },
  };
}

describe('Telegram transport — cache de getMe() (#33)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_API_ID = '12345';
    process.env.TELEGRAM_API_HASH = 'test-hash';
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  });

  afterEach(async () => {
    await telegramTransport.disconnect();
    delete process.env.TELEGRAM_API_ID;
    delete process.env.TELEGRAM_API_HASH;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('ne résout getMe() qu une fois pour N messages et ignore le self', async () => {
    const received: unknown[] = [];
    telegramTransport.onMessage((msg) => received.push(msg));

    await telegramTransport.connect();
    expect(getMeMock).toHaveBeenCalledTimes(1);
    expect(telegramTransport.selfId).toBe('7');

    const handler = addEventHandlerMock.mock.calls[0]?.[0] as (event: unknown) => Promise<void>;

    await handler(makeEvent('7')); // self → ignoré
    await handler(makeEvent('99'));
    await handler(makeEvent('99'));
    await handler(makeEvent('101'));

    expect(getMeMock).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(3);
  });

  it('remet le cache à zéro à la déconnexion', async () => {
    await telegramTransport.connect();
    expect(getMeMock).toHaveBeenCalledTimes(1);
    await telegramTransport.disconnect();
    expect(telegramTransport.selfId).toBeNull();

    await telegramTransport.connect();
    expect(getMeMock).toHaveBeenCalledTimes(2);
  });

  it('réessaie la résolution après un échec transitoire de getMe (jamais de cache null)', async () => {
    getMeMock.mockRejectedValueOnce(new Error('flood wait'));
    getMeMock.mockResolvedValue({ id: 7 });

    await telegramTransport.connect();
    expect(telegramTransport.selfId).toBeNull();
    expect(getMeMock).toHaveBeenCalledTimes(1);

    const handler = addEventHandlerMock.mock.calls[0]?.[0] as (event: unknown) => Promise<void>;
    await handler(makeEvent('7'));

    expect(getMeMock).toHaveBeenCalledTimes(2); // retry après échec
    await handler(makeEvent('7'));
    expect(getMeMock).toHaveBeenCalledTimes(2); // succès ensuite mis en cache
  });
});
