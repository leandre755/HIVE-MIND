import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const isGlobalAdminMock = jest.fn<(jid: string) => Promise<boolean>>();

jest.unstable_mockModule('../../../services/adminService.js', () => ({
  adminService: { isGlobalAdmin: isGlobalAdminMock },
}));

const devTools = (await import('../../../plugins/base/dev_tools/index.js')).default;

const buildContext = (sender?: string) => ({
  transport: {
    sendText: jest.fn(async () => {}),
    setPresence: jest.fn(async () => {}),
    sendContact: jest.fn(async () => {}),
  },
  chatId: 'chat-1',
  ...(sender === undefined ? {} : { sender }),
});

describe('dev_tools — autorisation de .shutdown', () => {
  let killSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.clearAllMocks();
    killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('refuse un expéditeur non global-admin sans terminer le processus', async () => {
    isGlobalAdminMock.mockResolvedValue(false);

    const result = await devTools.execute(
      {},
      buildContext('intrus@s.whatsapp.net'),
      'shutdown_bot',
    );

    expect(result).toEqual({
      success: false,
      message: 'UNAUTHORIZED: global admin required for .shutdown',
    });
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('refuse une requête sans expéditeur', async () => {
    const result = await devTools.execute({}, buildContext(), 'shutdown_bot');

    expect(result).toEqual({
      success: false,
      message: 'UNAUTHORIZED: global admin required for .shutdown',
    });
    expect(isGlobalAdminMock).not.toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('autorise un global-admin et demande la terminaison du processus', async () => {
    isGlobalAdminMock.mockResolvedValue(true);

    const result = await devTools.execute({}, buildContext('owner@s.whatsapp.net'), 'shutdown_bot');

    expect(isGlobalAdminMock).toHaveBeenCalledWith('owner@s.whatsapp.net');
    expect(result).toEqual({ success: true, message: 'Bot shut down' });
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });
});
