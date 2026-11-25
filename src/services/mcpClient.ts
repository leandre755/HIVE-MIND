import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { CompatibilityCallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { safeReadFileSync as readFileSync, safeExistsSync as existsSync } from '../utils/safeFs.js';
import { join } from 'path';

export interface McpServerConfig {
  type: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

interface McpToolDefinition {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  _mcpServer: string;
  _mcpTool: string;
}

interface McpToolResult {
  success: boolean;
  data?: unknown;
  structuredContent?: Record<string, unknown>;
  error?: string;
  isError?: boolean;
  raw?: unknown;
}

interface McpToolContent {
  type: string;
  text?: string;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function buildSseTransport(name: string, def: Record<string, unknown>): SSEClientTransport {
  const rawUrl = typeof def.url === 'string' ? def.url.trim() : '';
  if (!rawUrl) throw new Error(`[MCP] Server ${name} (sse) missing required url`);
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`[MCP] Server ${name} (sse) must use http or https URL`);
  }
  return new SSEClientTransport(parsed);
}
const isStr = (v: unknown): v is string => typeof v === 'string';
function buildStdioTransport(name: string, def: Record<string, unknown>): StdioClientTransport {
  const command = typeof def.command === 'string' ? def.command.trim() : '';
  if (!command) throw new Error(`[MCP] Server ${name} (stdio) missing required command`);
  const args = Array.isArray(def.args) ? def.args.filter(isStr) : [];
  const pairs = isPlainRecord(def.env)
    ? Object.entries(def.env).filter((e): e is [string, string] => isStr(e[1]))
    : null;
  const opt = pairs ? { command, args, env: Object.fromEntries(pairs) } : { command, args };
  return new StdioClientTransport(opt);
}
function buildTransport(name: string, def: unknown): SSEClientTransport | StdioClientTransport {
  if (!isPlainRecord(def)) throw new Error(`[MCP] Invalid config for server ${name}`);
  if (def.type === 'sse') return buildSseTransport(name, def);
  if (def.type === 'stdio') return buildStdioTransport(name, def);
  throw new Error(`[MCP] Server ${name} has unsupported transport type: ${String(def.type)}`);
}
function resolveMcpError(r: Record<string, unknown>): string {
  const c = Array.isArray(r.content) ? (r.content as McpToolContent[]) : [];
  const t = c.flatMap((b) => (b.type === 'text' && isStr(b.text) ? [b.text] : [])).join('\n');
  const sc = isPlainRecord(r.structuredContent) ? JSON.stringify(r.structuredContent) : '';
  return t.trim() || sc || (isStr(r.error) ? r.error : '') || 'Unknown MCP error';
}
function resolveMcpContent(r: Record<string, unknown>, c: unknown[], texts: string): McpToolResult {
  const sc = isPlainRecord(r.structuredContent) ? r.structuredContent : undefined;
  if (!sc) return { success: true, data: texts || (c.length ? c : ''), raw: c };
  const data = texts ? { text: texts, structuredContent: sc } : sc;
  return { success: true, data, structuredContent: sc, raw: c.length ? c : sc };
}
const closeAll = (...xs: Array<{ close(): unknown } | undefined>) =>
  Promise.allSettled(xs.map((x) => Promise.resolve().then(() => x?.close())));
async function listAllTools(c: Client) {
  const out: Awaited<ReturnType<Client['listTools']>>['tools'] = [];
  const seen = new Set<string>();
  for (let i = 0, cur: string | undefined; i < 100; i++) {
    const r = await c.listTools(cur ? { cursor: cur } : undefined);
    out.push(...r.tools);
    if (!r.nextCursor || seen.has(r.nextCursor)) break;
    cur = r.nextCursor;
    seen.add(cur);
  }
  return out;
}
class McpClientService {
  private clients: Map<string, Client> = new Map();
  private connectingPromise: Promise<void> | null = null;

  constructor() {}

  private loadConfig(): Record<string, unknown> {
    const configPath = join(process.cwd(), '.mcprc');
    if (existsSync(configPath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (isPlainRecord(parsed)) return parsed;
        console.error('[MCP] Invalid .mcprc root: expected JSON object');
      } catch (error: unknown) {
        console.error('[MCP] Failed to parse .mcprc', extractErrorMessage(error));
      }
    }
    return {};
  }

  private async _connectConfiguredServers(): Promise<void> {
    const config = this.loadConfig();
    for (const [name, serverDef] of Object.entries(config)) {
      if (this.clients.has(name)) continue;

      let transport: SSEClientTransport | StdioClientTransport | undefined;
      let client: Client | undefined;
      try {
        transport = buildTransport(name, serverDef);
        client = new Client({ name: 'hive-mind', version: '1.0.0' }, { capabilities: {} });
        let closed = false;
        const cRef = client;
        client.onclose = () => {
          closed = true;
          if (this.clients.get(name) === cRef) this.clients.delete(name);
        };
        await client.connect(transport);
        if (closed) throw new Error('MCP transport closed during connect');
        this.clients.set(name, client);
        console.log(`[MCP] ✅ Connected to server: ${name}`);
      } catch (error: unknown) {
        await closeAll(client, transport);
        console.error('[MCP] ❌ Failed to connect to server %s:', name, extractErrorMessage(error));
      }
    }
  }

  async connectAll(): Promise<void> {
    if (this.connectingPromise) return this.connectingPromise;
    const run = this._connectConfiguredServers().finally(() => {
      if (this.connectingPromise === run) this.connectingPromise = null;
    });
    this.connectingPromise = run;
    return run;
  }

  async getTools(): Promise<McpToolDefinition[]> {
    await this.connectAll();

    const tools: McpToolDefinition[] = [];
    for (const [name, client] of this.clients.entries()) {
      try {
        for (const tool of await listAllTools(client)) {
          tools.push({
            type: 'function',
            function: {
              name: `mcp__${name}__${tool.name}`,
              description: tool.description || `MCP Tool from ${name}`,
              parameters: tool.inputSchema as Record<string, unknown>,
            },
            _mcpServer: name,
            _mcpTool: tool.name,
          });
        }
      } catch (error: unknown) {
        console.error('[MCP] Failed to get tools from %s:', name, extractErrorMessage(error));
      }
    }
    return tools;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`[MCP] Server ${serverName} not connected`);
    }

    try {
      const result = await client.callTool(
        {
          name: toolName,
          arguments: args,
        },
        CompatibilityCallToolResultSchema,
      );
      const rec = result as Record<string, unknown>;

      if (result.isError) {
        return {
          success: false,
          error: resolveMcpError(rec),
          isError: true,
        };
      }

      if ('toolResult' in result) {
        return { success: true, data: result.toolResult };
      }

      if ('content' in result && Array.isArray(result.content)) {
        const texts = (result.content as McpToolContent[])
          .filter((c) => c.type === 'text' && isStr(c.text))
          .map((c) => c.text)
          .join('\n');
        return resolveMcpContent(rec, result.content, texts);
      }
      const sc = isPlainRecord(rec.structuredContent) ? rec.structuredContent : null;
      if (sc) return { success: true, data: sc, structuredContent: sc, raw: sc };
      return { success: true, data: result };
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      console.error('[MCP] Failed to call tool %s on %s:', toolName, serverName, errorMessage);
      return { success: false, error: errorMessage };
    }
  }
}

export const mcpClient = new McpClientService();
export default mcpClient;
