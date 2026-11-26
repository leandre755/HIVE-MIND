import { jest, describe, it, expect, afterEach } from '@jest/globals';
type R = Record<string, unknown>;
type F<A extends unknown[], R0> = jest.MockedFunction<(...a: A) => R0>;
const m = <A extends unknown[], R0>() => jest.fn<(...a: A) => R0>() as unknown as F<A, R0>;
const [mc, mtRaw] = [m<[unknown], Promise<void>>(), m<[], R>()];
const ml = m<[unknown?], Promise<{ tools: unknown[]; nextCursor?: string }>>();
const mt = m<[unknown, unknown], Promise<R>>().mockImplementation(async (_req, schema) =>
  (schema as { parse: (v: unknown) => R }).parse(mtRaw()),
);
const cf = () => m<[], Promise<void>>().mockResolvedValue(undefined);
const [clClose, stClose, ssClose] = [cf(), cf(), cf()];
type ClMap = { callTool: typeof mt; listTools: typeof ml };
type MC = ClMap & { connect: typeof mc; close: typeof clClose; onclose?: () => void };
const cc: MC[] = [];
const mkC = (): MC => ({ connect: mc, listTools: ml, callTool: mt, close: clClose });
const mockCtor = m<[], MC>().mockImplementation(() => cc[cc.push(mkC()) - 1]!);
const st = m<[unknown], { close: typeof stClose }>().mockImplementation(() => ({ close: stClose }));
const ss = m<[URL], { close: typeof ssClose }>().mockImplementation(() => ({ close: ssClose }));
const ex = m<[string], boolean>().mockReturnValue(false);
const rd = m<[string, string], string>().mockReturnValue('{}');
const u = (p: string, o: Record<string, unknown>) => jest.unstable_mockModule(p, () => o);
u('@modelcontextprotocol/sdk/client/index.js', { Client: mockCtor });
u('@modelcontextprotocol/sdk/client/stdio.js', { StdioClientTransport: st });
u('@modelcontextprotocol/sdk/client/sse.js', { SSEClientTransport: ss });
u('../../../utils/safeFs.js', { safeExistsSync: ex, safeReadFileSync: rd });
const { mcpClient } = await import('../../../services/mcpClient.js');
describe('McpClientService', () => {
  const cl = () => (mcpClient as unknown as { clients: Map<string, ClMap> }).clients;
  const call = (s: string, t: string) => mcpClient.callTool(s, t, {});
  const [gt, sse] = [() => mcpClient.getTools(), (url: string) => ({ type: 'sse', url })];
  const local = { type: 'stdio', command: 'node', args: ['s.js'], env: { SAFE: '1' } };
  afterEach(() => {
    jest.clearAllMocks();
    [mc, ml, mtRaw].forEach((x) => x.mockReset());
    ex.mockReturnValue(false);
    rd.mockReturnValue('{}');
    cl().clear();
    cc.length = 0;
    Reflect.deleteProperty(process.env, 'MCP_SECRET_TEST');
  });
  it('normalizes compatibility, structuredContent, and error tool results', async () => {
    await expect(call('missing', 'ping')).rejects.toThrow('Server missing');
    cl().set('srv', { callTool: mt, listTools: ml });
    const ok = async (v: R, data: unknown, raw?: unknown, sc?: unknown) => {
      mtRaw.mockReturnValueOnce(v);
      const sF = sc ? { structuredContent: sc } : {};
      const rF = raw === undefined ? {} : { raw };
      expect(await call('srv', 't')).toEqual({ success: true, data, ...sF, ...rF });
    };
    const er = async (v: R, error: string) => {
      mtRaw.mockReturnValueOnce(v);
      expect(await call('srv', 'rf')).toEqual({ success: false, error, isError: true });
    };
    const sc = { count: 42 };
    const tb = (text: string) => ({ type: 'text', text });
    const [okB, hiB, mrg] = [tb('ok'), tb('hi'), { text: 'hi', structuredContent: sc }];
    await ok({ content: [okB] }, 'ok', [okB]);
    await ok({ structuredContent: sc }, sc, sc, sc);
    await ok({ content: [hiB], structuredContent: sc }, mrg, [hiB], sc);
    await ok({ toolResult: 'legacy' }, 'legacy');
    await er({ isError: true, content: [tb('Denied')] }, 'Denied');
    await er({ isError: true, structuredContent: { code: 500 } }, '{"code":500}');
    await er({ isError: true, content: [] }, 'Unknown MCP error');
    mt.mockRejectedValueOnce(new Error('transport closed'));
    expect(await call('srv', 'rf')).toEqual({ success: false, error: 'transport closed' });
  });
  it('ignores invalid .mcprc files and cleans up failed or closed connects', async () => {
    ex.mockReturnValueOnce(false).mockReturnValue(true);
    rd.mockReturnValueOnce('null').mockReturnValueOnce('{bad');
    expect([await gt(), await gt(), await gt()]).toEqual([[], [], []]);
    process.env.MCP_SECRET_TEST = 'do-not-leak';
    const [down, docs, bF] = [sse('http://127.0.0.1:9998'), sse('https://h/sse'), sse('file:///x')];
    const noCmd = { type: 'stdio', command: '  ' };
    rd.mockReturnValue(JSON.stringify({ down, docs, local, noCmd, bF, bt: { type: 'http' } }));
    mc.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mc.mockImplementationOnce(async () => cc.at(-1)?.onclose?.());
    await mcpClient.connectAll();
    expect(st).toHaveBeenCalledWith({ command: 'node', args: ['s.js'], env: { SAFE: '1' } });
    const calls = [ss, ssClose, clClose, stClose, mc].map((x) => x.mock.calls.length);
    expect([calls, [...cl().keys()]]).toEqual([[2, 2, 2, 0, 3], ['local']]);
  });
  it('paginates tool cursors, latches concurrent getTools, and reconnects after close', async () => {
    ex.mockReturnValue(true);
    rd.mockReturnValue(JSON.stringify({ local }));
    const td = (n: string) => ({ name: n, inputSchema: { type: 'object' } });
    const hasCur = (p: unknown) => (p as { cursor?: string } | undefined)?.cursor === 'p2';
    const page = (s: string) => ({ tools: [td(s)], nextCursor: 'p2' });
    ml.mockImplementation(async (p) => page(hasCur(p) ? 's2' : 's1'));
    const [p1, p2] = await Promise.all([gt(), gt()]);
    expect([mc.mock.calls.length, p1.length, p2.length]).toEqual([1, 2, 2]);
    expect(p1.map((t) => t.function.name)).toEqual(['mcp__local__s1', 'mcp__local__s2']);
    cc.forEach((c) => c.onclose?.());
    expect([(await gt()).length, mc.mock.calls.length]).toEqual([2, 2]);
  });
});
