// tests/unit/providers/geminiNativeCoverage.test.ts
// #37 — extraction des deltas SSE du Layer 0 (choices OpenAI) via executeStream,
// et #36 — chemin streaming de readFileInRange (safeFstat fd-based).
// NOTE: les chemins execute/executeStream gemini-native exigent un `base_url`
// dans la famille `gemini` de models_config.json (absent aujourd'hui, fail-closed
// documenté) — couverture des candidats/parts assurée côté protocole dans
// geminiNativeProtocol.test.ts.
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { tmpdir } from 'os';
import { ModelRegistry } from '../../../providers/layer0/ModelRegistry.js';
import { executeStream, type StreamChunk } from '../../../providers/layer0/ExecutionLayer.js';
import { readFileInRangeStreaming } from '../../../utils/readFileInRange.js';
import {
  safeMkdtempSync,
  safeRemoveDirectorySync,
  safeWriteFileSync,
} from '../../../utils/safeFs.js';

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

const DUMMY_API_KEY = 'test_api_key_123';

function sseResponse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => {
  mockFetch.mockReset();
  ModelRegistry.resetInstance();
});

describe('ExecutionLayer — extraction des deltas SSE (#37)', () => {
  it('extrait choices[0].delta (contenu + reasoning) et stream par le champ stream', async () => {
    mockFetch.mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hello","reasoning_content":"penser"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const chunks: StreamChunk[] = [];
    for await (const chunk of executeStream(
      'codestral-latest',
      { messages: [{ role: 'user', content: 'salut' }] },
      { apiKey: DUMMY_API_KEY },
    )) {
      chunks.push(chunk);
    }

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('chat/completions');
    expect(JSON.stringify(init.body)).toContain('"stream":true');
    expect(chunks.some((c) => c.content === 'Hello' && c.thought === 'penser')).toBe(true);
    expect(chunks.at(-1)?.done).toBe(true);
  });

  it('extrait les deltas texte nus (format delta.text) et ignore les lignes invalides', async () => {
    mockFetch.mockResolvedValue(
      sseResponse([
        'data: {"delta":{"text":"suite","thinking":"creuse"}}\n\n',
        'data: {broken json\n\n',
        'data: {"content":"final"}\n\n',
      ]),
    );

    const chunks: StreamChunk[] = [];
    for await (const chunk of executeStream(
      'codestral-latest',
      { messages: [{ role: 'user', content: 'salut' }] },
      { apiKey: DUMMY_API_KEY },
    )) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.content === 'suite' && c.thought === 'creuse')).toBe(true);
    expect(chunks.some((c) => c.content === 'final')).toBe(true);
  });
});

describe('readFileInRange — chemin streaming (#36, safeFstat)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = safeMkdtempSync(`${tmpdir()}/hive-range-`);
  });

  afterEach(() => {
    safeRemoveDirectorySync(tempDir);
  });

  it('lit une fenêtre de lignes en streaming et résout le mtime via safeFstat', async () => {
    const filePath = `${tempDir}/big.txt`;
    safeWriteFileSync(filePath, Array.from({ length: 50 }, (_, i) => `ligne ${i}`).join('\n'));

    const result = await readFileInRangeStreaming(filePath, 5, 3, undefined, false);

    expect(result.content).toBe('ligne 5\nligne 6\nligne 7');
    expect(result.lineCount).toBe(3);
    expect(result.totalLines).toBe(50);
    expect(typeof result.mtimeMs).toBe('number');
    expect(result.mtimeMs).toBeGreaterThan(0);
  });
});
