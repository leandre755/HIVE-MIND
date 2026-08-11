// services/monitoring/DatabaseMonitor.ts
// ============================================================================
// Service de monitoring de la base de données avec alerting
// ============================================================================

import { supabase as supabaseClient } from '../supabase.js';

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getSupabaseClient() {
  if (!supabaseClient) {
    throw new Error('[DatabaseMonitor] Supabase client not initialized');
  }
  return supabaseClient;
}

interface MonitoringThresholds {
  warning: number;
  critical: number;
  maxSize: number;
}

interface TableStats {
  schemaname: string;
  tablename: string;
  size_pretty: string;
  size_bytes: number;
}

interface DatabaseStats {
  tables: TableStats[];
  totalSize: number;
  totalSizePretty: string;
}

interface DetailedTableStats {
  table_name: string;
  size: string;
  size_bytes: number;
  row_count: number;
  last_insert: string | null;
}

interface GrowthDataPoint {
  day: string;
  count: number;
}

interface SlowQuery {
  query: string;
  mean_time: number;
  calls: number;
}

interface IndexInfo {
  schemaname: string;
  tablename: string;
  indexname: string;
  indexdef: string;
}

interface ConstraintInfo {
  constraint_name: string;
  constraint_type: string;
  table_name: string;
}

interface Alert {
  type: string;
  table: string;
  size?: string;
  growthRate?: number;
  message: string;
  timestamp: string;
}

interface HealthRecommendation {
  type: string;
  priority: string;
  table?: string;
  tables?: string[];
  message: string;
  action: string;
}

interface HealthReportSummary {
  totalTables: number;
  totalSize: string;
  largestTable: string;
  largestSize: string;
}

interface HealthReport {
  timestamp: string;
  summary: HealthReportSummary;
  tables: Array<{
    name: string;
    size: string;
    rows: number;
    lastInsert: string | null;
  }>;
  recommendations: HealthRecommendation[];
}

interface MonitorStatus {
  active: boolean;
  lastCheck: string;
  thresholds: MonitoringThresholds;
  activeAlerts: number;
}

/**
 * Service de monitoring de la base de données
 * Surveille la taille des tables, les performances et envoie des alertes
 */
export class DatabaseMonitor {
  thresholds: MonitoringThresholds;
  alertedTables: Set<string>;
  monitoringActive: boolean;
  supabase: typeof supabaseClient;
  private hourlyIntervalId: ReturnType<typeof setInterval> | null = null;
  private dailyIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.thresholds = {
      // Seuils d'alerte (en bytes)
      warning: 100 * 1024 * 1024, // 100MB
      critical: 500 * 1024 * 1024, // 500MB
      maxSize: 1024 * 1024 * 1024, // 1GB
    };

    this.alertedTables = new Set(); // Tracker les tables déjà alertées
    this.monitoringActive = false;
    this.supabase = supabaseClient;
  }

  /**
   * Initialise le monitoring
   */
  async init(): Promise<void> {
    console.log('[DatabaseMonitor] 🔍 Initialisation du monitoring DB...');

    // Vérifier la connectivité
    try {
      const { error } = await getSupabaseClient().from('memories').select('id').limit(1);
      if (error) throw error;

      console.log('[DatabaseMonitor] ✅ Connecté à Supabase');
      this.monitoringActive = true;

      // Démarrer le monitoring périodique
      this.startPeriodicMonitoring();
    } catch (error: unknown) {
      console.error('[DatabaseMonitor] ❌ Erreur connexion:', extractErrorMessage(error));
      this.monitoringActive = false;
    }
  }

  /**
   * Démarre le monitoring périodique
   * @private
   */
  startPeriodicMonitoring(): void {
    // Stocker les références pour éviter les fuites mémoire
    if (this.hourlyIntervalId !== null) clearInterval(this.hourlyIntervalId);
    if (this.dailyIntervalId !== null) clearInterval(this.dailyIntervalId);

    // Vérifier toutes les heures
    this.hourlyIntervalId = setInterval(
      async () => {
        if (!this.monitoringActive) return;

        try {
          await this.checkDatabaseHealth();
        } catch (error: unknown) {
          console.error('[DatabaseMonitor] Erreur monitoring:', extractErrorMessage(error));
        }
      },
      60 * 60 * 1000,
    ); // Toutes les heures

    // Vérification complète tous les jours à 6h
    this.dailyIntervalId = setInterval(async () => {
      if (!this.monitoringActive) return;

      try {
        console.log('[DatabaseMonitor] 📊 Vérification complète quotidienne...');
        await this.performFullCheck();
      } catch (error: unknown) {
        console.error(
          '[DatabaseMonitor] Erreur vérification complète:',
          extractErrorMessage(error),
        );
      }
    }, this.getNextDailyCheck());

    console.log('[DatabaseMonitor] ⏰ Monitoring démarré');
  }

  /**
   * Arrête le monitoring et nettoie les intervalles
   */
  stop(): void {
    this.monitoringActive = false;
    if (this.hourlyIntervalId !== null) {
      clearInterval(this.hourlyIntervalId);
      this.hourlyIntervalId = null;
    }
    if (this.dailyIntervalId !== null) {
      clearInterval(this.dailyIntervalId);
      this.dailyIntervalId = null;
    }
  }

  /**
   * Vérifie la santé générale de la base de données
   */
  async checkDatabaseHealth(): Promise<void> {
    const stats = await this.getDatabaseStats();

    // Vérifier chaque table
    for (const table of stats.tables) {
      await this.checkTableHealth(table);
    }

    // Vérifier les performances
    await this.checkPerformanceMetrics();

    // Log résumé
    console.log(
      `[DatabaseMonitor] 📈 Santé DB - Tables: ${stats.tables.length}, Taille totale: ${stats.totalSize}`,
    );
  }

  /**
   * Vérifie la santé d'une table spécifique
   * @param table - Info table {name, size}
   */
  async checkTableHealth(table: TableStats): Promise<void> {
    const { tablename, size_bytes } = table;

    // Vérifier seuils
    if (size_bytes > this.thresholds.critical) {
      await this.sendCriticalAlert(tablename, size_bytes);
    } else if (size_bytes > this.thresholds.warning) {
      await this.sendWarningAlert(tablename, size_bytes);
    }

    // Vérifier croissance anormale
    await this.checkGrowthRate(tablename);
  }

  /**
   * Obtient les statistiques de la base de données
   * @returns Stats DB
   */
  async getDatabaseStats(): Promise<DatabaseStats> {
    try {
      // Obtenir la taille des tables principales
      const { data, error } = await getSupabaseClient().rpc('exec_sql', {
        sql: `
                    SELECT 
                        schemaname,
                        tablename,
                        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size_pretty,
                        pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
                    FROM pg_tables 
                    WHERE schemaname = 'public'
                    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
                `,
      });

      if (error) throw error;

      const tables = (data ?? []) as TableStats[];
      const totalSize = tables.reduce((sum: number, tbl: TableStats) => sum + tbl.size_bytes, 0);

      return {
        tables,
        totalSize,
        totalSizePretty: this.formatBytes(totalSize),
      };
    } catch (error: unknown) {
      console.error('[DatabaseMonitor] Erreur stats:', extractErrorMessage(error));
      return { tables: [], totalSize: 0, totalSizePretty: '0 B' };
    }
  }

  /**
   * Vérifie le taux de croissance d'une table
   * @param tableName
   */
  async checkGrowthRate(tableName: string): Promise<void> {
    try {
      // Obtenir la croissance sur 7 jours
      const { data, error } = await getSupabaseClient().rpc('exec_sql', {
        sql: `
                    SELECT 
                        date_trunc('day', created_at) as day,
                        count(*) as count
                    FROM ${tableName}
                    WHERE created_at > now() - interval '7 days'
                    GROUP BY day
                    ORDER BY day DESC;
                `,
      });

      if (error) throw error;

      const growthData = (data ?? []) as GrowthDataPoint[];

      // Analyser la tendance
      if (growthData.length >= 3) {
        const recent =
          growthData.slice(0, 3).reduce((sum: number, d: GrowthDataPoint) => sum + d.count, 0) / 3;
        const older =
          growthData.slice(-3).reduce((sum: number, d: GrowthDataPoint) => sum + d.count, 0) / 3;

        if (older === 0) return;

        const growthRate = (recent - older) / older;

        if (growthRate > 2) {
          // +200% = alerte
          console.warn(
            `[DatabaseMonitor] 🚨 Croissance explosive détectée sur ${tableName}: +${Math.round(growthRate * 100)}%`,
          );
          await this.sendGrowthAlert(tableName, growthRate);
        }
      }
    } catch (error: unknown) {
      console.warn(
        '[DatabaseMonitor] Erreur croissance %s:',
        tableName,
        extractErrorMessage(error),
      );
    }
  }

  /**
   * Vérifie les métriques de performance
   */
  async checkPerformanceMetrics(): Promise<void> {
    try {
      // Vérifier les temps de réponse des requêtes lentes
      const { data, error } = await getSupabaseClient().rpc('exec_sql', {
        sql: `
                    SELECT query, mean_time, calls
                    FROM pg_stat_statements 
                    WHERE mean_time > 1000  -- > 1 seconde
                    ORDER BY mean_time DESC 
                    LIMIT 5;
                `,
      });

      if (error) {
        // pg_stat_statements peut ne pas être activé
        console.log('[DatabaseMonitor] ℹ️ pg_stat_statements non disponible');
        return;
      }

      const queries = (data ?? []) as SlowQuery[];
      if (queries.length > 0) {
        console.warn(`[DatabaseMonitor] ⚠️ ${queries.length} requêtes lentes détectées`);
        queries.forEach((query: SlowQuery) => {
          console.warn(
            `[DatabaseMonitor] Lente: ${query.mean_time}ms - ${query.query.substring(0, 100)}...`,
          );
        });
      }
    } catch (error: unknown) {
      console.warn('[DatabaseMonitor] Erreur perf metrics:', extractErrorMessage(error));
    }
  }

  /**
   * Effectue une vérification complète
   */
  async performFullCheck(): Promise<HealthReport> {
    console.log('[DatabaseMonitor] 🔍 Vérification complète...');

    // Stats détaillées
    const stats = await this.getDetailedStats();
    console.log('[DatabaseMonitor] Statistiques détaillées:', stats);

    // Vérifier les indexes
    await this.checkIndexesHealth();

    // Vérifier les contraintes
    await this.checkConstraintsHealth();

    // Générer rapport
    return await this.generateHealthReport();
  }

  /**
   * Obtient des statistiques détaillées
   */
  async getDetailedStats(): Promise<DetailedTableStats[]> {
    try {
      const { data, error } = await getSupabaseClient().rpc('exec_sql', {
        sql: `
                    SELECT 
                        table_name,
                        pg_size_pretty(pg_total_relation_size('public.' || table_name)) as size,
                        pg_total_relation_size('public.' || table_name) as size_bytes,
                        (SELECT count(*) FROM public.||table_name) as row_count,
                        (SELECT max(created_at) FROM public.||table_name WHERE created_at IS NOT NULL) as last_insert
                    FROM information_schema.tables 
                    WHERE table_schema = 'public'
                    ORDER BY pg_total_relation_size('public.' || table_name) DESC;
                `,
      });

      if (error) throw error;

      return (data ?? []) as DetailedTableStats[];
    } catch (error: unknown) {
      console.error('[DatabaseMonitor] Erreur stats détaillées:', extractErrorMessage(error));
      return [];
    }
  }

  /**
   * Vérifie la santé des indexes
   */
  async checkIndexesHealth(): Promise<void> {
    try {
      const { data, error } = await getSupabaseClient().rpc('exec_sql', {
        sql: `
                    SELECT 
                        schemaname,
                        tablename,
                        indexname,
                        indexdef
                    FROM pg_indexes 
                    WHERE schemaname = 'public'
                    ORDER BY tablename, indexname;
                `,
      });

      if (error) throw error;

      const indexes = (data ?? []) as IndexInfo[];
      console.log(`[DatabaseMonitor] 📊 Indexes: ${indexes.length} trouvés`);

      // Vérifier les indexes manquants sur les colonnes fréquemment utilisées
      const criticalColumns = ['chat_id', 'created_at', 'status'];
      const tablesNeedingIndexes: string[] = [];

      // Logique simplifiée - en production, utiliser pg_stat_user_tables
      for (const tableName of ['memories', 'agent_actions', 'facts']) {
        for (const column of criticalColumns) {
          const hasIndex = indexes.some(
            (idx: IndexInfo) => idx.tablename === tableName && idx.indexdef.includes(column),
          );

          if (!hasIndex) {
            tablesNeedingIndexes.push(`${tableName}.${column}`);
          }
        }
      }

      if (tablesNeedingIndexes.length > 0) {
        console.warn('[DatabaseMonitor] ⚠️ Indexes manquants suggérés:', tablesNeedingIndexes);
      }
    } catch (error: unknown) {
      console.error('[DatabaseMonitor] Erreur indexes:', extractErrorMessage(error));
    }
  }

  /**
   * Vérifie la santé des contraintes
   */
  async checkConstraintsHealth(): Promise<void> {
    try {
      const { data, error } = await getSupabaseClient().rpc('exec_sql', {
        sql: `
                    SELECT 
                        conname as constraint_name,
                        contype as constraint_type,
                        conrelid::regclass as table_name
                    FROM pg_constraint 
                    WHERE connamespace = 'public'::regnamespace
                    ORDER BY table_name, constraint_name;
                `,
      });

      if (error) throw error;

      const constraints = (data ?? []) as ConstraintInfo[];
      console.log(`[DatabaseMonitor] 🔒 Contraintes: ${constraints.length} trouvées`);

      // Vérifier les contraintes manquantes
      const expectedConstraints = [{ table: 'facts', constraint: 'facts_chat_key_unique' }];

      for (const expected of expectedConstraints) {
        const hasConstraint = constraints.some(
          (c: ConstraintInfo) =>
            c.table_name === expected.table && c.constraint_name === expected.constraint,
        );

        if (!hasConstraint) {
          console.warn(
            `[DatabaseMonitor] ⚠️ Contrainte manquante: ${expected.constraint} sur ${expected.table}`,
          );
        }
      }
    } catch (error: unknown) {
      console.error('[DatabaseMonitor] Erreur contraintes:', extractErrorMessage(error));
    }
  }

  /**
   * Génère un rapport de santé
   */
  async generateHealthReport(): Promise<HealthReport> {
    const stats = await this.getDatabaseStats();
    const detailedStats = await this.getDetailedStats();

    const report: HealthReport = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTables: stats.tables.length,
        totalSize: stats.totalSizePretty,
        largestTable: stats.tables[0]?.tablename ?? 'N/A',
        largestSize: stats.tables[0]?.size_pretty ?? 'N/A',
      },
      tables: detailedStats.map((table: DetailedTableStats) => ({
        name: table.table_name,
        size: table.size,
        rows: table.row_count,
        lastInsert: table.last_insert,
      })),
      recommendations: await this.generateRecommendations(),
    };

    // Sauvegarder le rapport
    await this.saveHealthReport(report);

    console.log('[DatabaseMonitor] 📋 Rapport de santé généré');
    return report;
  }

  /**
   * Génère des recommandations basées sur l'analyse
   */
  async generateRecommendations(): Promise<HealthRecommendation[]> {
    const recommendations: HealthRecommendation[] = [];

    try {
      const stats = await this.getDatabaseStats();

      // Recommandation 1: Tables trop grosses
      for (const table of stats.tables) {
        if (table.size_bytes > this.thresholds.critical) {
          recommendations.push({
            type: 'size',
            priority: 'high',
            table: table.tablename,
            message: `Table ${table.tablename} dépasse 500MB (${table.size_pretty}). Consider cleanup.`,
            action: 'cleanup',
          });
        }
      }

      // Recommandation 2: Vérifier les tables sans index
      const { data: indexes } = await getSupabaseClient().rpc('exec_sql', {
        sql: `
                    SELECT table_name 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name NOT IN (
                        SELECT tablename 
                        FROM pg_indexes 
                        WHERE schemaname = 'public'
                    );
                `,
      });

      const indexlessTables = (indexes ?? []) as Array<{ table_name: string }>;
      if (indexlessTables.length > 0) {
        recommendations.push({
          type: 'performance',
          priority: 'medium',
          tables: indexlessTables.map((i: { table_name: string }) => i.table_name),
          message: 'Tables sans index détectées',
          action: 'add_indexes',
        });
      }
    } catch (error: unknown) {
      console.error('[DatabaseMonitor] Erreur recommandations:', extractErrorMessage(error));
    }

    return recommendations;
  }

  /**
   * Envoie une alerte critique
   */
  async sendCriticalAlert(tableName: string, size: number): Promise<void> {
    const alertKey = `critical_${tableName}`;

    if (this.alertedTables.has(alertKey)) return; // Déjà alerté

    const alert: Alert = {
      type: 'critical',
      table: tableName,
      size: this.formatBytes(size),
      message: `Table ${tableName} dépasse 500MB (${this.formatBytes(size)}) - Action immédiate requise`,
      timestamp: new Date().toISOString(),
    };

    console.error('[DatabaseMonitor] 🚨 ALERTE CRITIQUE:', alert);

    // Sauvegarder dans la DB
    await getSupabaseClient().from('system_alerts').insert({
      type: 'db_size_critical',
      severity: 'critical',
      message: alert.message,
      metadata: alert,
    });

    this.alertedTables.add(alertKey);

    // Notification (dans une vraie app, envoyer email/Slack ici)
    await this.sendNotification(alert);
  }

  /**
   * Envoie une alerte warning
   */
  async sendWarningAlert(tableName: string, size: number): Promise<void> {
    const alertKey = `warning_${tableName}`;

    if (this.alertedTables.has(alertKey)) return;

    const alert: Alert = {
      type: 'warning',
      table: tableName,
      size: this.formatBytes(size),
      message: `Table ${tableName} dépasse 100MB (${this.formatBytes(size)}) - Surveillance recommandée`,
      timestamp: new Date().toISOString(),
    };

    console.warn('[DatabaseMonitor] ⚠️ ALERTE WARNING:', alert);

    // Sauvegarder dans la DB
    await getSupabaseClient().from('system_alerts').insert({
      type: 'db_size_warning',
      severity: 'warning',
      message: alert.message,
      metadata: alert,
    });

    this.alertedTables.add(alertKey);
  }

  /**
   * Envoie une alerte de croissance
   */
  async sendGrowthAlert(tableName: string, growthRate: number): Promise<void> {
    const alert: Alert = {
      type: 'growth',
      table: tableName,
      growthRate: Math.round(growthRate * 100),
      message: `Table ${tableName} a une croissance de +${Math.round(growthRate * 100)}% sur 7 jours`,
      timestamp: new Date().toISOString(),
    };

    console.warn('[DatabaseMonitor] 📈 ALERTE CROISSANCE:', alert);

    await getSupabaseClient().from('system_alerts').insert({
      type: 'db_growth_warning',
      severity: 'warning',
      message: alert.message,
      metadata: alert,
    });
  }

  /**
   * Envoie une notification (placeholder pour intégration réelle)
   */
  async sendNotification(alert: Alert): Promise<void> {
    // Dans une vraie application, envoyer email/Slack/SMS ici
    console.log(`[DatabaseMonitor] 📧 Notification envoyée: ${alert.message}`);
  }

  /**
   * Sauvegarde le rapport de santé
   */
  async saveHealthReport(report: HealthReport): Promise<void> {
    try {
      await getSupabaseClient().from('db_health_reports').insert({
        timestamp: report.timestamp,
        report_data: report,
        summary: report.summary,
      });
    } catch (error: unknown) {
      console.error('[DatabaseMonitor] Erreur sauvegarde rapport:', extractErrorMessage(error));
    }
  }

  /**
   * Obtient la prochaine vérification quotidienne (6h du matin)
   */
  getNextDailyCheck(): number {
    const now = new Date();
    const next = new Date(now);
    next.setHours(6, 0, 0, 0);

    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next.getTime() - now.getTime();
  }

  /**
   * Formate les bytes en format lisible
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + (sizes.at(i) ?? 'B');
  }

  /**
   * Obtient le statut actuel du monitoring
   */
  getStatus(): MonitorStatus {
    return {
      active: this.monitoringActive,
      lastCheck: new Date().toISOString(),
      thresholds: this.thresholds,
      activeAlerts: this.alertedTables.size,
    };
  }
}

// Export singleton
export const databaseMonitor = new DatabaseMonitor();
export default databaseMonitor;
