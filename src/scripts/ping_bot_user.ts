import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  delay,
} from '@whiskeysockets/baileys';
import createPinoLogger from 'pino';

async function run() {
  const { state, saveCreds } = await useMultiFileAuthState('./session_test_user');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: createPinoLogger({ level: 'silent' }) as unknown as Parameters<
      typeof makeWASocket
    >[0]['logger'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection } = update;
    if (connection === 'open') {
      console.log('✅ Connected');
      const botJid = '2250704414707@s.whatsapp.net';
      console.log('📤 Sending ping...');
      await sock.sendMessage(botJid, { text: '/ping' });
    }
  });

  sock.ev.on('messages.upsert', (m) => {
    for (const msg of m.messages) {
      if (!msg.key.fromMe) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        console.log('📥 Received:', text);
        if (text.toLowerCase().includes('pong')) {
          console.log('🎯 Success!');
          process.exit(0);
        }
      }
    }
  });

  await delay(20000);
  console.log('❌ Timeout');
  process.exit(1);
}

run();
