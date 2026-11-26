// tests/unit/plugins/visualReporterPlugin.test.ts
import { describe, it, beforeEach, beforeAll, jest, expect } from '@jest/globals';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import path from 'path';
const { default: RealPdfDocument } = await import('pdfkit');
type EvCb = (err?: Error) => void;
type Df = () => unknown;
type Fs<R> = (p: string) => R;
const fn = <T extends (...a: never[]) => unknown>(impl?: T) =>
  (impl ? jest.fn<T>(impl) : jest.fn<T>()) as unknown as jest.MockedFunction<T>;
const stubStream = (ev?: 'finish' | 'error' | 'close', err?: Error, asyncEmit = false) => ({
  on: fn<(e: string, cb: EvCb) => void>((e, cb) => {
    const hit = ev === e || (ev === 'finish' && e === 'close');
    if (hit) (asyncEmit ? queueMicrotask : (f: () => void) => f())(() => cb(err));
  }),
  destroy: fn<() => void>(),
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
  const exec = (a: unknown) => VisualReporterPlugin.execute(a, baseContext, 'generate_pdf_report');
  it('validates plugin contract, rejects invalid args, and renders a single-page PDF', async () => {
    const [vp, pl, mod] = [VisualReporterPlugin, pluginLoaderInstance, 'tools/visual_reporter'];
    type P0 = Parameters<typeof pl._validatePlugin>[0];
    type T0 = Parameters<typeof pl._validateToolDefinition>[0];
    const td0 = vp.toolDefinitions[0] as unknown as T0;
    expect([vp.enabled, pl._validateToolDefinition(td0, mod)]).toEqual([true, true]);
    expect(() => pl._validatePlugin(vp as unknown as P0, mod)).not.toThrow();
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
    expect(sent).toEqual(['123@g.us', out, 'Real_Report_ 1.pdf', expect.any(String)]);
  });
  it('catches sync, doc, premature-close, and post-finish EIO stream errors safely', async () => {
    const [unhandled, args] = [[] as unknown[], { title: 'E', content: 'B', filename: 'e' }];
    const onRej = (e: unknown) => unhandled.push(e);
    const putS = (s: ReturnType<typeof stubStream>) => createWriteStream.mockReturnValueOnce(s);
    const runS = (s: unknown) => putS(s as unknown as ReturnType<typeof stubStream>) && exec(args);
    const mkE = () => Object.assign(new EventEmitter(), { destroy: fn<() => void>() });
    const em = (s: EventEmitter, m: string) => [s.emit('error', new Error(m)), s.emit('close')];
    const [s1, s2] = [mkE(), mkE()];
    const exp = (m: string) => [false, `PDF generation error: ${m}`, 0];
    const chk = (r: { success: boolean; message?: string }, s: EventEmitter, m: string) =>
      expect([r.success, r.message, s.listenerCount('error')]).toEqual(exp(m));
    process.on('unhandledRejection', onRej);
    text.mockImplementationOnce(() => {
      throw new Error('sync render fail');
    });
    const syncRes = await runS(stubStream('error', new Error('open fail'), true));
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', onRej);
    expect([syncRes.success, unhandled, unlinkSync.mock.calls.length]).toEqual([false, [], 1]);
    end.mockImplementationOnce(() => [s1.emit('finish'), em(s1, 'EIO close')]);
    chk(await runS(s1), s1, 'EIO close');
    expect(mockTransport.sendFile).not.toHaveBeenCalled();
    on.mockImplementationOnce((e, cb) => {
      if (e === 'error') {
        cb(new Error('pdf fail'));
        em(s2, 'ENOENT open');
      }
    });
    chk(await runS(s2), s2, 'pdf fail');
    const early = await runS(stubStream('close'));
    expect([early.success, early.message]).toEqual([false, expect.stringContaining('before')]);
  });
  it('recursively cleans expired temp PDFs while skipping symlinks and missing files', async () => {
    const [cwdTemp, sub] = [path.resolve('temp'), path.resolve('temp', 'sub')];
    const mkD = (s: boolean) => ({ ...st, isDirectory: () => true, isSymbolicLink: () => s });
    lstatSync.mockReturnValueOnce(mkD(true));
    await new CleanupServiceCls().run();
    expect(readdirSync).not.toHaveBeenCalled();
    const entries = ['gone.pdf', 'err.pdf', 'sym.pdf', '.gitkeep', 'sub', 'old.pdf'];
    const rdSub = (d: string) => (d === sub ? ['sub.pdf'] : ['leak.pdf']);
    readdirSync.mockImplementation((d: string) => (d === cwdTemp ? entries : rdSub(d)));
    lstatSync.mockImplementation((p: string) => {
      if (p.endsWith('gone.pdf')) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      if (p.endsWith('err.pdf')) throw new Error('perm');
      if (p === cwdTemp || p === sub) return mkD(false);
      return p.endsWith('old.pdf') || p.endsWith('sub.pdf') ? st : mkD(true);
    });
    await new CleanupServiceCls().run();
    const expF = [[path.join(sub, 'sub.pdf')], [path.join(cwdTemp, 'old.pdf')]];
    expect([readdirSync.mock.calls, unlinkSync.mock.calls]).toEqual([[[cwdTemp], [sub]], expF]);
  });
});
