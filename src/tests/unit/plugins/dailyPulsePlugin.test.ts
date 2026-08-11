// tests/unit/plugins/dailyPulsePlugin.test.ts
import { describe, it, beforeEach, beforeAll, jest, expect } from '@jest/globals';

jest.unstable_mockModule('../../../plugins/tools/daily_pulse/journal_generator.js', () => ({
  journalGenerator: {
    generateDailyScript: jest.fn(),
    produceAudio: jest.fn(),
  },
}));

let DailyPulsePlugin: typeof import('../../../plugins/tools/daily_pulse/index.js').default;
let journalGenerator: typeof import('../../../plugins/tools/daily_pulse/journal_generator.js').journalGenerator;
let mockGenerateDailyScript: jest.MockedFunction<typeof journalGenerator.generateDailyScript>;
let mockProduceAudio: jest.MockedFunction<typeof journalGenerator.produceAudio>;

describe('Daily Pulse Plugin', () => {
  type TransportLike = {
    sendText: (chatId: string, text: string) => Promise<void>;
    sendVoiceNote: (
      chatId: string,
      filePath: string,
      options?: { caption?: string },
    ) => Promise<void>;
  };

  let mockTransport: {
    sendText: jest.MockedFunction<(chatId: string, text: string) => Promise<void>>;
    sendVoiceNote: jest.MockedFunction<
      (chatId: string, filePath: string, options?: { caption?: string }) => Promise<void>
    >;
  };
  let baseContext: { chatId: string; transport: TransportLike };

  beforeAll(async () => {
    const dailyModule = await import('../../../plugins/tools/daily_pulse/index.js');
    const journalModule = await import('../../../plugins/tools/daily_pulse/journal_generator.js');
    DailyPulsePlugin = dailyModule.default;
    journalGenerator = journalModule.journalGenerator;
    mockGenerateDailyScript =
      journalGenerator.generateDailyScript as unknown as jest.MockedFunction<
        typeof journalGenerator.generateDailyScript
      >;
    mockProduceAudio = journalGenerator.produceAudio as unknown as jest.MockedFunction<
      typeof journalGenerator.produceAudio
    >;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransport = {
      sendText: jest.fn(),
      sendVoiceNote: jest.fn(),
    };
    baseContext = {
      chatId: '123@g.us',
      transport: mockTransport,
    };
  });

  it('should fail if context is missing', async () => {
    const result = await DailyPulsePlugin.execute({}, {}, 'generate_daily_pulse');
    expect(result.success).toBe(false);
    expect(result.message).toContain('CONTEXT_ERROR');
  });

  it('should generate script and produce audio, then send voice note', async () => {
    mockGenerateDailyScript.mockResolvedValue('Hello this is the news');
    mockProduceAudio.mockResolvedValue('/home/user/audio.ogg');

    const result = await DailyPulsePlugin.execute({}, baseContext, 'generate_daily_pulse');

    expect(result.success).toBe(true);
    expect(mockTransport.sendText).toHaveBeenCalledWith(
      '123@g.us',
      expect.stringContaining('Analyzing logs'),
    );
    expect(mockTransport.sendVoiceNote).toHaveBeenCalledWith(
      '123@g.us',
      '/home/user/audio.ogg',
      expect.any(Object),
    );
    expect(result.message).toContain('audio sent');
  });

  it('should send text fallback if audio fails', async () => {
    mockGenerateDailyScript.mockResolvedValue('Hello this is the news');
    mockProduceAudio.mockResolvedValue(null);

    const result = await DailyPulsePlugin.execute({}, baseContext, 'generate_daily_pulse');

    expect(result.success).toBe(true);
    expect(mockTransport.sendText).toHaveBeenCalledWith(
      '123@g.us',
      expect.stringContaining('Hello this is the news'),
    );
    expect(result.message).toContain('Text Mode');
  });

  it('should handle not enough activity', async () => {
    mockGenerateDailyScript.mockResolvedValue(null);

    const result = await DailyPulsePlugin.execute({}, baseContext, 'generate_daily_pulse');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Not enough activity');
  });

  it('should handle errors gracefully', async () => {
    mockGenerateDailyScript.mockRejectedValue(new Error('Generation failed'));

    const result = await DailyPulsePlugin.execute({}, baseContext, 'generate_daily_pulse');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Error during Daily Pulse');
  });

  it('should ignore unknown tools', async () => {
    const result = await DailyPulsePlugin.execute({}, baseContext, 'unknown_tool');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown tool');
  });
});
