// Set environment for CLI testing
process.env.ACTIVE_TRANSPORTS = 'cli';
process.env.APP_ENV = 'local';

import { botCore } from '../core/index.js';

interface MinimalMessage {
  id: string;
  chatId: string;
  sender: string;
  senderName: string;
  text: string;
  isGroup: boolean;
  isSystem: boolean;
  raw: { text: string };
  authorityLevel: string;
}

async function simulateIncomingMessage(text: string): Promise<void> {
  console.log(`\n[FULL-PAGE-TEST] 📩 Sending: "${text}"`);

  const messageObj: MinimalMessage = {
    id: `fp_test_${Date.now()}`,
    chatId: 'cli_full_page_test',
    sender: 'test_user',
    senderName: 'Tester',
    text,
    isGroup: false,
    isSystem: false,
    raw: { text },
    authorityLevel: 'DIVIN (SuperUser)',
  };

  const transport = botCore.transport.getTransport('cli');
  if (!transport) {
    throw new Error('CLI transport not found — ensure ACTIVE_TRANSPORTS=cli');
  }

  interface TransportWithHandler {
    messageCallback?: (msg: unknown) => void;
    handleMessage?: (msg: unknown) => void;
  }
  const tHandler = transport as unknown as TransportWithHandler;
  const handler = tHandler.messageCallback ?? tHandler.handleMessage;
  if (typeof handler !== 'function') {
    throw new Error('CLI transport has no message handler');
  }

  handler(messageObj);
}

const delay = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

async function run(): Promise<void> {
  try {
    console.log('🚀 [FULL-PAGE-TEST] Initializing bot core...');
    await botCore.init();

    // WHY: This prompt explicitly requests a full-page screenshot to validate
    // the `full_page: true` flag added to browser_screenshot. It also requests
    // a normal (viewport) screenshot so we can compare both modes side by side.
    const prompt = [
      "Va sur le site https://news.ycombinator.com et fais deux captures d'écran :",
      '1) Une capture d\'écran normale (viewport seulement) avec le nom "hn_viewport"',
      '2) Une capture d\'écran PLEINE PAGE (full_page: true) avec le nom "hn_full_page"',
      'Envoie moi les deux images.',
    ].join(' ');

    await simulateIncomingMessage(prompt);

    // Wait up to 3 minutes for the agentic loop to execute both screenshots
    await delay(180_000);

    console.log('✅ [FULL-PAGE-TEST] Test complete.');
    process.exit(0);
  } catch (error) {
    console.error('❌ [FULL-PAGE-TEST] Failed:', error);
    process.exit(1);
  }
}

run();
