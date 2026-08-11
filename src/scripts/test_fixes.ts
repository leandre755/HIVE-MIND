import fs from 'fs';

console.log('--- TEST THOUGHT TAG REGEX ---');

function testRegex(input: string) {
  const thoughts: string[] = [];
  let finalResponse = input;

  // 1. Properly enclosed tags
  const enclosedRegex = /<(think|thought|thinking)>([\s\S]*?)<\/\1>/gi;
  // 2. Unclosed opening tag (from tag to the end)
  const unclosedRegex = /<(think|thought|thinking)>([\s\S]*?)$/gi;
  // 3. Unopened closing tag (from start to the closing tag)
  const unopenedRegex = /^([\s\S]*?)<\/(think|thought|thinking)>/gi;

  let thoughtMatch;

  while ((thoughtMatch = enclosedRegex.exec(finalResponse)) !== null) {
    thoughts.push(thoughtMatch[2].trim());
  }
  finalResponse = finalResponse.replace(enclosedRegex, '');

  while ((thoughtMatch = unopenedRegex.exec(finalResponse)) !== null) {
    thoughts.push(thoughtMatch[1].trim());
  }
  finalResponse = finalResponse.replace(unopenedRegex, '');

  while ((thoughtMatch = unclosedRegex.exec(finalResponse)) !== null) {
    thoughts.push(thoughtMatch[2].trim());
  }
  finalResponse = finalResponse.replace(unclosedRegex, '');

  finalResponse = finalResponse.replace(/<\/?(think|thought|thinking)>/gi, '').trim();

  return {
    thoughts,
    remainingText: finalResponse,
  };
}

const cases = [
  { name: 'Normal', text: '<thought> This is a thought </thought> Hello user!' },
  {
    name: 'Forgot to close',
    text: '<thought> I am thinking but forgot to close. Oh well, here is my thought.',
  },
  {
    name: 'Forgot to close with text before',
    text: 'Some text before. <thought> I am thinking but forgot to close.',
  },
  { name: 'Forgot to open', text: 'I forgot to open. </thought> Hello user!' },
  { name: 'Double unclosed', text: '<thought> thought 1 <thought> thought 2' },
  { name: 'No thought', text: 'Hello user!' },
];

for (const c of cases) {
  console.log(`\nCase: ${c.name}`);
  console.log(`Input: "${c.text}"`);
  const res = testRegex(c.text);
  console.log('Extracted Thoughts:', res.thoughts);
  console.log(`Remaining Text to send to user: "${res.remainingText}"`);
}

console.log('\n--- TEST SEND_FILE PATH LOGIC ---');
import sysInteraction from '../plugins/base/sys_interaction/index.js';

async function testSendFile() {
  // Mock the transport
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
  } as unknown as Parameters<typeof sysInteraction.execute>[1];

  console.log('1. Testing valid URL...');
  let res = await sysInteraction.execute(
    {
      filePath: 'https://example.com/image.png',
    },
    context,
    'send_file',
  );
  console.log('Result URL:', res);
  console.log('SentMedia:', sentMedia);

  console.log('\n2. Testing invalid local file...');
  res = await sysInteraction.execute(
    {
      filePath: 'does_not_exist.txt',
    },
    context,
    'send_file',
  );
  console.log('Result Invalid Local:', res);

  console.log('\n3. Testing valid local file...');
  fs.writeFileSync('test_exists.txt', 'hello');
  res = await sysInteraction.execute(
    {
      filePath: 'test_exists.txt',
    },
    context,
    'send_file',
  );
  console.log('Result Valid Local:', res);
  console.log('SentMedia:', sentMedia);
  fs.unlinkSync('test_exists.txt');
}

testSendFile().catch(console.error);
