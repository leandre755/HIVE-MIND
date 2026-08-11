import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, existsSync } from 'fs';
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

class McpClientService {
  private clients: Map<string, Client> = new Map();
  private toolsCache: McpToolDefinition[] = [];
  private connectingPromise: Promise<void> | null = null;

  constructor() {}

  private loadConfig(): Record<string, McpServerConfig> {
    const configPath = join(process.cwd(), '.mcprc');
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        return JSON.parse(content) as Record<string, McpServerConfig>;
      } catch (error: unknown) {
        console.error('[MCP] Failed to parse .mcprc', extractErrorMessage(error));
      }
    }
    return {};
  }

  async connectAll(): Promise<void> {
    if (this.connectingPromise) return this.connectingPromise;

    this.connectingPromise = (async () => {
      const config = this.loadConfig();
      for (const [name, serverDef] of Object.entries(config)) {
        if (this.clients.has(name)) continue;

        try {
          const transport =
            serverDef.type === 'sse' && serverDef.url
              ? new SSEClientTransport(new URL(serverDef.url))
              : new StdioClientTransport({
                  command: serverDef.command!,
                  args: serverDef.args || [],
                  env: { ...process.env, ...serverDef.env } as Record<string, string>,
                });

          const client = new Client({ name: 'hive-mind', version: '1.0.0' }, { capabilities: {} });

          await client.connect(transport);
          this.clients.set(name, client);
          console.log(`[MCP] ✅ Connected to server: ${name}`);
        } catch (error: unknown) {
          console.error(
            '[MCP] ❌ Failed to connect to server %s:',
            name,
            extractErrorMessage(error),
          );
        }
      }
    })();

    return this.connectingPromise;
  }

  async getTools(): Promise<McpToolDefinition[]> {
    await this.connectAll();

    const tools: McpToolDefinition[] = [];
    for (const [name, client] of this.clients.entries()) {
      try {
        const result = await client.request({ method: 'tools/list' }, ListToolsResultSchema);
        for (const tool of result.tools) {
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
    this.toolsCache = tools;
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
        CallToolResultSchema,
      );

      if (result.isError) {
        return {
          success: false,
          error: (result.error as string) || 'Unknown MCP error',
          isError: true,
        };
      }

      if ('toolResult' in result) {
        return { success: true, data: result.toolResult };
      }

      if ('content' in result && Array.isArray(result.content)) {
        const texts = (result.content as McpToolContent[])
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        return { success: true, data: texts, raw: result.content };
      }
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
