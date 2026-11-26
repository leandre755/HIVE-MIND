import PdfKitDocument from 'pdfkit';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { botIdentity } from '../../../utils/botIdentity.js';
import {
  safeExistsSync,
  safeMkdirSync,
  safeCreateWriteStream,
  safeUnlinkSync,
  resolveWithinRoot,
} from '../../../utils/safeFs.js';

const isRec = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
function parsePdfArgs(raw: unknown): GeneratePdfArgs {
  if (!isRec(raw)) throw new Error('INVALID_ARGS: expected object arguments');
  const title = isStr(raw.title)?.trim() ?? '';
  const content = isStr(raw.content) ?? '';
  if (!title || !content.trim()) throw new Error('INVALID_ARGS: title and content are required');
  const fn = isStr(raw.filename)?.trim() ? (raw.filename as string) : 'report';
  if (raw.sections === undefined) return { title, content, filename: fn };
  if (!Array.isArray(raw.sections)) throw new Error('INVALID_ARGS: sections must be an array');
  const sections = raw.sections.map((s, i) => {
    if (!isRec(s)) throw new Error(`INVALID_ARGS: sections[${i}] must be an object`);
    return { heading: isStr(s.heading), text: isStr(s.text) };
  });
  return { title, content, filename: fn, sections };
}
type EvCb = (arg?: Error) => void;
type EvFn = (ev: string, cb: EvCb) => unknown;
type PdfDoc = InstanceType<typeof PdfKitDocument>;
type PdfStream = ReturnType<typeof safeCreateWriteStream>;
type EmitterLike = Partial<Record<'off' | 'removeListener' | 'once', EvFn>>;
function createPdfFinishPromise(doc: PdfDoc, stream: PdfStream): Promise<void> {
  const off = (t: unknown, ev: string, cb: EvCb) =>
    ((t as EmitterLike)?.off ?? (t as EmitterLike)?.removeListener)?.call(t, ev, cb);
  const p = new Promise<void>((resolve, reject) => {
    const flags = new Set<'f' | 's'>();
    const onErr = (err?: Error) => settle(err ?? new Error('PDF stream error'), true);
    const finish = () => flags.add('f');
    const close = () => {
      evs.forEach(([k, h]) => off(stream, k, h));
      off(doc, 'error', onErr);
      settle(flags.has('f') ? undefined : new Error('PDF write stream closed before finish'));
    };
    const evs = Object.entries<EvCb>({ error: onErr, finish, close });
    const settle = (err?: Error, destroyStream = false) => {
      if (flags.has('s')) return;
      flags.add('s');
      if (destroyStream) stream?.destroy?.();
      if (err) reject(err);
      else resolve();
    };
    evs.forEach(([k, h]) => stream.on(k, h));
    if (typeof doc.on === 'function') doc.on('error', onErr);
  });
  p.catch(() => {});
  return p;
}
function cleanupFailedPdf(stream: PdfStream | undefined, filePath: string | undefined): void {
  const unlink = () => {
    try {
      if (filePath && safeExistsSync(filePath)) safeUnlinkSync(filePath);
    } catch {
      /* ignore cleanup error */
    }
  };
  stream?.destroy?.();
  unlink();
  if (filePath) (stream as unknown as EmitterLike)?.once?.('close', unlink);
}
function writePdfSections(doc: PdfDoc, sections?: PdfSection[]) {
  if (!Array.isArray(sections)) return;
  doc.moveDown();
  for (const s of sections) {
    if (s.heading) {
      doc.moveDown();
      doc.font('Helvetica-Bold').fontSize(14).text(s.heading);
      doc.moveDown(0.5);
    }
    if (s.text)
      doc.font('Helvetica').fontSize(12).text(s.text, { align: 'justify', paragraphGap: 5 });
  }
}
interface PdfSection {
  heading?: string;
  text?: string;
}

interface GeneratePdfArgs {
  title: string;
  content: string;
  filename: string;
  sections?: PdfSection[];
}

interface VisualReporterTransport {
  sendFile(chatId: string, filePath: string, fileName: string, caption: string): Promise<void>;
}

interface VisualReporterContext {
  transport?: VisualReporterTransport;
  chatId?: string;
}

export const plugin = {
  name: 'visual_reporter',
  version: '1.0.0',
  description: 'Generates visual reports (PDF, Charts) to prove work done.',
  enabled: true,

  toolDefinitions: [
    {
      type: 'function' as const,
      function: {
        name: 'generate_pdf_report',
        description: 'Generates a formatted PDF report with title, body content, and metadata.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The main title of the report' },
            content: { type: 'string', description: 'The body text. Supports newlines (\\n).' },
            filename: { type: 'string', description: 'Filename without extension' },
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: { heading: { type: 'string' }, text: { type: 'string' } },
              },
              description: 'Optional: Structured sections for better formatting',
            },
          },
          required: ['title', 'content'],
        },
      },
    },
  ],

  /**
   * Executes the requested tool (Standard Loader Signature)
   */
  async execute(args: unknown, context: VisualReporterContext, toolName: string) {
    const { transport, chatId } = context || {};

    if (!transport || !chatId) {
      return { success: false, message: 'CONTEXT_ERROR: Missing required context.' };
    }

    if (toolName === 'generate_pdf_report') {
      try {
        return await this.generatePdfReport(parsePdfArgs(args), transport, chatId);
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        return { success: false, message: err.message, error: err.message };
      }
    }
    return { success: false, message: `Unknown tool: ${toolName}` };
  },

  /**
   * Generates a PDF and sends it
   */
  async generatePdfReport(
    { title, content, filename, sections }: GeneratePdfArgs,
    transport: VisualReporterTransport,
    chatId: string,
  ) {
    let stream: ReturnType<typeof safeCreateWriteStream> | undefined;
    let filePath: string | undefined;
    try {
      const trimmed = (filename || 'report').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
      const safeFilename = trimmed.toLowerCase().slice(0, 64) || 'report';
      const tempDir = path.resolve(process.cwd(), 'temp');
      if (!safeExistsSync(tempDir)) safeMkdirSync(tempDir, { recursive: true });

      const id = `${Date.now()}_${randomUUID().slice(0, 8)}`;
      filePath = resolveWithinRoot(tempDir, `${safeFilename}_${id}.pdf`);

      // Document creation
      const doc = new PdfKitDocument({ margin: 50 });
      stream = safeCreateWriteStream(filePath);
      const finishPromise = createPdfFinishPromise(doc, stream);
      doc.pipe(stream);

      // Header
      const botName = botIdentity.fullName;
      doc.font('Helvetica-Bold').fontSize(20).text(title, { align: 'center', underline: true });
      doc.moveDown();
      doc
        .font('Helvetica-Oblique')
        .fontSize(10)
        .text(`Generated by ${botName} (WhatsApp Bot) - ${new Date().toLocaleString()}`, {
          align: 'right',
        });
      doc.moveDown(2);

      // Main Content
      doc.font('Helvetica').fontSize(12).text(content, {
        align: 'justify',
        paragraphGap: 5,
      });

      // Optional Sections
      writePdfSections(doc, sections);

      // Footer
      const footerText = 'HiveMind V3 Architecture - Antigravity Agent';
      doc.font('Helvetica').fontSize(8).fillColor('grey');
      const [pageWidth, pageHeight] = [num(doc.page?.width, 612), num(doc.page?.height, 792)];
      const measured = typeof doc.widthOfString === 'function' ? doc.widthOfString(footerText) : 0;
      const footerX = measured > 0 ? Math.max(50, (pageWidth - measured) / 2) : 50;
      doc.text(footerText, footerX, pageHeight - 35, { lineBreak: false });
      doc.fillColor('black');

      doc.end();

      // Wait for stream to finish
      await finishPromise;

      // Send the document
      const sendFile = transport.sendFile.bind(transport);
      const rawStem = title.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim();
      const stem = rawStem.slice(0, 100) || safeFilename;
      const caption = `📄 Here is the requested report: *${title}*`;
      await sendFile(chatId, filePath, `${stem}.pdf`, caption);

      // Cleanup (Optional: keep for debug or delete?)
      // For now we keep, a cron job (tempCleanup) will handle it

      return {
        success: true,
        message: `PDF generated and sent: ${filePath}`,
        file_path: filePath,
      };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      cleanupFailedPdf(stream, filePath);
      console.error('[VisualReporter] PDF generation error:', err);
      return {
        success: false,
        message: `PDF generation error: ${err.message}`,
        error: err.message,
      };
    }
  },
};

export default plugin;
