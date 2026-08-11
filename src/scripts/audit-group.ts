#!/usr/bin/env node
// scripts/audit-group.js
// ============================================================================
// AUDIT COMPLET : Compare WhatsApp (Live) vs Redis (Cache) vs Supabase (DB)
// ⚠️  NÉCESSITE L'ARRÊT DU BOT (Conflit de session)
// ============================================================================

import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import createPinoLogger from 'pino';
import { Boom } from '@hapi/boom';
import { redis, ensureConnected } from '../services/redisClient.js';
import { supabase } from '../services/supabase.js';

const groupJid = process.argv[2];

if (!groupJid) {
  console.log('Usage: node scripts/audit-group.js <groupJid>');
  process.exit(1);
}

async function main() {
  console.log('\n🕵️‍♂️ AUDIT DE GROUPE : LIVE vs CACHE vs DB');
  console.log('⚠️  ASSUREZ-VOUS QUE LE BOT EST ARRÊTÉ ⚠️\n');

  await ensureConnected(); // Connect Redis

  // 1. WhatsApp Live Data
  console.log('📡 Connexion à WhatsApp...');
  const { state, saveCreds } = await useMultiFileAuthState('session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    logger: createPinoLogger({ level: 'silent' }),
    version,
    syncFullAppState: false,
  } as Parameters<typeof makeWASocket>[0]);

  sock.ev.on('creds.update', saveCreds);

  const handleOpen = async (): Promise<void> => {
    try {
      console.log('✅ Connecté ! Récupération metadata live...');
      const liveMeta = await sock.groupMetadata(groupJid);

      // 2. Redis Data
      const cacheKey = `group:${groupJid}:meta`;
      const redisMeta = await redis.hGetAll(cacheKey);

      // 3. Supabase Data
      const { data: dbMeta } = await supabase!
        .from('groups')
        .select('*')
        .eq('jid', groupJid)
        .single();

      console.log('\n📊 --- RAPPORT COMPARATIF --- 📊\n');

      // A. TITRE
      console.log('TITRE:');
      console.log(`  Live: ${liveMeta.subject}`);
      console.log(`  Cache: ${redisMeta.name || 'N/A'}`);
      console.log(`  DB:    ${dbMeta?.name || 'N/A'}`);

      // B. PARTICIPANTS
      const liveCount = liveMeta.participants.length;
      const redisCount = redisMeta.member_count || 'N/A';
      console.log('\nPARTICIPANTS:');
      console.log(`  Live: ${liveCount}`);
      console.log(`  Cache: ${redisCount}`);

      // C. IDENTITÉS (JID vs LID)
      console.log('\nANALYSE DES IDs (Live):');
      const hasJid = liveMeta.participants.some((p) => p.jid);
      const hasLidInId = liveMeta.participants.some((p) => p.id.endsWith('@lid'));
      const realJids = liveMeta.participants.filter(
        (p) => p.jid || p.id.includes('@s.whatsapp.net'),
      ).length;

      console.log(`  Champs 'jid' présents ? ${hasJid ? '✅ OUI' : '❌ NON'}`);
      console.log(`  Champs 'id' sont des LIDs ? ${hasLidInId ? '⚠️ OUI' : '❌ NON'}`);
      console.log(`  Vrais JIDs récupérables : ${realJids}/${liveCount}`);

      // D. FONDATEUR
      const liveOwner = liveMeta.owner || liveMeta.subjectOwner;
      const dbOwner = dbMeta?.founder_jid;
      console.log('\nFONDATEUR:');
      console.log(`  Live (Brut): ${liveOwner}`);
      console.log(`  Redis:       ${redisMeta.owner || 'N/A'}`);
      console.log(`  DB (JID):    ${dbOwner || 'NULL (en attente resolution)'}`);

      console.log('\n--- CONCLUSION ---');
      if (realJids === liveCount) {
        console.log('✅ WhatsApp envoie bien les JIDs. Le fix groupService.js devrait marcher.');
      } else {
        console.log('⚠️ WhatsApp envoie un mix. Le fix doit gérer les deux.');
      }
    } catch (err: unknown) {
      console.error('❌ Erreur:', (err instanceof Error ? err : new Error(String(err))).message);
    } finally {
      process.exit(0);
    }
  };

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      await handleOpen();
    } else if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      if (statusCode === 401) {
        console.log("❌ Session invalide. Reconnectez le bot normalement d'abord.");
        process.exit(1);
      }
    }
  });
}

main().catch((err) => console.error(err));
