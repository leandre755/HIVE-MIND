import { browserService } from '../../../services/browser/BrowserService.js';
import type { BrowserResult as BrowserResultBase } from '../../../services/browser/types.js';

const MAX_SNAPSHOT_LENGTH = 12000;

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

// --- Type helpers ---

interface ToolContext {
  chatId?: string;
  sourceChannel?: string;
  transport?: {
    sendMedia: (
      chatId: string,
      filePath: string,
      opts: Record<string, unknown>,
      channel: string,
    ) => Promise<void>;
  };
  onProgress?: (msg: string) => void;
  message?: { sender?: string };
}

interface BrowserOpenArgs {
  url?: string;
}

interface BrowserSnapshotArgs {
  interactive_only?: boolean;
}

interface BrowserClickArgs {
  selector?: string;
}

interface BrowserFillArgs {
  selector?: string;
  value?: string;
}

interface BrowserTypeArgs {
  selector?: string;
  text?: string;
}

interface BrowserScreenshotArgs {
  name?: string;
  url?: string;
  full_page?: boolean;
}

interface BrowserGetTextArgs {
  selector?: string;
}

interface BrowserEvalArgs {
  javascript?: string;
}

interface BrowserScrollArgs {
  direction?: string;
  pixels?: number;
}

interface BrowserWaitArgs {
  selector?: string;
  text?: string;
  url?: string;
  timeout?: number;
}

interface BrowserPressArgs {
  key?: string;
}

type BrowserToolArgs = BrowserOpenArgs &
  BrowserSnapshotArgs &
  BrowserClickArgs &
  BrowserFillArgs &
  BrowserTypeArgs &
  BrowserScreenshotArgs &
  BrowserGetTextArgs &
  BrowserEvalArgs &
  BrowserScrollArgs &
  BrowserWaitArgs &
  BrowserPressArgs;

type BrowserResult = BrowserResultBase & { snapshot?: string; filePath?: string };

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

async function handleScreenshot(args: BrowserToolArgs, session: string): Promise<BrowserResult> {
  if (args.url) {
    const openRes = await browserService.open(args.url, session);
    if (openRes.success) {
      await delay(3000);
    }
  }

  await delay(2000);

  await browserService.evaluate(
    'if(!document.body.style.backgroundColor) document.body.style.backgroundColor = "white";',
    session,
  );

  let baseName = args.name;
  if (!baseName) {
    try {
      const titleResult = await browserService.evaluate('document.title', session);
      const titleData = titleResult.data as Record<string, unknown> | undefined;
      if (titleResult && titleResult.success && titleData && typeof titleData.result === 'string') {
        baseName = titleData.result
          .toLowerCase()
          .split(/[^a-z0-9]/)
          .filter(Boolean)
          .join('_')
          .substring(0, 30);
      }
    } catch {
      // Title extraction failed — fall back to default name
    }
    if (!baseName) baseName = 'page_capture';
  }

  const fileName = `screenshot_${baseName}_${Date.now()}.png`;

  return browserService.screenshot(session, fileName, args.full_page);
}

export default {
  name: 'dev_tools_browser',
  description:
    'SOTA web navigation tools (agent-browser). Allows navigating, clicking, filling forms, and extracting content.',
  version: '1.0.0',
  enabled: true,

  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'browser_open',
        description: 'Opens a URL in the browser.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL to open.' },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_snapshot',
        description:
          'Captures the accessibility tree of the current page with references (@e1, @e2...).',
        parameters: {
          type: 'object',
          properties: {
            interactive_only: {
              type: 'boolean',
              description: 'If true, only returns interactive elements.',
              default: true,
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_click',
        description: 'Clicks an element via its reference (@eN) or a CSS selector.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'The reference (@e1) or CSS selector.' },
          },
          required: ['selector'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_fill',
        description: 'Fills a form field after clearing it.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'The reference (@e1) or CSS selector.' },
            value: { type: 'string', description: 'The value to enter.' },
          },
          required: ['selector', 'value'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_type',
        description: 'Types text character by character (useful for autocomplete).',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'The reference (@e1) or CSS selector.' },
            text: { type: 'string', description: 'The text to type.' },
          },
          required: ['selector', 'text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_screenshot',
        description:
          'Captures a screenshot of the current page and automatically sends it to the user. You do NOT need to call send_file or send_message to deliver the screenshot, as the system handles this instantly. You MUST provide a descriptive filename (e.g. "hacker_news_home", "github_trending"). Returns the file path of the saved screenshot.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Descriptive filename for the screenshot (without extension).',
            },
            url: {
              type: 'string',
              description:
                "Optional URL to navigate to before taking the screenshot. Very useful if you haven't opened the page yet.",
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_get_text',
        description: 'Extracts text from an element.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'The reference (@e1) or CSS selector.' },
          },
          required: ['selector'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_eval',
        description: 'Executes JavaScript in the context of the page.',
        parameters: {
          type: 'object',
          properties: {
            javascript: { type: 'string', description: 'The JS code to execute.' },
          },
          required: ['javascript'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_scroll',
        description: 'Scrolls the page.',
        parameters: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              enum: ['up', 'down', 'left', 'right'],
              description: 'Scroll direction.',
            },
            pixels: { type: 'number', description: 'Number of pixels to scroll.' },
          },
          required: ['direction'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_wait',
        description: 'Waits for an element, text, or URL pattern to appear.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'Selector to wait for.' },
            text: { type: 'string', description: 'Text to wait for.' },
            url: { type: 'string', description: 'URL to wait for.' },
            timeout: { type: 'number', description: 'Timeout in ms.' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_press',
        description: 'Presses a key on the keyboard.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The key (Enter, Tab, Escape...).' },
          },
          required: ['key'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_back',
        description: 'Goes back to the previous page.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'browser_close',
        description: 'Closes the current browsing session.',
        parameters: { type: 'object', properties: {} },
      },
    },
  ],

  async execute(args: BrowserToolArgs, context: ToolContext, toolName: string) {
    const { chatId } = context;
    const session = browserService.getSessionName(chatId!);

    try {
      if (context.onProgress) context.onProgress(`Browser: ${toolName}...`);

      let result: BrowserResult;

      switch (toolName) {
        case 'browser_open':
          result = await browserService.open(args.url!, session);
          if (result.success) {
            // Implicitly wait for SPA rendering
            await delay(3000);
          }
          break;
        case 'browser_snapshot':
          result = await browserService.snapshot(session, args.interactive_only ?? true);
          break;
        case 'browser_click':
          result = await browserService.click(args.selector!, session);
          break;
        case 'browser_fill':
          result = await browserService.fill(args.selector!, args.value!, session);
          break;
        case 'browser_type':
          result = await browserService.type(args.selector!, args.text!, session);
          break;
        case 'browser_screenshot':
          result = await handleScreenshot(args, session);
          break;
        case 'browser_get_text':
          result = await browserService.getText(args.selector!, session);
          break;
        case 'browser_eval':
          result = await browserService.evaluate(args.javascript!, session);
          break;
        case 'browser_scroll':
          result = await browserService.scroll(
            args.direction as 'up' | 'down' | 'left' | 'right',
            args.pixels,
            session,
          );
          break;
        case 'browser_wait':
          result = await browserService.wait(args, session);
          break;
        case 'browser_press':
          result = await browserService.press(args.key!, session);
          break;
        case 'browser_back':
          result = await browserService.back(session);
          break;
        case 'browser_close':
          result = await browserService.close(session);
          break;
        default:
          return { success: false, message: `Unknown browser tool: ${toolName}` };
      }

      if (!result.success) {
        return {
          success: false,
          llmOutput: `Browser Error (${toolName}): ${result.error}`,
          userOutput: `❌ *Browser Error* (${toolName}): ${result.error}`,
        };
      }

      // Troncature pour Snapshot
      if (
        toolName === 'browser_snapshot' &&
        result.snapshot &&
        result.snapshot.length > MAX_SNAPSHOT_LENGTH
      ) {
        result.snapshot = result.snapshot.substring(0, MAX_SNAPSHOT_LENGTH) + '\n... [TRUNCATED]';
      }

      // For screenshot, we send the file to the user
      if (toolName === 'browser_screenshot' && result.filePath && context.transport) {
        await context.transport.sendMedia(
          chatId!,
          result.filePath,
          { caption: 'Screenshot' },
          context.sourceChannel ?? '',
        );
      }

      return {
        success: true,
        llmOutput: result,
        userOutput: `🌐 *Browser* (${toolName}): ✅ Success`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        llmOutput: `Fatal Browser Error (${toolName}): ${extractErrorMessage(error)}`,
        userOutput: `❌ *Browser Fatal Error* (${toolName}): ${extractErrorMessage(error)}`,
      };
    }
  },
};
