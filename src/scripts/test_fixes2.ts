import sysInteraction from '../plugins/base/sys_interaction/index.js';
import { safeUnlinkSync, safeWriteFileSync } from '../utils/safeFs.js';

async function testSendFile() {
  let sentMedia: {
    chatId: string;
    filePath: string;
    options: Record<string, unknown>;
    channel?: string;
  } | null = null;
  const mockTransport = {
    sendMedia: async (
      chatId: string,
      filePath: string,
      options: Record<string, unknown>,
      channel?: string,
    ) => {
      sentMedia = { chatId, filePath, options, channel };
    },
  };

  const context = {
    transport: mockTransport,
    chatId: '123@c.us',
    sourceChannel: 'cli',
  };

  console.log('Testing Markdown file...');
  safeWriteFileSync('test.md', '# Hello');
  await sysInteraction.execute(
    { filePath: 'test.md' },
    context as unknown as Parameters<typeof sysInteraction.execute>[1],
    'send_file',
  );
  console.log(sentMedia);
  safeUnlinkSync('test.md');

  console.log('\nTesting PDF file...');
  safeWriteFileSync('test.pdf', '%PDF-');
  await sysInteraction.execute(
    { filePath: 'test.pdf' },
    context as unknown as Parameters<typeof sysInteraction.execute>[1],
    'send_file',
  );
  console.log(sentMedia);
  safeUnlinkSync('test.pdf');
}

testSendFile().catch(console.error);
