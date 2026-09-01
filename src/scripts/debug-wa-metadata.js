import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import createPinoLogger from 'pino';

const groupJid = process.argv[2];

if (!groupJid) {
  console.log('Usage: node scripts/debug-wa-metadata.js <groupJid>');
  process.exit(1);
}

async function main() {
  console.log('🔍 Connexion à WhatsApp pour récupérer les métadonnées BRUTES...');
  console.log('⚠️  ASSUREZ-VOUS QUE LE BOT EST ARRÊTÉ (conflit de session) ⚠️\n');

  const { state, saveCreds } = await useMultiFileAuthState('session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    logger: createPinoLogger({ level: 'silent' }),
    version,
    syncFullAppState: false, // On veut juste lire, pas tout sync
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log('✅ Connecté ! Récupération des métadonnées...\n');

      try {
        const metadata = await sock.groupMetadata(groupJid);
        console.log('=== METADATA BRUTES (API BAILEYS) ===');
        console.log('Subject:', metadata.subject);
        console.log('Owner:', metadata.owner);
        console.log('Creation:', metadata.creation);
        console.log(`Participants: ${metadata.participants.length}`);

        console.log('\n=== ÉCHANTILLON DE 5 PARTICIPANTS ===');
        // Afficher le JSON brut des participants
        metadata.participants.slice(0, 5).forEach((p) => {
          console.log(JSON.stringify(p, null, 2));
        });

        console.log('\n=== ANALYSE ===');
        const hasJid = metadata.participants.some((p) => p.id && p.id.includes('@s.whatsapp.net'));
        const hasLidInId = metadata.participants.some((p) => p.id && p.id.includes('@lid'));

        console.log(
          `Les champs 'id' contiennent des JIDs (@s.whatsapp.net)? : ${hasJid ? 'OUI' : 'NON'}`,
        );
        console.log(`Les champs 'id' contiennent des LIDs (@lid)? : ${hasLidInId ? 'OUI' : 'NON'}`);

        if (hasLidInId && !hasJid) {
          console.log('\nCONCLUSION: WhatsApp renvoie bien des LIDs dans le champ "id" !');
        } else if (hasJid) {
          console.log('\nCONCLUSION: WhatsApp renvoie encore des JIDs. Le problème est ailleurs.');
        }
      } catch (err) {
        console.error('❌ Erreur récupération:', err.message);
      } finally {
        process.exit(0);
      }
    } else if (connection === 'close') {
      if (lastDisconnect?.error?.output?.statusCode !== 401) {
        console.log('Connexion fermée, tentative...');
      } else {
        console.log('Session invalide.');
        process.exit(1);
      }
    }
  });
}

main();
