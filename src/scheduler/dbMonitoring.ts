// scheduler/dbMonitoring.js
// ============================================================================
// Tâches schedulées pour le monitoring de la base de données
// ============================================================================

import { databaseMonitor } from '../services/monitoring/DatabaseMonitor.js';

/**
 * Tâche de monitoring quotidien de la base de données
 * Exécutée tous les jours à 6h du matin
 */
export async function monitorDatabaseHealth() {
  console.log('[Scheduler] 🕕 Tâche de monitoring DB démarrée...');

  try {
    // Vérifier la santé générale
    await databaseMonitor.checkDatabaseHealth();

    // Effectuer une vérification complète
    const report = await databaseMonitor.performFullCheck();

    console.log('[Scheduler] ✅ Monitoring DB terminé');
    console.log('[Scheduler] 📊 Rapport:', report.summary);

    return {
      success: true,
      report,
      message: 'Monitoring terminé avec succès',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Scheduler] ❌ Erreur monitoring DB:', errorMessage);

    // Envoyer une alerte critique
    await databaseMonitor.sendCriticalAlert('monitoring_task', 0);

    return {
      success: false,
      error: errorMessage,
      message: 'Erreur lors du monitoring',
    };
  }
}

/**
 * Tâche de cleanup des données anciennes
 * Exécutée toutes les semaines
 */
export async function cleanupOldData() {
  console.log('[Scheduler] 🧹 Tâche de cleanup démarrée...');

  try {
    // Appeler la fonction de cleanup via Supabase
    const { error } = await databaseMonitor.supabase!.rpc('cleanup_old_data');

    if (error) {
      console.error('[Scheduler] Erreur cleanup:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log('[Scheduler] ✅ Cleanup terminé');
    return {
      success: true,
      message: 'Nettoyage effectué avec succès',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Scheduler] ❌ Erreur cleanup:', errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Tâche d'analyse des performances
 * Exécutée toutes les heures
 */
export async function analyzePerformance() {
  console.log("[Scheduler] 📊 Tâche d'analyse de performance démarrée...");

  try {
    await databaseMonitor.checkPerformanceMetrics();

    console.log('[Scheduler] ✅ Analyse performance terminée');
    return {
      success: true,
      message: 'Analyse effectuée avec succès',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Scheduler] ❌ Erreur analyse performance:', errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Tâche de génération de rapport hebdomadaire
 * Exécutée tous les dimanches à 8h
 */
export async function generateWeeklyReport() {
  console.log('[Scheduler] 📋 Génération du rapport hebdomadaire...');

  try {
    const report = await databaseMonitor.generateHealthReport();

    // Sauvegarder le rapport dans un fichier
    const fs = await import('fs');
    const path = await import('path');

    const reportPath = path.join(
      process.cwd(),
      'logs',
      `db_health_report_${new Date().toISOString().split('T')[0]}.json`,
    );

    // Créer le dossier logs s'il n'existe pas
    const logsDir = path.dirname(reportPath);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`[Scheduler] ✅ Rapport généré: ${reportPath}`);
    return {
      success: true,
      reportPath,
      message: 'Rapport généré avec succès',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Scheduler] ❌ Erreur génération rapport:', errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Obtient le statut du monitoring
 */
export async function getMonitoringStatus() {
  return databaseMonitor.getStatus();
}

/**
 * Force une vérification immédiate
 */
export async function forceHealthCheck() {
  console.log('[Scheduler] 🔍 Vérification forcée...');

  try {
    await databaseMonitor.checkDatabaseHealth();
    const report = await databaseMonitor.generateHealthReport();

    return {
      success: true,
      report,
      message: 'Vérification forcée terminée',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Scheduler] ❌ Erreur vérification forcée:', errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}
