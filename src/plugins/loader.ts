// plugins/loader.js
// Dynamic plugin loader (Brick-Like system)

import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { timingSafeEqual } from 'crypto';
import { safeReaddir, resolveWithinRoot } from '../utils/safeFs.js';
import { eventBus, BotEvents } from '../core/events.js';
import type { Dirent } from 'fs';
import type { OpenAIToolDefinition } from '../services/ptc/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// WHY (Audit M3): This list was duplicated at two fallback sites.
// Single source of truth prevents inconsistency if one copy is updated.
const SAFE_FALLBACK_TOOLS = [
  'get_my_capabilities',
  'send_message',
  'send_file',
  'use_tool',
  'execute_bash_command',
  'edit_file',
  'list_directory',
  'grep_search',
  'code_execution',
  'google_ai_search',
  'read_file',
] as const;

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ============================================================================
// Type Definitions
// ============================================================================

/** Shape of a raw plugin module as loaded from disk */
interface PluginModule {
  default?: Plugin;
  [key: string]: unknown;
}

/** Standard format that each plugin must expose */
interface Plugin {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly enabled?: boolean;
  readonly toolDefinition?: OpenAIToolDefinition;
  readonly toolDefinitions?: readonly OpenAIToolDefinition[];
  readonly init?: () => Promise<void> | void;
  readonly execute: (
    args: Record<string, unknown>,
    context: Record<string, unknown>,
    toolName: string,
  ) => Promise<PluginResult>;
  readonly textMatchers?: readonly TextMatcher[];
  readonly processor?: unknown;
}

/** Result returned by plugin.execute() */
interface PluginResult {
  readonly success: boolean;
  readonly message: string;
  readonly error?: string;
  readonly gracefulDegradation?: boolean;
  readonly [key: string]: unknown;
}

/** Textual matcher registered by a plugin */
interface TextMatcher {
  readonly pattern: RegExp;
  readonly name?: string;
  readonly handler?: string;
  readonly description?: string;
  readonly extractArgs?: (
    match: RegExpMatchArray,
    message: Record<string, unknown>,
    text: string,
  ) => Record<string, unknown> | null | undefined;
}

/** Resolved matcher with pluginName attached */
interface ResolvedMatcher extends TextMatcher {
  readonly pluginName: string;
}

/** Error recorded during loadAll */
interface LoadError {
  readonly name: string;
  readonly error: string;
}

/** Minimal Supabase client interface (RPC + from) */
interface SupabaseClient {
  rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  from(table: string): {
    select(columns: string): Promise<{ data: unknown; error: unknown }>;
    delete(): {
      in(column: string, values: readonly string[]): Promise<{ error: unknown }>;
    };
  };
}

/** Embeddings service returned by container */
interface EmbeddingsService {
  embed(text: string): Promise<number[] | null>;
}

/** ServiceContainer interface (subset used here) */
interface ServiceContainer {
  has(name: string): boolean;
  get(name: string): unknown;
}

/** RAG tool row from Supabase */
interface RagToolRow {
  readonly name: string;
  readonly description: string;
  readonly definition: OpenAIToolDefinition;
}

/** Sync status returned by checkSyncStatus */
interface SyncStatus {
  readonly deleted: number;
  readonly new: number;
  readonly modified: number;
}

// ============================================================================
// PluginLoader
// ============================================================================

class PluginLoader {
  plugins: Map<string, Plugin>;
  toolToPlugin: Map<string, string>;
  toolDefinitions: OpenAIToolDefinition[];
  textMatchers: ResolvedMatcher[];
  _loadErrors: LoadError[] = [];

  constructor() {
    this.plugins = new Map();
    this.toolToPlugin = new Map();
    this.toolDefinitions = [];
    this.textMatchers = [];
  }

  async loadAll(): Promise<Map<string, Plugin>> {
    const entries = (await safeReaddir(__dirname, { withFileTypes: true })) as Dirent[];
    const categories = entries.filter((e: Dirent) => e.isDirectory());
    const loadErrors: LoadError[] = [];

    for (const category of categories) {
      const catPath = join(__dirname, category.name);
      const pluginEntries = (await safeReaddir(catPath, { withFileTypes: true })) as Dirent[];
      const pluginDirs = pluginEntries.filter((e: Dirent) => e.isDirectory());

      for (const dir of pluginDirs) {
        try {
          await this.load(`${category.name}/${dir.name}`);
        } catch (error: unknown) {
          loadErrors.push({ name: dir.name, error: extractErrorMessage(error) });
        }
      }
    }

    this._loadErrors = loadErrors;
    return this.plugins;
  }

  _registerToolDefinitions(plugin: Plugin): void {
    if (plugin.toolDefinitions) {
      for (const toolDef of plugin.toolDefinitions) {
        this.toolDefinitions.push(toolDef);
        const toolName = toolDef.function?.name;
        if (toolName) {
          this.toolToPlugin.set(toolName, plugin.name);
        }
      }
    } else if (plugin.toolDefinition) {
      this.toolDefinitions.push(plugin.toolDefinition);
      const toolName = plugin.toolDefinition.function?.name;
      if (toolName) {
        this.toolToPlugin.set(toolName, plugin.name);
      }
    }
  }

  _registerTextMatchers(plugin: Plugin): void {
    if (plugin.textMatchers && Array.isArray(plugin.textMatchers)) {
      for (const matcher of plugin.textMatchers) {
        this.textMatchers.push({
          ...matcher,
          pluginName: plugin.name,
        });
        const handlerName = matcher.name ?? matcher.handler;
        if (handlerName) {
          this.toolToPlugin.set(handlerName, plugin.name);
        }
      }
    }
  }

  _registerPluginHandlers(plugin: Plugin): void {
    this._registerToolDefinitions(plugin);
    this._registerTextMatchers(plugin);
  }

  async _initPlugin(plugin: Plugin, pluginName: string): Promise<void> {
    if (typeof plugin.init !== 'function') return;
    try {
      await plugin.init();
    } catch (error: unknown) {
      console.error(
        '[PluginLoader] Error initializing plugin %s:',
        pluginName,
        extractErrorMessage(error),
      );
    }
  }

  async load(pluginName: string): Promise<void> {
    const pluginDirectory = resolveWithinRoot(__dirname, pluginName);
    const pluginPath = resolveWithinRoot(pluginDirectory, 'index.js');

    try {
      const pluginModule = (await import(pathToFileURL(pluginPath).href)) as PluginModule;
      const plugin: Plugin = pluginModule.default ?? (pluginModule as unknown as Plugin);

      this._validatePlugin(plugin, pluginName);

      if (plugin.toolDefinition) {
        this._validateToolDefinition(plugin.toolDefinition, pluginName);
      }
      if (plugin.toolDefinitions) {
        plugin.toolDefinitions.forEach((td: OpenAIToolDefinition) =>
          this._validateToolDefinition(td, pluginName),
        );
      }

      await this._initPlugin(plugin, pluginName);

      if (!plugin.enabled) {
        return;
      }

      this.plugins.set(plugin.name, plugin);
      this._registerPluginHandlers(plugin);

      eventBus.publish(BotEvents.PLUGIN_LOADED, { name: plugin.name });
    } catch (error: unknown) {
      const errWithCode = error as { code?: string };
      if (errWithCode.code !== 'ERR_MODULE_NOT_FOUND') {
        throw error;
      }
    }
  }

  _validatePlugin(plugin: Plugin, name: string): void {
    if (!plugin.name || !plugin.description || !plugin.version || !plugin.execute) {
      throw new Error(`Plugin ${name} is missing required metadata or execute method`);
    }
    if (typeof plugin.execute !== 'function') {
      throw new Error(`Plugin ${name}: execute must be a function`);
    }
  }

  _validateToolDefinition(toolDef: OpenAIToolDefinition, pluginName: string): boolean {
    if (!toolDef.function) {
      throw new Error(`Plugin ${pluginName}: tool definition is missing "function" object`);
    }

    const { name, description, parameters } = toolDef.function;

    if (!name || typeof name !== 'string') {
      throw new Error(`Plugin ${pluginName}: missing or invalid tool name`);
    }

    if (!description || typeof description !== 'string') {
      throw new Error(`Plugin ${pluginName}: missing description for tool "${name}"`);
    }

    if (!parameters || typeof parameters !== 'object') {
      throw new Error(`Plugin ${pluginName}: missing parameters for tool "${name}"`);
    }

    if (parameters.type !== 'object' || !parameters.properties) {
      console.warn(
        `[PluginLoader] ⚠️ Tool "${name}" (Plugin: ${pluginName}) uses non-standard parameters format`,
      );
    }

    return true;
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<PluginResult> {
    const pluginName = this.toolToPlugin.get(toolName) ?? toolName;
    const plugin = this.plugins.get(pluginName);

    if (!plugin) {
      return {
        success: false,
        message: `TOOL_ERROR: Plugin "${toolName}" not found. This tool does not exist or is not loaded.`,
        gracefulDegradation: true,
      };
    }

    try {
      const result = await plugin.execute(args, context, toolName);
      eventBus.publish(BotEvents.PLUGIN_EXECUTED, { name: toolName, args, result });
      return result;
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      eventBus.publish(BotEvents.PLUGIN_ERROR, { name: toolName, error });
      console.error('[PluginLoader] ⚠️ Error in %s:', toolName, errorMessage);

      return {
        success: false,
        message: `TOOL_ERROR: Tool "${toolName}" encountered an error - ${errorMessage}. You can inform the user and continue with other requests.`,
        error: errorMessage,
        gracefulDegradation: true,
      };
    }
  }

  findTextHandler(
    text: string,
    message: Record<string, unknown> = {},
  ): { name: string; args: Record<string, unknown> } | null {
    if (!text) return null;

    for (const matcher of this.textMatchers) {
      try {
        const match = text.match(matcher.pattern);
        if (match) {
          const args = matcher.extractArgs
            ? matcher.extractArgs(match, message, text)
            : { captures: match.slice(1) };

          if (args === null || args === undefined) continue;

          const handlerName = matcher.name ?? matcher.handler;
          console.log(
            `[TextMatcher] ✓ Pattern found: ${handlerName} (plugin: ${matcher.pluginName})`,
          );
          return {
            name: handlerName ?? '',
            args,
          };
        }
      } catch (error: unknown) {
        console.error(
          '[TextMatcher] Error in matcher %s:',
          matcher.handler,
          extractErrorMessage(error),
        );
      }
    }

    return null;
  }

  getToolDefinitions(): OpenAIToolDefinition[] {
    return this.toolDefinitions;
  }

  async getRelevantTools(
    userMessage: string,
    limit: number = 5,
    fallbackLimit: number = 10,
    options: { forceModeration?: boolean } = {},
  ): Promise<OpenAIToolDefinition[]> {
    const { forceModeration } = options;
    const { supabase } = (await import('../services/supabase.js')) as unknown as {
      supabase: SupabaseClient | null;
    };
    const { container } = (await import('../core/ServiceContainer.js')) as {
      container: ServiceContainer;
    };

    let embeddings: EmbeddingsService | null = null;
    try {
      if (container.has('embeddings')) {
        embeddings = container.get('embeddings') as EmbeddingsService;
        console.log('[PluginLoader] ✅ EmbeddingsService loaded from container (singleton)');
      } else {
        console.warn('[PluginLoader] EmbeddingsService not available in container');
      }
    } catch (error: unknown) {
      console.warn(
        '[PluginLoader] Error loading EmbeddingsService from container:',
        extractErrorMessage(error),
      );
    }

    if (!supabase || !embeddings) {
      console.warn('[PluginLoader] RAG unavailable, fallback to all tools');
      return this.toolDefinitions.slice(0, fallbackLimit);
    }

    try {
      const queryVector = await embeddings.embed(userMessage);

      if (!queryVector) {
        console.warn('[PluginLoader] Request embedding failed, fallback');
        return this.toolDefinitions.slice(0, fallbackLimit);
      }

      const { data, error } = await supabase.rpc('match_tools', {
        query_embedding: queryVector,
        match_count: limit,
      });

      if (error) {
        console.error('[PluginLoader] match_tools error:', extractErrorMessage(error));
        return this.toolDefinitions.slice(0, fallbackLimit);
      }

      const ragTools = data as RagToolRow[] | null;
      if (!ragTools || ragTools.length === 0) {
        console.warn('[PluginLoader] No tools found by RAG, fallback to base tools');
        return this.toolDefinitions.filter(
          (t: OpenAIToolDefinition) =>
            t.function &&
            SAFE_FALLBACK_TOOLS.includes(t.function.name as (typeof SAFE_FALLBACK_TOOLS)[number]),
        );
      }

      const CORE_TOOL_NAMES = [
        'get_my_capabilities',
        'send_message',
        'send_file',
        'use_tool',
        'code_execution',
        'execute_bash_command',
        'run_scratchpad',
        'get_file_skeleton',
        'get_function',
        'edit_file',
        'read_file',
        'list_directory',
        'grep_search',
        'db_document_read',
        'db_document_save',
        'db_document_search',
        'db_document_delete',
        'google_ai_search',
        'browser_screenshot',
        'browser_snapshot',
        'browser_open',
        'browser_click',
        'browser_fill',
        'browser_eval',
        'firecrawl_scrape',
        'firecrawl_search',
        'start_deep_search',
        'spawn_sub_agent',
      ];

      if (forceModeration) {
        CORE_TOOL_NAMES.push(
          'whatsapp_ban_user',
          'whatsapp_kick_user',
          'whatsapp_mute_user',
          'whatsapp_warn_user',
          'whatsapp_tagall',
        );
      }

      const coreToolDefs = this.toolDefinitions.filter(
        (t: OpenAIToolDefinition) => t.function && CORE_TOOL_NAMES.includes(t.function.name),
      );

      const relevantTools: OpenAIToolDefinition[] = ragTools.map(
        (tool: RagToolRow) => tool.definition,
      );

      for (const coreTool of coreToolDefs) {
        if (
          !relevantTools.find(
            (t: OpenAIToolDefinition) => t.function.name === coreTool.function.name,
          )
        ) {
          relevantTools.push(coreTool);
        }
      }

      console.log(
        '[PluginLoader] 🎯 %d tools selected (RAG + Core):',
        relevantTools.length,
        relevantTools.map((t: OpenAIToolDefinition) => t.function.name).join(', '),
      );

      return relevantTools;
    } catch (error: unknown) {
      console.error('[PluginLoader] getRelevantTools error:', extractErrorMessage(error));
      return this.toolDefinitions.filter(
        (t: OpenAIToolDefinition) =>
          t.function &&
          SAFE_FALLBACK_TOOLS.includes(t.function.name as (typeof SAFE_FALLBACK_TOOLS)[number]),
      );
    }
  }

  async _diffDbTools(
    dbRows: Array<{ name: string; description: string }>,
    loadedToolHashes: Map<string, string>,
    supabase: SupabaseClient,
  ): Promise<{ deleted: number; new: number; modified: number }> {
    let deleted = 0;
    let newTools = 0;
    let modified = 0;

    const dbToolNames = dbRows.map((t) => t.name);
    const obsoleteTools = dbToolNames.filter((name) => !loadedToolHashes.has(name));

    if (obsoleteTools.length > 0) {
      const { error: deleteError } = await supabase
        .from('bot_tools')
        .delete()
        .in('name', obsoleteTools);

      if (!deleteError) {
        deleted = obsoleteTools.length;
      }
    }

    for (const [name, hash] of loadedToolHashes.entries()) {
      const dbTool = dbRows.find((t) => t.name === name);
      if (!dbTool) {
        newTools++;
      } else {
        const dbHash = this._generateToolHash(name, dbTool.description);
        const b1 = Buffer.from(hash);
        const b2 = Buffer.from(dbHash);
        const isEqual = b1.length === b2.length && timingSafeEqual(b1, b2);
        if (!isEqual) {
          modified++;
        }
      }
    }

    return { deleted, new: newTools, modified };
  }

  async checkSyncStatus(supabase: SupabaseClient | null): Promise<SyncStatus> {
    if (!supabase) return { deleted: 0, new: 0, modified: 0 };

    try {
      const loadedTools = this.getToolDefinitions();
      const loadedToolHashes = new Map<string, string>();

      for (const tool of loadedTools) {
        const name = tool.function?.name;
        const description = tool.function?.description ?? '';
        if (name) {
          loadedToolHashes.set(name, this._generateToolHash(name, description));
        }
      }

      const { data: dbTools, error } = await supabase.from('bot_tools').select('name, description');

      if (error) throw error;

      const dbRows = dbTools as Array<{ name: string; description: string }> | null;
      if (dbRows) {
        return await this._diffDbTools(dbRows, loadedToolHashes, supabase);
      }

      return { deleted: 0, new: 0, modified: 0 };
    } catch (error: unknown) {
      console.error('[PluginLoader] Sync check error:', extractErrorMessage(error));
      return { deleted: 0, new: 0, modified: 0 };
    }
  }

  _generateToolHash(name: string, description: string): string {
    return `${name}:${description.trim()}`;
  }

  list(): Array<{ name: string; description: string; version: string }> {
    return Array.from(this.plugins.values()).map((p: Plugin) => ({
      name: p.name,
      description: p.description,
      version: p.version,
    }));
  }

  async reload(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (plugin) {
      this.toolDefinitions = this.toolDefinitions.filter(
        (t: OpenAIToolDefinition) => t.function?.name !== name,
      );
      this.textMatchers = this.textMatchers.filter((m) => m.pluginName !== name);
      this.plugins.delete(name);
    }

    const categories = (await safeReaddir(__dirname, { withFileTypes: true })) as Dirent[];
    for (const category of categories.filter((e: Dirent) => e.isDirectory())) {
      const catPath = join(__dirname, category.name);
      const plugins = (await safeReaddir(catPath, { withFileTypes: true })) as Dirent[];
      const dir = plugins.find((e: Dirent) => e.isDirectory() && e.name === name);
      if (dir) {
        await this.load(`${category.name}/${name}`);
        return;
      }
    }
  }
}

export const pluginLoader = new PluginLoader();
export default PluginLoader;
