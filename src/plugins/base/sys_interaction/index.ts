import path from 'path';
import { resolveWithinRoot } from '../../../utils/safeFs.js';

// plugins/sys_interaction/index.ts

interface TransportLike {
  sendReaction(
    chatId: string | undefined,
    targetKey: unknown,
    emoji: string,
    targetChannel: string | undefined,
  ): Promise<void>;
  sendPoll(
    chatId: string | undefined,
    title: string,
    options: string[],
    selectableCount: number,
    targetChannel: string | undefined,
  ): Promise<void>;
  sendContact(
    chatId: string | undefined,
    name: string,
    phone: string,
    targetChannel: string | undefined,
  ): Promise<void>;
  sendText(
    chatId: string | undefined,
    text: string,
    options: Record<string, unknown>,
    targetChannel: string | undefined,
  ): Promise<void>;
  sendMedia(
    chatId: string | undefined,
    filePath: string,
    options: Record<string, unknown>,
    targetChannel: string | undefined,
  ): Promise<void>;
}

interface MessageRawKey {
  remoteJid?: string;
  id?: string;
  [key: string]: unknown;
}

interface MessageRaw {
  key?: MessageRawKey;
  [key: string]: unknown;
}

interface SysInteractionMessage {
  raw?: MessageRaw;
  sender?: string;
  [key: string]: unknown;
}

interface SysInteractionContext {
  transport?: TransportLike;
  message?: SysInteractionMessage;
  chatId?: string;
  sourceChannel?: string;
  [key: string]: unknown;
}

interface PluginInfo {
  name: string;
  description: string;
  version: string;
}

interface ToolDefFunction {
  name: string;
  description: string;
}

interface ToolDef {
  function: ToolDefFunction;
}

interface ReactToMessageArgs {
  emoji?: string;
  reaction?: string;
  target_channel?: string;
}
interface CreatePollArgs {
  title: string;
  options: string[];
  allowMultipleAnswers?: boolean;
  target_channel?: string;
  target_chat_id?: string;
}
interface SendContactArgs {
  name: string;
  phone: string;
  target_channel?: string;
  target_chat_id?: string;
}
interface SendMessageArgs {
  text: string;
  target_channel?: string;
  target_chat_id?: string;
}
interface SendFileArgs {
  filePath: string;
  caption?: string;
  target_channel?: string;
  target_chat_id?: string;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

interface PluginLoaderRef {
  list(): PluginInfo[];
  getToolDefinitions(): ToolDef[];
  toolToPlugin: Map<string, string>;
  execute(
    toolName: string,
    args: Record<string, unknown>,
    context: SysInteractionContext,
  ): Promise<unknown>;
}

async function handleGetMyCapabilities(pluginLoader: PluginLoaderRef, ptcEnabled: boolean) {
  const plugins = pluginLoader.list();
  const tools = pluginLoader.getToolDefinitions();

  let summary = 'Here is the exhaustive list of my capabilities:\n\n';

  plugins.forEach((p: PluginInfo) => {
    summary += `📂 **Plugin: ${p.name}** (v${p.version})\n   Description: ${p.description}\n`;
    const pluginTools = tools
      .filter((t: ToolDef) => pluginLoader.toolToPlugin.get(t.function.name) === p.name)
      .map(
        (t: ToolDef) =>
          `   - 🛠️ ${t.function.name}: ${t.function.description.substring(0, 100)}...`,
      );

    if (pluginTools.length) {
      summary += pluginTools.join('\n') + '\n';
    }
    summary += '\n';
  });

  if (plugins.length === 0 && tools.length > 0) {
    summary += tools
      .map((t: ToolDef) => `- ${t.function.name}: ${t.function.description}`)
      .join('\n');
  }

  if (ptcEnabled) {
    summary += '\n📂 **Meta-Features (System)**\n';
    summary +=
      '   - 🛠️ code_execution: Executes JavaScript code to orchestrate MULTIPLE tool calls at once (Programmatic Tool Calling).\n';
  }

  return {
    success: true,
    message: summary,
    data: {
      plugins,
      tools: tools
        .map((t: ToolDef) => t.function.name)
        .concat(ptcEnabled ? ['code_execution'] : []),
    },
  };
}

async function handleReactToMessage(
  args: ReactToMessageArgs,
  context: SysInteractionContext,
  transport: TransportLike,
  message: SysInteractionMessage,
  chatId: string | undefined,
) {
  const emoji = args.emoji || args.reaction;
  if (!emoji || emoji.length > 5) return { success: false, message: 'Invalid emoji.' };

  const targetKey = message.raw?.key;
  if (!targetKey) return { success: false, message: 'No target message.' };

  const targetChannel = args.target_channel || context.sourceChannel;
  await transport.sendReaction(chatId, targetKey, emoji, targetChannel);

  const { consciousness } = await import('../../../services/consciousnessService.js');
  const negativeEmojis = ['🤮', '🤢', '😡', '🤬', '🤦‍♂️', '🤦‍♀️', '🤡', '😒'];
  const positiveEmojis = [
    '❤️',
    '🧡',
    '💛',
    '💚',
    '💙',
    '💜',
    '🖤',
    '🤍',
    '🤎',
    '💖',
    '💗',
    '💓',
    '🥰',
    '😍',
    '🤩',
    '😘',
    '😗',
    '😙',
    '😚',
    '🤗',
    '👍',
    '👌',
    '🤝',
    '🙌',
    '👏',
    '🫶',
    '👐',
    '🤲',
    '🙏',
    '🕊️',
    '🌸',
    '💐',
    '🌹',
    '🌺',
    '🌻',
    '🌼',
    '🌷',
    '🌞',
    '🌝',
    '🌛',
    '🌜',
    '🌚',
    '🌕',
    '🌖',
    '🌗',
    '🌘',
    '🌑',
    '🌒',
    '🌓',
    '🌔',
    '🌙',
  ];

  if (negativeEmojis.includes(emoji)) {
    await consciousness.updateAnnoyance(chatId!, message.sender ?? '', 15);
    console.log(`[Vibe] 😡 Negative reaction (${emoji}) -> Annoyance +15`);
  } else if (positiveEmojis.includes(emoji)) {
    await consciousness.updateAnnoyance(chatId!, message.sender ?? '', -5);
    console.log(`[Vibe] ❤️ Positive reaction (${emoji}) -> Annoyance -5`);
  }

  return { success: true, message: `[ACTION] Reaction ${emoji} added on ${targetChannel}.` };
}

async function handleCreatePoll(
  args: CreatePollArgs,
  context: SysInteractionContext,
  transport: TransportLike,
  chatId: string | undefined,
) {
  const { title, options, allowMultipleAnswers } = args;
  const selectableCount = allowMultipleAnswers ? options.length : 1;
  const pollTargetChannel = args.target_channel || context.sourceChannel;
  const pollTargetChatId = args.target_chat_id || chatId;

  await transport.sendPoll(pollTargetChatId, title, options, selectableCount, pollTargetChannel);
  return {
    success: true,
    message: `[ACTION] Poll "${title}" created on ${pollTargetChannel} in chat ${pollTargetChatId}.`,
  };
}

async function handleSendContact(
  args: SendContactArgs,
  context: SysInteractionContext,
  transport: TransportLike,
  chatId: string | undefined,
) {
  const { name, phone } = args;
  const cleanPhone = phone.replace(/\+/g, '').replace(/\s/g, '');
  const contactTargetChannel = args.target_channel || context.sourceChannel;
  const contactTargetChatId = args.target_chat_id || chatId;

  await transport.sendContact(contactTargetChatId, name, cleanPhone, contactTargetChannel);
  return {
    success: true,
    message: `[ACTION] Contact ${name} (${cleanPhone}) sent on ${contactTargetChannel}.`,
  };
}

async function handleUseTool(
  args: Record<string, unknown>,
  context: SysInteractionContext,
  pluginLoader: PluginLoaderRef,
) {
  const toolName = args.tool_name as string | undefined;
  const targetArgs = (args.args as Record<string, unknown>) ?? {};

  if (!toolName) {
    return { success: false, message: 'Missing tool_name parameter.' };
  }

  console.log('[use_tool] ⚡ Meta-executing tool "%s" with args:', toolName, targetArgs);

  const result = await pluginLoader.execute(toolName, targetArgs, context);
  return result;
}

async function handleSendMessage(
  args: SendMessageArgs,
  context: SysInteractionContext,
  transport: TransportLike,
  chatId: string | undefined,
) {
  const { text } = args;
  if (!text) return { success: false, message: 'Empty text.' };

  const msgTargetChannel = args.target_channel || context.sourceChannel;
  const msgTargetChatId = args.target_chat_id || chatId;

  await transport.sendText(msgTargetChatId, text, {}, msgTargetChannel);
  return {
    success: true,
    message: `[ACTION] Message sent on ${msgTargetChannel} to chat ${msgTargetChatId}.`,
  };
}

async function handleSendFile(
  args: SendFileArgs,
  context: SysInteractionContext,
  transport: TransportLike,
  chatId: string | undefined,
) {
  const { filePath, caption } = args;
  if (!filePath) return { success: false, message: 'File path (filePath) required.' };

  const fileTargetChannel = args.target_channel || context.sourceChannel;
  const fileTargetChatId = args.target_chat_id || chatId;

  const isUrl = filePath.startsWith('http://') || filePath.startsWith('https://');
  let finalPath = filePath;

  if (!isUrl) {
    const sandboxDir = process.env.SANDBOX_DIR || process.cwd();
    finalPath = resolveWithinRoot(sandboxDir, filePath);

    const fs = await import('fs');
    if (!fs.existsSync(finalPath)) {
      return { success: false, message: `File not found: ${finalPath}` };
    }
  }

  const ext = path.extname(finalPath).toLowerCase();
  let mediaType = 'document';
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) mediaType = 'image';
  else if (['.mp4', '.avi', '.mov', '.mkv'].includes(ext)) mediaType = 'video';
  else if (['.mp3', '.ogg', '.wav', '.m4a'].includes(ext)) mediaType = 'audio';

  let resolvedMimeType = 'application/octet-stream';
  try {
    const mime = await import('mime-types');
    resolvedMimeType = mime.default.lookup(ext) || 'application/octet-stream';
  } catch {
    const defaultMimesMap = new Map<string, string>([
      ['.md', 'text/markdown'],
      ['.txt', 'text/plain'],
      ['.pdf', 'application/pdf'],
      ['.json', 'application/json'],
      ['.csv', 'text/csv'],
      ['.html', 'text/html'],
      ['.xml', 'application/xml'],
      ['.zip', 'application/zip'],
      ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ]);
    resolvedMimeType = defaultMimesMap.get(ext) || 'application/octet-stream';
  }

  const fileName = path.basename(finalPath);

  await transport.sendMedia(
    fileTargetChatId,
    finalPath,
    { caption, type: mediaType, fileName, mimetype: resolvedMimeType },
    fileTargetChannel,
  );
  return {
    success: true,
    message: `[ACTION] File sent on ${fileTargetChannel} to chat ${fileTargetChatId} as ${mediaType} (${resolvedMimeType}).`,
  };
}

export default {
  name: 'sys_interaction',
  description: 'Management of advanced human interactions (Reactions, Polls, Contacts)',
  version: '1.1.0',
  enabled: true,

  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'react_to_message',
        description:
          'Adds a single emoji reaction to the message. Use to confirm (👍), like (❤️), or laugh (😂) instead of replying with text. Returns a JSON structure: { success: boolean, message: string }.',
        parameters: {
          type: 'object',
          properties: {
            emoji: {
              type: 'string',
              description:
                'A single character emoji symbol (e.g., 👍, ❤️, 😂). Must be exactly one emoji.',
            },
            target_channel: {
              type: 'string',
              enum: ['whatsapp', 'telegram', 'discord', 'cli'],
              description: 'Optional. The destination network. Defaults to the current network.',
            },
          },
          required: ['emoji'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_poll',
        description:
          'Creates a native poll. If the destination network does not support native polls, the transport will adapt the format. Returns a JSON structure: { success: boolean, message: string }.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The question or title of the poll.' },
            options: {
              type: 'array',
              items: { type: 'string' },
              description:
                'List of possible choices (e.g., ["Monday", "Tuesday"]). Must contain between 2 and 10 choices.',
            },
            allowMultipleAnswers: {
              type: 'boolean',
              description: 'If true, users can choose multiple options. Defaults to false.',
            },
            target_channel: {
              type: 'string',
              enum: ['whatsapp', 'telegram', 'discord', 'cli'],
              description: 'Optional. The target network.',
            },
            target_chat_id: {
              type: 'string',
              description: 'Optional. The target conversation ID.',
            },
          },
          required: ['title', 'options'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'send_contact',
        description:
          'Sends a contact card (VCard). If the network does not support it, it will send formatted text. Returns a JSON structure: { success: boolean, message: string }.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Displayed contact name.' },
            phone: {
              type: 'string',
              description:
                'Full phone number (international format without + or spaces, e.g. 33612345678).',
            },
            target_channel: {
              type: 'string',
              enum: ['whatsapp', 'telegram', 'discord', 'cli'],
              description: 'Optional. The destination network.',
            },
            target_chat_id: { type: 'string', description: 'Optional. Destination chat/user ID.' },
          },
          required: ['name', 'phone'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'send_message',
        description:
          'Sends a text message. Can be used to speak on the current network, OR to send a message to another network to another user (omni-channel). Returns a JSON structure: { success: boolean, message: string }.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The text of the message to send.' },
            target_channel: {
              type: 'string',
              enum: ['whatsapp', 'telegram', 'discord', 'cli'],
              description: 'The destination network. Defaults to the current conversation network.',
            },
            target_chat_id: {
              type: 'string',
              description:
                'The destination chat/user ID. Essential if you change the target_channel.',
            },
          },
          required: ['text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'send_file',
        description:
          'Sends a file (image, video, document, PDF) to the target network. Universal (Discord, Telegram, WhatsApp). Returns a JSON structure: { success: boolean, message: string }.',
        parameters: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description:
                'The path to the file. For local files, use the relative path or filename inside your designated Code Sandbox (e.g., "report.pdf" or "subfolder/image.png"). Absolute URLs starting with http:// or https:// are also supported.',
            },
            caption: { type: 'string', description: 'Optional text accompanying the file.' },
            target_channel: {
              type: 'string',
              enum: ['whatsapp', 'telegram', 'discord', 'cli'],
              description: 'Optional. The destination network. Defaults to current network.',
            },
            target_chat_id: {
              type: 'string',
              description: 'Optional. The destination chat/user ID.',
            },
          },
          required: ['filePath'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_my_capabilities',
        description:
          'Lists ALL active features, plugins, and tools available to me. Use when the user asks "What can you do?" or "List your functions", as your current memory might be incomplete. Returns a JSON structure: { success: boolean, message: string, data: { plugins: Array, tools: Array } } containing the list of capability objects.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'use_tool',
        description:
          'Meta-Executive tool. Allows executing ANY tool from your capabilities list (retrieved via get_my_capabilities), even if that tool is not active in your current context. Use this to bypass memory limitations. Returns the JSON response structure of the targeted tool.',
        parameters: {
          type: 'object',
          properties: {
            tool_name: {
              type: 'string',
              description:
                'The exact name of the function to execute (e.g., "react_to_message", "search_wikipedia").',
            },
            args: {
              type: 'object',
              description:
                "The arguments required by the target tool, in JSON format matching the targeted tool's schema.",
            },
          },
          required: ['tool_name', 'args'],
        },
      },
    },
  ],

  async execute(args: unknown, context: SysInteractionContext, toolName?: string) {
    const { pluginLoader } = await import('../../loader.js');
    const { transport, message, chatId } = context || {};

    if (!transport) {
      return { success: false, message: 'Transport not available' };
    }

    const typedArgs = (typeof args === 'object' && args !== null ? args : {}) as Record<
      string,
      unknown
    >;

    try {
      switch (toolName) {
        case 'get_my_capabilities':
          return await handleGetMyCapabilities(
            pluginLoader as unknown as PluginLoaderRef,
            process.env.PTC_ENABLED !== 'false',
          );
        case 'react_to_message':
          return await handleReactToMessage(
            typedArgs as unknown as ReactToMessageArgs,
            context,
            transport as unknown as TransportLike,
            message as SysInteractionMessage,
            chatId,
          );
        case 'create_poll':
          return await handleCreatePoll(
            typedArgs as unknown as CreatePollArgs,
            context,
            transport as unknown as TransportLike,
            chatId,
          );
        case 'send_contact':
          return await handleSendContact(
            typedArgs as unknown as SendContactArgs,
            context,
            transport as unknown as TransportLike,
            chatId,
          );
        case 'use_tool':
          return await handleUseTool(
            typedArgs,
            context,
            pluginLoader as unknown as PluginLoaderRef,
          );
        case 'send_message':
          return await handleSendMessage(
            typedArgs as unknown as SendMessageArgs,
            context,
            transport as unknown as TransportLike,
            chatId,
          );
        case 'send_file':
        case 'send_files':
          return await handleSendFile(
            typedArgs as unknown as SendFileArgs,
            context,
            transport as unknown as TransportLike,
            chatId,
          );
        default:
          return { success: false, message: `Unknown tool: ${toolName}` };
      }
    } catch (error: unknown) {
      console.error('[Interaction] Error %s:', toolName, error);
      return {
        success: false,
        message: `Error during execution of ${toolName}: ${extractErrorMessage(error)}`,
        gracefulDegradation: true,
      };
    }
  },
};
