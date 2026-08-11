#!/usr/bin/env node
// scripts/fix-missing-usernames.js
// Script de réparation pour les utilisateurs avec username=NULL
// Récupère les noms depuis le cache Redis et les sync vers Supabase

import { redis, ensureConnected } from '../services/redisClient.js';
import { supabase } from '../services/supabase.js';

async function fixMissingUsernames() {
  console.log('🔧 Réparation des usernames manquants...\n');

  await ensureConnected();

  if (!supabase) {
    console.error('❌ Supabase non disponible');
    process.exit(1);
  }

  // 1. Récupérer tous les utilisateurs sans username
  const { data: usersWithoutName, error } = await supabase
    .from('users')
    .select('jid')
    .is('username', null);

  if (error) {
    console.error('❌ Erreur Supabase:', error);
    process.exit(1);
  }

  console.log(`📊 Utilisateurs sans username: ${usersWithoutName.length}\n`);

  let fixed = 0;
  let notFound = 0;

  for (const user of usersWithoutName) {
    const cacheKey = `user:${user.jid}:profile`;

    // Chercher dans Redis
    const pushName = await redis.hGet(cacheKey, 'last_pushname');

    if (pushName) {
      // Mettre à jour Supabase
      const { error: updateError } = await supabase
        .from('users')
        .update({
          username: pushName,
          last_pushname: pushName,
        })
        .eq('jid', user.jid);

      if (updateError) {
        console.error('❌ Erreur mise à jour %s:', user.jid, updateError);
      } else {
        console.log(`✅ ${user.jid} → "${pushName}"`);
        fixed++;
      }
    } else {
      console.log(`⚠️ ${user.jid} → Pas de nom en cache`);
      notFound++;
    }
  }

  console.log('\n📈 Résumé:');
  console.log(`   - Corrigés: ${fixed}`);
  console.log(`   - Sans nom en cache: ${notFound}`);
  console.log(`   - Total traités: ${usersWithoutName.length}`);

  process.exit(0);
}

fixMissingUsernames().catch((err) => {
  console.error('❌ Erreur:', err);
  process.exit(1);
});
