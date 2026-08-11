#!/usr/bin/env node
process.env.NODE_NO_WARNINGS = '1';
process.removeAllListeners('warning');
process.on('warning', (warning: Error) => {
  if (warning.name === 'ExperimentalWarning' || warning.message?.includes('localStorage')) {
    return;
  }
  console.warn(warning);
});

import { Command } from 'commander';
import { acquireLock, releaseLock } from '../utils/pidLock.js';
import { botCore } from '../core/index.js';
import { userService } from '../services/userService.js';
import { eventBus, BotEvents } from '../core/events.js';
import { StateManager } from '../services/state/StateManager.js';
import { container } from '../core/ServiceContainer.js';
import { baileysTransport } from '../core/transport/baileys.js';
import * as logger from '../utils/logger.js';
import { safeReadFileSync } from '../utils/safeFs.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const program = new Command();

program.name('hive-mind').description('HIVE-MIND Omni-channel Agent & CLI').version('2.0.0');

// ============================================================================
// COMMANDE PRINCIPALE : DÉMARRAGE DU BOT (TUI / Headless)
// ============================================================================
program
  .command('start', { isDefault: true })
  .description('Démarre le bot (interface locale ou mode serveur selon APP_ENV)')
  .action(async () => {
    const { runStartupMenu } = await import('../cli/startupMenu.js');
    await runStartupMenu();

    console.log('\n🚀 Lancement de HIVE-MIND...\n');
    acquireLock();

    process.on('uncaughtException', (error: unknown) => {
      console.error('❌ Exception non capturée:', error);
    });

    process.on('unhandledRejection', (reason: unknown) => {
      console.error('❌ Promesse rejetée:', reason);
    });

    // Guard idempotent : empêche les exécutions multiples de shutdown
    // (ex: FATAL_TRANSPORT_CONFLICT émis 2 fois, ou SIGINT+SIGTERM simultanés)
    let shutdownInProgress = false;

    const shutdown = async (signal: string) => {
      if (shutdownInProgress) return;
      shutdownInProgress = true;

      console.log(`\n👋 Arrêt du bot (${signal})...`);
      const forceExitTimeout = setTimeout(() => {
        console.warn('⚠️ Shutdown timeout reached. Force exiting...');
        process.exit(1);
      }, 10000);

      // Each step isolated: a failure in one must not prevent the others.
      try {
        console.log('💾 Synchronisation des buffers...');
        await userService.flushAll();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('❌ Erreur flushAll (ignoré):', errorMessage);
      }

      try {
        console.log('🔑 Flush des credentials WhatsApp...');
        await baileysTransport.saveCreds?.();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('❌ Erreur saveCreds (ignoré):', errorMessage);
      }

      try {
        console.log('🔌 Fermeture de la connexion WhatsApp...');
        await botCore.transport.disconnect();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('❌ Erreur disconnect (ignoré):', errorMessage);
      }

      console.log('✅ Nettoyage terminé. Au revoir !');
      eventBus.removeAllListeners();
      releaseLock();
      clearTimeout(forceExitTimeout);
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Conflit de session WhatsApp (erreur 440) : arrêt gracieux du process
    eventBus.subscribe(BotEvents.FATAL_TRANSPORT_CONFLICT, (error: unknown) => {
      console.error(
        '🔴 FATAL: Conflit de session transport détecté — initiation du shutdown gracieux',
        error,
      );
      process.kill(process.pid, 'SIGTERM');
    });

    process.on('exit', () => {
      eventBus.removeAllListeners();
      releaseLock();
    });

    try {
      await botCore.init();

      // Worker Loop: Sync DB toutes les 30s
      setInterval(() => {
        StateManager.processSyncQueue().catch(() => {});
      }, 30000);
    } catch (error) {
      console.error('❌ Erreur fatale:', error);
      process.exit(1);
    }
  });

// ============================================================================
// HELPER POUR LES COMMANDES ADMIN (Init Container)
// ============================================================================
async function initAdminEnv() {
  await container.init({ mode: 'minimal' });
  const dbService = container.get('supabase');
  return {
    redis: container.get('redis'),
    adminService: container.get('adminService'),
    supabase: dbService.client,
  };
}

// ============================================================================
// DEBUG
// ============================================================================
const debugCmd = program.command('debug').description('Gestion des logs de debug');

debugCmd
  .command('on')
  .description('Active tous les logs DEBUG')
  .action(() => {
    logger.enableDebug();
    process.exit(0);
  });

debugCmd
  .command('off')
  .description('Désactive les logs DEBUG')
  .action(() => {
    logger.disableDebug();
    process.exit(0);
  });

debugCmd
  .command('status')
  .description("Affiche l'état actuel du debug")
  .action(() => {
    console.log(logger.debugStatus());
    process.exit(0);
  });

debugCmd
  .command('reset')
  .description('Réinitialise le debug')
  .action(() => {
    logger.resetDebug();
    process.exit(0);
  });

debugCmd
  .command('categories [cats...]')
  .description('Active des catégories spécifiques')
  .action((cats) => {
    if (!cats || cats.length === 0) {
      console.log('Usage: hive-mind debug categories mention authority social');
    } else {
      logger.setDebugCategories(cats);
    }
    process.exit(0);
  });

debugCmd
  .command('identity [status]')
  .description('Active/désactive le debug identité')
  .action(async (status) => {
    const { redis } = await initAdminEnv();
    if (status === 'on') {
      await redis.set('config:debug:identity', 'true');
      console.log('🕵️‍♂️ Debug Identité : ACTIVÉ');
    } else if (status === 'off') {
      await redis.set('config:debug:identity', 'false');
      console.log('🕵️‍♂️ Debug Identité : DÉSACTIVÉ');
    } else {
      const current = await redis.get('config:debug:identity');
      console.log(`État actuel: ${current === 'true' ? '✅ ON' : '❌ OFF'}`);
    }
    process.exit(0);
  });

// ============================================================================
// REDIS
// ============================================================================
const redisCmd = program.command('redis').description('Gestion du cache Redis');

redisCmd
  .command('stats')
  .description('Affiche les statistiques Redis')
  .action(async () => {
    const { redis } = await initAdminEnv();
    const stats = await logger.redisStats(redis);
    console.log('📊 Statistiques Redis:', stats);
    process.exit(0);
  });

redisCmd
  .command('flush')
  .description('Efface TOUT le cache Redis')
  .option('-y, --yes', 'Confirmer la suppression')
  .action(async (options) => {
    const { redis } = await initAdminEnv();
    if (!options.yes) {
      console.log('⚠️ ATTENTION: Utilisez --yes pour confirmer.');
    } else {
      console.log('💾 Tentative de sync avant flush...');
      try {
        await StateManager.processSyncQueue(1000);
      } catch {
        /* ignore */
      }
      const result = await logger.flushRedisCache(redis);
      console.log('Résultat:', result);
    }
    process.exit(0);
  });

redisCmd
  .command('clear-group <jid>')
  .description("Efface le cache d'un groupe")
  .action(async (jid) => {
    const { redis } = await initAdminEnv();
    const cacheKey = `group:${jid}:meta`;
    await redis.del(cacheKey);
    console.log(`🗑️ Cache groupe effacé: ${cacheKey}`);
    process.exit(0);
  });

// ============================================================================
// STATE
// ============================================================================
const stateCmd = program.command('state').description("Gestion de l'état de synchronisation");

stateCmd
  .command('sync')
  .description('Force la synchronisation Redis -> Supabase')
  .action(async () => {
    await initAdminEnv();
    console.log('💾 Forçage de la synchronisation...');
    try {
      await StateManager.processSyncQueue(1000);
      console.log('✅ Terminé.');
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error('❌ Erreur sync:', errorMessage);
    }
    process.exit(0);
  });

stateCmd
  .command('inspect <jid>')
  .description("Inspecte l'état d'un utilisateur")
  .action(async (jid) => {
    const { redis } = await initAdminEnv();
    const data = await redis.hGetAll(`user:${jid}:data`);
    const isLocked = await redis.exists(`lock:user:${jid}`);
    const isQueued = await redis.sIsMember('queue:sync:users', jid);
    console.log({
      redisData: data,
      locked: isLocked ? '🔒 OUI' : '🔓 NON',
      pendingSync: isQueued ? '⏳ OUI' : '✅ NON',
    });
    process.exit(0);
  });

stateCmd
  .command('release-lock <jid>')
  .description("Fait sauter le verrou d'un utilisateur")
  .action(async (jid) => {
    const { redis } = await initAdminEnv();
    const lockKey = `lock:user:${jid}`;
    const result = await redis.del(lockKey);
    console.log(result ? `🔓 Verrou sauté pour ${jid}` : '⚠️ Aucun verrou trouvé');
    process.exit(0);
  });

// ============================================================================
// ADMIN
// ============================================================================
const adminCmd = program.command('admin').description('Gestion des admins globaux');

adminCmd
  .command('refresh')
  .description('Rafraîchit le cache admin')
  .action(async () => {
    const { adminService } = await initAdminEnv();
    await logger.refreshAdminCache(
      adminService as unknown as Parameters<typeof logger.refreshAdminCache>[0],
    );
    process.exit(0);
  });

adminCmd
  .command('list')
  .description('Liste les admins globaux')
  .action(async () => {
    const { adminService } = await initAdminEnv();
    const admins = await adminService.listAdmins();
    console.log('👑 Admins globaux:');
    admins.forEach((a: unknown) => {
      const admin = a as { jid: string; role: string };
      console.log(`   - ${admin.jid} (${admin.role})`);
    });
    process.exit(0);
  });

adminCmd
  .command('add <jid> [name] [role]')
  .description('Ajoute un admin')
  .action(async (jid, name, role) => {
    const { adminService } = await initAdminEnv();
    const added = await adminService.addAdmin(jid, name || 'Admin', role || 'moderator');
    console.log(added ? `✅ Admin ajouté : ${jid}` : '❌ Erreur ajout');
    process.exit(0);
  });

adminCmd
  .command('remove <jid>')
  .description('Retire un admin')
  .action(async (jid) => {
    const { adminService } = await initAdminEnv();
    const removed = await adminService.removeAdmin(jid);
    console.log(removed ? `✅ Admin retiré : ${jid}` : '❌ Erreur retrait');
    process.exit(0);
  });

// ============================================================================
// TOOLS / DB / SYSTEM
// ============================================================================
program
  .command('tools:index')
  .description('Indexe tous les outils du bot')
  .action(async () => {
    console.log('🔧 Indexation des outils...\n');
    const { supabase } = await initAdminEnv();
    try {
      const { pluginLoader } = await import('../plugins/loader.js');
      const embeddings = container.get('embeddings');
      await pluginLoader.loadAll();
      const tools = pluginLoader.getToolDefinitions();
      let indexed = 0;
      for (const tool of tools) {
        const toolName = tool.function?.name;
        if (!toolName) continue;
        const vector = await embeddings.embed(`${toolName}: ${tool.function?.description}`);
        if (vector && supabase) {
          const { error } = await supabase.from('bot_tools').upsert(
            {
              name: toolName,
              plugin_name: toolName.split('_')[0],
              description: tool.function?.description,
              definition: tool,
              embedding: vector,
            },
            { onConflict: 'name' },
          );
          if (!error) indexed++;
        }
      }
      console.log(`✅ ${indexed}/${tools.length} outils indexés.`);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error('❌ Erreur indexation:', errorMessage);
    }
    process.exit(0);
  });

program
  .command('db:reset-data')
  .description('Réinitialise les tables de la BDD (sauf admins)')
  .option('-y, --yes', 'Confirmer la suppression')
  .action(async (options) => {
    if (!options.yes) {
      console.log('⚠️ ATTENTION: Utilisez --yes pour confirmer.');
      process.exit(0);
    }
    const { supabase, adminService } = await initAdminEnv();
    console.log('🛑 DÉMARRAGE DU NETTOYAGE DB...');
    try {
      const adminJids = (await adminService.listAdmins()).map(
        (a: unknown) => (a as { jid: string }).jid,
      );
      let tablesToFlush = ['memories', 'facts', 'groups'];
      try {
        tablesToFlush = JSON.parse(
          safeReadFileSync(join(__dirname, '..', 'config', 'db-reset-tables.json'), 'utf-8'),
        ) as string[];
      } catch {
        /* ignore */
      }

      if (supabase) {
        for (const table of tablesToFlush) {
          console.log(`🗑️ Vidage de ${table}...`);
          let query = supabase.from(table).delete();
          query = query.neq('id', '00000000-0000-0000-0000-000000000000');
          await query;
        }

        if (adminJids.length > 0) {
          await supabase.from('users').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        } else {
          await supabase.from('users').delete().neq('jid', 'x');
        }
      }
      console.log('✅ Base de données réinitialisée !');
    } catch (e) {
      console.error('❌ Erreur:', e);
    }
    process.exit(0);
  });

program
  .command('status')
  .description("Affiche l'état du système")
  .action(async () => {
    const { redis, adminService } = await initAdminEnv();
    const status = await logger.systemStatus({ redis, adminService });
    console.log('\n📊 État du système:\n', JSON.stringify(status, null, 2));
    process.exit(0);
  });

program.parse(process.argv);
