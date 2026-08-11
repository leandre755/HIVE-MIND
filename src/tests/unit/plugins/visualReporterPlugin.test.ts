// tests/unit/plugins/visualReporterPlugin.test.ts
import { describe, it, beforeEach, beforeAll, jest, expect } from '@jest/globals';

const mockPipe = jest.fn();
const mockText = jest.fn();
const mockMoveDown = jest.fn();
const mockFontSize = jest.fn().mockReturnValue({ text: mockText });
const mockEnd = jest.fn();

jest.unstable_mockModule('pdfkit', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      pipe: mockPipe,
      fontSize: mockFontSize,
      moveDown: mockMoveDown,
      text: mockText,
      end: mockEnd,
      page: { height: 800 },
    })),
  };
});

const fsExistsSync = jest.fn().mockReturnValue(true);
const fsMkdirSync = jest.fn();
const fsCreateWriteStream = jest.fn().mockReturnValue({
  on: jest.fn((event: string, cb: () => void) => {
    if (event === 'finish') cb();
  }),
});
const fsReadFileSync = jest.fn().mockReturnValue(JSON.stringify({ fullName: 'Bot' }));
const fsMock = {
  default: {
    existsSync: fsExistsSync,
    mkdirSync: fsMkdirSync,
    createWriteStream: fsCreateWriteStream,
    readFileSync: fsReadFileSync,
  },
  existsSync: fsExistsSync,
  mkdirSync: fsMkdirSync,
  createWriteStream: fsCreateWriteStream,
  readFileSync: fsReadFileSync,
};

jest.unstable_mockModule('fs', () => fsMock);
jest.unstable_mockModule('node:fs', () => fsMock);

let VisualReporterPlugin: typeof import('../../../plugins/tools/visual_reporter/index.js').default;

describe('Visual Reporter Plugin', () => {
  type TransportLike = {
    sendFile: (
      chatId: string,
      filePath: string,
      fileName: string,
      caption: string,
    ) => Promise<void>;
  };

  let mockTransport: {
    sendFile: jest.MockedFunction<
      (chatId: string, filePath: string, fileName: string, caption: string) => Promise<void>
    >;
  };
  let baseContext: { chatId: string; transport: TransportLike };

  beforeAll(async () => {
    const vrMod = await import('../../../plugins/tools/visual_reporter/index.js');
    VisualReporterPlugin = vrMod.default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransport = {
      sendFile: jest.fn(),
    };
    baseContext = {
      chatId: '123@g.us',
      transport: mockTransport,
    };
  });

  it('should validate context', async () => {
    const result = await VisualReporterPlugin.execute({}, {}, 'generate_pdf_report');
    expect(result.success).toBe(false);
    expect(result.message).toContain('CONTEXT_ERROR');
  });

  it('should generate and send PDF report', async () => {
    const args = {
      title: 'Test Report',
      content: 'Hello this is a test',
      filename: 'test_report',
    };

    const result = await VisualReporterPlugin.execute(args, baseContext, 'generate_pdf_report');

    expect(result.success).toBe(true);
    expect(mockTransport.sendFile).toHaveBeenCalled();
    expect(result.message).toContain('PDF generated and sent');
  });

  it('should include sections if provided', async () => {
    const args = {
      title: 'Test Report',
      content: 'Hello this is a test',
      filename: 'test_report',
      sections: [{ heading: 'Section 1', text: 'Text 1' }],
    };

    const result = await VisualReporterPlugin.execute(args, baseContext, 'generate_pdf_report');

    expect(result.success).toBe(true);
    expect(mockTransport.sendFile).toHaveBeenCalled();
    expect(result.message).toContain('PDF generated and sent');
  });

  it('should handle unknown tools', async () => {
    const result = await VisualReporterPlugin.execute({}, baseContext, 'unknown_tool');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown tool');
  });
});
