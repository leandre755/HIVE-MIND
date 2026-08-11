import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay,
  proto,
} from '@whiskeysockets/baileys';
import createPinoLogger from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import { join } from 'path';
import { Boom } from '@hapi/boom';
import { Command } from 'commander';

// --- CONFIGURATION ---
const program = new Command();
program
  .option('-a, --account <type>', 'Account type (admin or user)', 'user')
  .option('-t, --target <jid>', 'Target bot JID')
  .parse(process.argv);

const options = program.opts();
const accountType = options.account;
const SESSION_BASE_PATH = './session_test_';
const sessionPath = join(process.cwd(), `${SESSION_BASE_PATH}${accountType}`);

// Target definitions
let defaultBotJid = '2250704414707@s.whatsapp.net';
let defaultUserJid = '22569456432@s.whatsapp.net'; // Without the session suffix

try {
  const credsBot = JSON.parse(fs.readFileSync('./session/creds.json', 'utf-8'));
  if (credsBot?.me?.id) defaultBotJid = credsBot.me.id.split(':')[0] + '@s.whatsapp.net';

  const credsUser = JSON.parse(fs.readFileSync('./session_test_user/creds.json', 'utf-8'));
  if (credsUser?.me?.id) defaultUserJid = credsUser.me.id.split(':')[0] + '@s.whatsapp.net';
} catch (e) {
  console.error('Error reading creds, using defaults:', e);
}

// Log filter
const filterTerms = [
  'SessionEntry',
  'Decrypted message',
  'Closing open session',
  'registrationId',
  '<Buffer',
];
function shouldFilter(message: string) {
  return filterTerms.some((term) => message.includes(term));
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: createPinoLogger({ level: 'silent' }) as Parameters<typeof makeWASocket>[0]['logger'],
    browser: ['HIVE-MIND Plugins Tester', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  return new Promise<typeof sock>((resolve, reject) => {
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) qrcode.generate(qr, { small: true });

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) connectToWhatsApp().then(resolve).catch(reject);
        else reject(new Error('Logged out'));
      } else if (connection === 'open') {
        console.log(`[TEST-RUNNER] ✅ Connected successfully as ${accountType.toUpperCase()}`);
        resolve(sock);
      }
    });
  });
}

async function sendAndWaitForResponse(
  sock: Awaited<ReturnType<typeof connectToWhatsApp>>,
  jid: string,
  content: string | Record<string, unknown>,
  expectedMatch: (msg: proto.IWebMessageInfo) => boolean,
  timeoutMs: number = 30000,
): Promise<boolean> {
  console.log(
    '[TEST-RUNNER] 📤 Sending to %s:',
    jid,
    typeof content === 'string' ? content : content.text,
  );

  if (typeof content === 'string') {
    await sock.sendMessage(jid, { text: content });
  } else {
    await sock.sendMessage(jid, content as Parameters<typeof sock.sendMessage>[1]);
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      sock.ev.off('messages.upsert', messageListener);
      resolve(false);
    }, timeoutMs);

    const messageListener = (upsert: { messages: proto.IWebMessageInfo[] }) => {
      for (const msg of upsert.messages) {
        if (msg.key.remoteJid === jid && !msg.key.fromMe) {
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
          if (msg.message?.audioMessage) console.log('\n[TEST-RUNNER] 📥 Received Voice Note');
          else if (msg.message?.documentMessage)
            console.log('\n[TEST-RUNNER] 📥 Received Document');
          else if (msg.message?.imageMessage) console.log('\n[TEST-RUNNER] 📥 Received Image');
          else if (text && !shouldFilter(text))
            console.log(`\n[TEST-RUNNER] 📥 Received:\n---\n${text}\n---`);

          if (expectedMatch(msg)) {
            clearTimeout(timeout);
            sock.ev.off('messages.upsert', messageListener);
            resolve(true);
          }
        }
      }
    };
    sock.ev.on('messages.upsert', messageListener);
  });
}

async function run() {
  let sock: Awaited<ReturnType<typeof connectToWhatsApp>> | null = null;
  try {
    sock = await connectToWhatsApp();
  } catch (err) {
    console.error('Failed to connect:', err);
    process.exit(1);
  }

  try {
    console.log('\n=========================================');
    console.log('🧪 STAGE 0: BASIC CONNECTIVITY');
    console.log('=========================================');

    let success = await sendAndWaitForResponse(
      sock!,
      defaultBotJid,
      '/ping',
      (msg) => {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        return text.toLowerCase().includes('pong');
      },
      20000,
    );
    if (!success) {
      console.warn('⚠️ Ping failed, but continuing with plugins...');
    } else {
      console.log('✅ Ping OK');
    }

    console.log('\n=========================================');
    console.log('🧪 STAGE 1: GROUP MANAGER PLUGIN TESTS');
    console.log('=========================================');

    console.log('[TEST-RUNNER] 👥 Creating test group with Bot and User...');
    const groupInfo = await sock!.groupCreate('HIVE-MIND E2E Plugins', [
      defaultBotJid,
      defaultUserJid,
    ]);
    console.log(`[TEST-RUNNER] ✅ Group created: ${groupInfo.id}`);

    await delay(3000);

    console.log('[TEST-RUNNER] 👑 Promoting Bot to admin...');
    await sock!.groupParticipantsUpdate(groupInfo.id, [defaultBotJid], 'promote');
    console.log('[TEST-RUNNER] ✅ Bot promoted to admin.');

    await delay(2000);

    console.log('\n--- Test 1.1: tagall ---');
    success = await sendAndWaitForResponse(
      sock!,
      groupInfo.id,
      {
        text: `@${defaultBotJid.split('@')[0]} tagall pour le test des plugins`,
        mentions: [defaultBotJid],
      },
      (msg) => {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        return text.includes('@') && mentionedJids.length > 0;
      },
      30000,
    );
    console.log(success ? '✅ tagall OK' : '❌ tagall FAILED');

    console.log('\n--- Test 1.2: Ban User ---');
    success = await sendAndWaitForResponse(
      sock!,
      groupInfo.id,
      {
        text: `@${defaultBotJid.split('@')[0]} ban @${defaultUserJid.split('@')[0]} pour test automatisé`,
        mentions: [defaultBotJid, defaultUserJid],
      },
      (msg) => {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        // Wait for the bot to confirm the ban
        return text.toLowerCase().includes('banni') || text.toLowerCase().includes('retiré');
      },
      40000,
    );
    console.log(success ? '✅ Ban OK' : '❌ Ban FAILED');

    console.log('\n=========================================');
    console.log('🧪 STAGE 2: TOOLS PLUGINS TESTS (Direct Messages)');
    console.log('=========================================');

    console.log('\n--- Test 2.1: Translate ---');
    success = await sendAndWaitForResponse(
      sock!,
      defaultBotJid,
      "Traduis 'L'intelligence artificielle est fascinante' en japonais.",
      (msg) => {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        // Simple heuristic: if there's text returning that looks like a translation or mentions it
        return (
          text.includes('japonais') ||
          /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(
            text,
          )
        );
      },
      30000,
    );
    console.log(success ? '✅ Translate OK' : '❌ Translate FAILED');

    console.log('\n--- Test 2.2: Shopping ---');
    success = await sendAndWaitForResponse(
      sock!,
      defaultBotJid,
      'Cherche moi un clavier mécanique logitech sur amazon avec le plugin shopping',
      (msg) => {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        return text.toLowerCase().includes('logitech') || text.toLowerCase().includes('clavier');
      },
      45000,
    );
    console.log(success ? '✅ Shopping OK' : '❌ Shopping FAILED');

    console.log('\n--- Test 2.3: Daily Pulse ---');
    success = await sendAndWaitForResponse(
      sock!,
      defaultBotJid,
      "Fais moi le daily pulse de la journée s'il te plaît.",
      (msg) => {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        return text.length > 50; // Daily pulse is usually a long summary
      },
      60000,
    );
    console.log(success ? '✅ Daily Pulse OK' : '❌ Daily Pulse FAILED');

    console.log('\n--- Test 2.4: Visual Reporter ---');
    success = await sendAndWaitForResponse(
      sock!,
      defaultBotJid,
      'Génère un rapport pdf de nos derniers échanges avec le plugin visual reporter.',
      (msg) => {
        // Should return a document (PDF)
        return !!msg.message?.documentMessage;
      },
      60000,
    );
    console.log(success ? '✅ Visual Reporter OK' : '❌ Visual Reporter FAILED');

    console.log('\n--- Test 2.5: Send Email ---');
    success = await sendAndWaitForResponse(
      sock!,
      defaultBotJid,
      'Envoie un email de test à lender926@gmail.com en disant que le test E2E fonctionne parfaitement.',
      (msg) => {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        return text.toLowerCase().includes('envoyé') || text.toLowerCase().includes('succès');
      },
      45000,
    );
    console.log(success ? '✅ Send Email OK' : '❌ Send Email FAILED');
  } catch (error) {
    console.error('Test Execution Error:', error);
  } finally {
    await delay(3000);
    console.log('\n[TEST-RUNNER] Finished.');
    process.exit(0);
  }
}

process.on('SIGINT', () => {
  process.exit(0);
});

run();
