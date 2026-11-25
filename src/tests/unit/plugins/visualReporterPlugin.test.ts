// tests/unit/plugins/visualReporterPlugin.test.ts
import { describe, it, beforeEach, beforeAll, jest, expect } from '@jest/globals';
import { PassThrough } from 'stream';
import path from 'path';

const { default: RealPdfDocument } = await import('pdfkit');
type EvCb = (err?: Error) => void;
type Df = () => unknown;
type Fs<R> = (p: string) => R;
const fn = <T extends (...a: never[]) => unknown>(impl?: T) =>
  (impl ? jest.fn<T>(impl) : jest.fn<T>()) as unknown as jest.MockedFunction<T>;
const mockStreamDestroy = fn<() => void>();
const stubStream = (ev?: 'finish' | 'error', err?: Error, asyncEmit = false) => ({
  on: fn<(e: string, cb: EvCb) => void>((e, cb) => {
    if (ev === e) (asyncEmit ? queueMicrotask : (f: () => void) => f())(() => cb(err));
  }),
  destroy: mockStreamDestroy,
});
const [pipe, font, fontSize, fillColor] = [fn<Df>(), fn<Df>(), fn<Df>(), fn<Df>()];
const [moveDown, text, end] = [fn<Df>(), fn<Df>(), fn<Df>()];
const on = fn<(e: string, cb: EvCb) => void>();
const dBase = { pipe, font, fontSize, fillColor, moveDown, text, end, on };
const mockDoc = { ...dBase, page: { height: 792, width: 612 }, widthOfString: () => 120 };
[font, fontSize, fillColor].forEach((m) => m.mockReturnValue(mockDoc));
const mockPdfCtor = fn<() => typeof mockDoc>(() => mockDoc);
jest.unstable_mockModule('pdfkit', () => ({ default: mockPdfCtor }));
const existsSync = fn<Fs<boolean>>(() => true);
const [mkdirSync, unlinkSync] = [fn<Fs<void>>(), fn<Fs<void>>()];
const readdirSync = fn<Fs<string[]>>(() => []);
const st = { isDirectory: () => false, isSymbolicLink: () => false, mtimeMs: 0 };
const lstatSync = fn<Fs<typeof st>>(() => st);
const createWriteStream = fn<() => ReturnType<typeof stubStream>>(() => stubStream('finish'));
const readFileSync = fn<() => string>(() => JSON.stringify({ fullName: 'Bot' }));
const f0 = { existsSync, mkdirSync, createWriteStream, readFileSync };
const fOps = { ...f0, unlinkSync, readdirSync, lstatSync };
const fsMock = { default: fOps, ...fOps };
const fsAsync = { unlink: fn<Fs<Promise<void>>>().mockResolvedValue(undefined) };
const fsPMock = { default: fsAsync, ...fsAsync };

jest.unstable_mockModule('fs', () => fsMock);
jest.unstable_mockModule('node:fs', () => fsMock);
jest.unstable_mockModule('fs/promises', () => fsPMock);
jest.unstable_mockModule('node:fs/promises', () => fsPMock);

let VisualReporterPlugin: typeof import('../../../plugins/tools/visual_reporter/index.js').default;
let pluginLoaderInstance: typeof import('../../../plugins/loader.js').pluginLoader;
let CleanupServiceCls: typeof import('../../../services/cleanup.js').CleanupService;

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
    pluginLoaderInstance = (await import('../../../plugins/loader.js')).pluginLoader;
    CleanupServiceCls = (await import('../../../services/cleanup.js')).CleanupService;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    [font, fontSize, fillColor].forEach((m) => m.mockReturnValue(mockDoc));
    readdirSync.mockReturnValue([]);
    mockTransport = {
      sendFile: fn<(chatId: string, f: string, n: string, cap: string) => Promise<void>>(),
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

  it('validates plugin, avoids blank footer & unhandled rejections, cleans temp', async () => {
    const [vp, pl, mod] = [VisualReporterPlugin, pluginLoaderInstance, 'tools/visual_reporter'];
    const exec = (a: unknown) => vp.execute(a, baseContext, 'generate_pdf_report');
    type P0 = Parameters<typeof pl._validatePlugin>[0];
    type T0 = Parameters<typeof pl._validateToolDefinition>[0];
    expect(vp.enabled).toBe(true);
    expect(() => pl._validatePlugin(vp as unknown as P0, mod)).not.toThrow();
    expect(pl._validateToolDefinition(vp.toolDefinitions[0] as unknown as T0, mod)).toBe(true);
    const bad = await exec({ title: 'R', content: 'B', sections: [null] });
    expect([bad.success, bad.message]).toEqual([false, expect.stringContaining('INVALID_ARGS')]);
    const chunks: Buffer[] = [];
    const pt = new PassThrough().on('data', (c: Buffer) => chunks.push(c));
    const real = () => new RealPdfDocument({ margin: 50 }) as unknown as typeof mockDoc;
    mockPdfCtor.mockImplementationOnce(real);
    createWriteStream.mockReturnValueOnce(pt as unknown as ReturnType<typeof stubStream>);
    const res = await exec({ title: 'Real/Report: 1', content: 'Body', filename: 'x'.repeat(400) });
    const pdf = Buffer.concat(chunks).toString('latin1');
    const out = 'file_path' in res ? (res.file_path ?? '') : '';
    const pages = pdf.match(/\/Type \/Page\b/g)?.length;
    const pdfChk = [res.success, pdf.startsWith('%PDF-'), pdf.includes('/Count 1'), pages];
    expect([pdfChk, path.basename(out).length <= 100]).toEqual([[true, true, true, 1], true]);
    const sent = mockTransport.sendFile.mock.calls[0];
    const expS = ['123@g.us', out, 'Real_Report_ 1.pdf'];
    expect([sent?.slice(0, 3), typeof sent?.[3]]).toEqual([expS, 'string']);
    const unhandled: unknown[] = [];
    const onRej = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onRej);
    createWriteStream.mockReturnValueOnce(stubStream('error', new Error('open fail'), true));
    const fail = (e: Error): never => {
      throw e;
    };
    text.mockImplementationOnce(() => fail(new Error('sync render fail')));
    const syncRes = await exec({ title: 'S', content: 'B', filename: 's' });
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', onRej);
    const unlinked = unlinkSync.mock.calls.length > 0;
    expect([syncRes.success, unhandled.length, unlinked]).toEqual([false, 0, true]);
    createWriteStream.mockReturnValueOnce(stubStream());
    on.mockImplementationOnce((ev, cb) => ev === 'error' && cb(new Error('pdf fail')));
    const docErr = await exec({ title: 'E2', content: 'B', filename: 'e2' });
    expect([docErr.success, docErr.message]).toEqual([false, expect.stringContaining('pdf fail')]);
    const [cwdTemp, sub] = [path.resolve('temp'), path.resolve('temp', 'sub')];
    [unlinkSync, readdirSync].forEach((x) => x.mockClear());
    const entries = ['gone.pdf', 'err.pdf', 'sym.pdf', '.gitkeep', 'sub', 'old.pdf'];
    const rdSub = (d: string) => (d === sub ? ['sub.pdf'] : ['leak.pdf']);
    readdirSync.mockImplementation((d: string) => (d === cwdTemp ? entries : rdSub(d)));
    const goneErr = Object.assign(new Error('gone'), { code: 'ENOENT' });
    const mkD = (s: boolean) => ({ ...st, isDirectory: () => true, isSymbolicLink: () => s });
    const lstat = (p: string) => {
      if (p.endsWith('gone.pdf')) return fail(goneErr);
      if (p.endsWith('err.pdf')) return fail(new Error('perm'));
      if (p === cwdTemp || p === sub) return mkD(false);
      return p.endsWith('old.pdf') || p.endsWith('sub.pdf') ? st : mkD(true);
    };
    lstatSync.mockImplementation(lstat);
    await new CleanupServiceCls().run();
    const expF = [[path.join(sub, 'sub.pdf')], [path.join(cwdTemp, 'old.pdf')]];
    expect([readdirSync.mock.calls, unlinkSync.mock.calls]).toEqual([[[cwdTemp], [sub]], expF]);
  });
});
