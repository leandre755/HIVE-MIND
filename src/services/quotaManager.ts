// services/quotaManager.js

import { redis as redisClient } from './redisClient.js';
import { envResolver } from './envResolver.js';
import { safeReadFileSync } from '../utils/safeFs.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 200ms TTL — short enough to avoid stale counters during bursts, long enough to batch within a single routing cycle
const L0_CACHE_TTL_MS = 200;

interface ModelConfigItem {
  id?: string;
  quota?: QuotaLimits;
  types?: string[];
}

interface ProviderConfig {
  modeles?: ModelConfigItem[];
  models?: ModelConfigItem[];
}

interface ModelsConfig {
  familles?: Record<string, ProviderConfig>;
}

interface QuotaLimits {
  rpm?: number;
  tpm?: number;
  rpd?: number;
}

interface MarginConfig {
  rpm: number;
  tpm: number;
  rpd: number;
}

interface HealthResult {
  healthy: boolean;
  blocked: boolean;
  rpmUsed: number;
  rpmLimit: number;
  tpmUsed: number;
  tpmLimit: number;
  rpdUsed: number;
  rpdLimit: number;
  reason: string | null;
}

interface FamilyHealthResult {
  familyName: string;
  healthy: boolean;
}

interface ModelHealthEntry {
  modelId: string;
  healthy: boolean;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

class QuotaManager {
  private client: typeof redisClient;
  private quotas: Record<string, QuotaLimits>;
  private localRateLimit: Map<string, number>;
  private redisDownSince: number | null;
  /** Reverse map: modelId → providerName (populated from models_config.json) */
  private modelToProvider: Map<string, string>;
  /** L0 in-memory cache: redisKey → { value, expiresAt } */
  private _l0Cache: Map<string, { value: string | null; expiresAt: number }>;

  constructor() {
    this.client = redisClient;
    this.quotas = {};
    this.modelToProvider = new Map();
    this._l0Cache = new Map();
    this._loadConfig();

    // Mode dégradé : tracking local en cas de Redis down
    this.localRateLimit = new Map(); // chatId → lastRequestTime
    this.redisDownSince = null; // Timestamp de la panne Redis
  }

  private _loadConfig(): void {
    try {
      const configPath = join(__dirname, '..', 'config', 'models_config.json');
      const config = JSON.parse(safeReadFileSync(configPath, 'utf-8')) as ModelsConfig;

      // Flatten quotas: modelId -> quota + build reverse map modelId -> providerName
      this.quotas = {};
      this.modelToProvider = new Map();

      if (config.familles) {
        for (const [providerName, providerConfig] of Object.entries(config.familles)) {
          const allModels: ModelConfigItem[] = [
            ...(providerConfig.modeles || []),
            ...(providerConfig.models || []), // HuggingFace structure variant
          ];
          for (const model of allModels) {
            if (!model.id) continue;
            this.modelToProvider.set(model.id, providerName);
            if (model.quota) {
              this.quotas[model.id] = model.quota;
            }
          }
        }
      }
      // Chargement silencieux
    } catch (error: unknown) {
      console.warn('[QuotaManager] Impossible de charger les quotas:', extractErrorMessage(error));
    }
  }

  /**
   * Initialse le manager (compatibilité interface service)
   */
  async init(): Promise<void> {
    // Initialisé (silencieux)
  }

  // =========================================================================
  // L0 IN-MEMORY CACHE — avoids redundant Redis GETs within a routing cycle
  // =========================================================================

  /** Read from L0 cache. Returns undefined on miss (not null — null is a valid cached value). */
  private _l0Get(key: string): string | null | undefined {
    const entry = this._l0Cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._l0Cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Write to L0 cache with TTL. */
  private _l0Set(key: string, value: string | null): void {
    this._l0Cache.set(key, { value, expiresAt: Date.now() + L0_CACHE_TTL_MS });
    // Prevent unbounded growth: evict expired entries when cache is large
    if (this._l0Cache.size > 200) {
      const now = Date.now();
      for (const [k, entry] of this._l0Cache.entries()) {
        if (now > entry.expiresAt) this._l0Cache.delete(k);
      }
    }
  }

  /** Read a Redis key, checking L0 cache first. */
  private async _cachedGet(key: string): Promise<string | null> {
    const cached = this._l0Get(key);
    if (cached !== undefined) return cached;
    const value = await this.client.get(key);
    this._l0Set(key, value);
    return value;
  }

  /**
   * Enregistre l'utilisation d'un modèle après un appel réussi.
   * WHY: Keys include keyIndex so getModelHealth() reads the same keys we write.
   * @param {string} _provider - Nom du provider (pour compatibilité/logging, non utilisé)
   * @param {string} modelId - ID du modèle utilisé
   * @param {number} estimatedTokens - Estimation des tokens
   * @param {number} keyIndex - Index de la clé API utilisée (défaut: 1)
   */
  async recordUsage(
    _provider: string,
    modelId: string,
    estimatedTokens = 0,
    keyIndex = 1,
  ): Promise<void> {
    if (!this.client.isReady) return;
    if (!modelId) return;

    const date = new Date().toISOString().split('T')[0];

    // WHY: Keys MUST match the pattern used in getModelHealth() — `k${keyIndex}` segment
    // ensures per-key tracking for multi-key rotation (Smart Router V2).
    const quotaKeyRPM = `quota:${modelId}:k${keyIndex}:rpm`;
    const quotaKeyTPM = `quota:${modelId}:k${keyIndex}:tpm`;
    const quotaKeyRPD = `quota:${modelId}:k${keyIndex}:rpd:${date}`;

    try {
      const multi = this.client.multi();

      // RPM (Expire après 60s)
      multi.incr(quotaKeyRPM);
      multi.expire(quotaKeyRPM, 60);

      // TPM (Expire après 60s)
      if (estimatedTokens > 0) {
        multi.incrBy(quotaKeyTPM, estimatedTokens);
        multi.expire(quotaKeyTPM, 60);
      }

      // RPD (Expire après 48h)
      multi.incr(quotaKeyRPD);
      multi.expire(quotaKeyRPD, 48 * 3600);

      const results = await multi.exec();

      // L0 write-through : on peupler le L0 avec les valeurs AUTORITATIVES
      // retournées par `multi.exec()` (un tableau, une réponse par commande),
      // et non en redérivant depuis un L0 possiblement stale. Reconstruire
      // `parseInt(l0 || '0') + 1` jetait la valeur réelle de Redis : si Redis
      // était déjà à 10 (bursts concurrents) mais le L0 vide, le L0 retombait
      // à 1 → sous-comptage pendant le TTL L0 (2s) → faiblesse anti-429.
      //
      // Ordre des commandes du multi :
      //   [incr rpm, expire rpm, (incrBy tpm, expire tpm), incr rpd, expire rpd]
      // Les index LITTÉRAUX (0/2/4) sont volontaires : évitent l'accès par
      // variable (security/detect-object-injection) tout en restant exacts.
      if (Array.isArray(results)) {
        this._l0Set(quotaKeyRPM, String(results[0]));
        if (estimatedTokens > 0) {
          this._l0Set(quotaKeyTPM, String(results[2]));
          this._l0Set(quotaKeyRPD, String(results[4]));
        } else {
          this._l0Set(quotaKeyRPD, String(results[2]));
        }
      }
      // Si `multi.exec()` ne renvoie pas de tableau (mock/erreur), on NE touche
      // PAS au L0 : un L0 stale est préférable à un compteur reconstruit faux.
    } catch (error: unknown) {
      console.error('[QuotaManager] Erreur Redis:', error);
    }
  }

  /**
   * Vérifie si un modèle spécifique est disponible
   * @param {string} modelId - ID du modèle
   * @param {number} _estimatedCost - Coût estimé en tokens pour cette requête (non utilisé)
   * @returns {Promise<boolean>} - true si disponible, false sinon
   */
  async isModelAvailable(modelId: string, _estimatedCost = 0): Promise<boolean> {
    // ⚠️ FAIL CLOSED avec mode dégradé si Redis down
    if (!this.client.isReady) {
      console.warn('[QuotaManager] ⚠️ Redis indisponible - Mode dégradé actif (1 req/min max)');

      // Tracking de la durée de panne
      if (!this.redisDownSince) {
        this.redisDownSince = Date.now();
      }

      const downMinutes = (Date.now() - this.redisDownSince) / 60000;

      // Si Redis down > 5 minutes, c'est critique
      if (downMinutes > 5) {
        console.error('[QuotaManager] 🚨 Redis down depuis > 5 min - BLOCAGE TOTAL');
        return false; // Fail CLOSED total
      }

      // Mode dégradé : 1 requête par minute par modèle (très conservateur)
      return this._allowWithLocalRateLimit(modelId);
    }

    // Redis OK - reset le tracker de panne
    this.redisDownSince = null;

    if (!modelId) return true;

    if (!Object.hasOwn(this.quotas, modelId) || !Reflect.get(this.quotas, modelId)) return true; // Pas de quota défini = illimité

    // WHY: Parallel fetch — all keys are tested in a single Redis RTT batch.
    // The first healthy key in original order wins (index 1 remains priority).
    // L0 cache (2s TTL) absorbs redundancy when k1 is frequently healthy.
    const providerName = this.modelToProvider.get(modelId);
    const indices = providerName ? envResolver.getAvailableKeysForProvider(providerName) : [1];
    const keyIndices = indices.length > 0 ? indices : [1];

    const results = await Promise.all(
      keyIndices.map((keyIndex) =>
        this.getModelHealth(modelId, { rpm: 0.2, tpm: 0.1, rpd: 0.05 }, keyIndex),
      ),
    );
    return results.some((h) => h.healthy);
  }

  /**
   * Recherche la première clé saine (avec marges) pour un modèle donné.
   * @param {string} modelId - ID du modèle
   * @param {string} providerName - Nom du fournisseur (pour résoudre les clés existantes)
   * @param {MarginConfig} margins - Marges de sécurité { rpm: 0.2, tpm: 0.1, rpd: 0.05 }
   * @returns {Promise<number|null>} - Index de la clé saine, ou null si aucune clé n'est dispo
   */
  async getAvailableKeyForModel(
    modelId: string,
    providerName: string,
    margins: MarginConfig = { rpm: 0.2, tpm: 0.1, rpd: 0.05 },
  ): Promise<number | null> {
    // FAIL-CLOSED : Redis indisponible ⇒ aucune clé ne peut être validée. On
    // retourne null (le routeur saute le modèle via _selectKeyIndex) plutôt
    // que d'émettre une requête non protégée (risque de tempête de 429).
    if (!this.client.isReady) return null;

    const availableIndices = envResolver.getAvailableKeysForProvider(providerName);

    if (!availableIndices || availableIndices.length === 0) {
      // Aucune clé configurée : tenter l'adaptateur utiliserait getApiKey()===''
      // et échouerait. Skip proactif anti-429.
      return null;
    }

    // WHY: Parallel fetch — all key health checks run in a single Redis RTT batch.
    // We then pick the first healthy index in original order (index 1 remains priority).
    // This eliminates N×RTT sequential cost when k1 is blocked (quota exceeded).
    const healthResults = await Promise.all(
      availableIndices.map((index) =>
        this.getModelHealth(modelId, margins, index).then((h) => ({ index, healthy: h.healthy })),
      ),
    );

    const firstHealthy = healthResults.find((r) => r.healthy);
    if (firstHealthy) return firstHealthy.index;

    // Toutes les clés connues pour ce modèle ont dépassé leur quota.
    console.warn(
      `[QuotaManager] 🚨 Toutes les clés de ${providerName} sont épuisées pour le modèle ${modelId} !`,
    );
    return null;
  }

  /**
   * Bloque temporairement un modèle suite à une erreur de quota (429)
   * @param {string} modelId - ID du modèle
   * @param {number} timeoutSeconds - Durée du blocage en secondes
   * @param {number} keyIndex - Index de la clé utilisée (défaut: 1)
   */
  async recordQuotaExceeded(modelId: string, timeoutSeconds = 60, keyIndex = 1): Promise<void> {
    if (!modelId) return;

    const blockKey = `quota:${modelId}:k${keyIndex}:blocked`;

    // L0 write-through FIRST: ensures the next getAvailableKeyForModel()
    // within the same routing cycle won't re-select this blocked key,
    // even if the Redis write hasn't propagated yet.
    this._l0Set(blockKey, '1');

    if (!this.client.isReady) return;

    try {
      await this.client.setEx(blockKey, timeoutSeconds, '1');
      console.log(
        `[QuotaManager] 🥶 Modèle ${modelId} (Clé ${keyIndex}) mis au frigo pour ${timeoutSeconds}s (Quota Exceeded)`,
      );
    } catch (error: unknown) {
      console.error('[QuotaManager] Erreur recordQuotaExceeded:', error);
    }
  }

  // =========================================================================
  // ZERO-429 PROACTIVE HEALTH CHECK SYSTEM
  // =========================================================================

  /**
   * Récupère l'état de santé détaillé d'un modèle avec marges de sécurité
   * @param {string} modelId - ID du modèle
   * @param {MarginConfig} margins - Marges de sécurité { rpm: 0.2, tpm: 0.1, rpd: 0.05 }
   * @param {number} keyIndex - Index de la clé utilisée (défaut: 1)
   * @returns {Promise<HealthResult>}
   */
  async getModelHealth(
    modelId: string,
    margins: MarginConfig = { rpm: 0.2, tpm: 0.1, rpd: 0.05 },
    keyIndex = 1,
  ): Promise<HealthResult> {
    const result: HealthResult = {
      healthy: true,
      blocked: false,
      rpmUsed: 0,
      rpmLimit: Infinity,
      tpmUsed: 0,
      tpmLimit: Infinity,
      rpdUsed: 0,
      rpdLimit: Infinity,
      reason: null,
    };

    // FAIL-CLOSED : Redis indisponible ⇒ aucun modèle ne peut être validé
    // comme sain. Cohérent avec isModelAvailable (fail-closed) et
    // getAvailableKeyForModel (fail-closed) : une panne infra ne doit pas être
    // convertie en requêtes non protégées (tempête de 429).
    if (!this.client.isReady) {
      result.healthy = false;
      result.reason = 'REDIS INACCESSIBLE (fail-closed)';
      return result;
    }
    if (!modelId) return result;

    const date = new Date().toISOString().split('T')[0];
    const blockKey = `quota:${modelId}:k${keyIndex}:blocked`;

    try {
      // 1. Vérifier blocage explicite (Circuit Breaker) — L0 cache-aware
      const isBlocked = await this._cachedGet(blockKey);
      if (isBlocked) {
        result.healthy = false;
        result.blocked = true;
        result.reason = 'BLOCKED (429 antérieur)';
        return result;
      }

      // 2. Si pas de quota défini, le modèle est illimité/sain
      const modelQuota = Object.hasOwn(this.quotas, modelId)
        ? (Reflect.get(this.quotas, modelId) as QuotaLimits)
        : null;
      if (!modelQuota) {
        return result;
      }

      const limits = modelQuota;
      result.rpmLimit = limits.rpm || Infinity;
      result.tpmLimit = limits.tpm || Infinity;
      result.rpdLimit = limits.rpd || Infinity;

      const keyRPM = `quota:${modelId}:k${keyIndex}:rpm`;
      const keyTPM = `quota:${modelId}:k${keyIndex}:tpm`;
      const keyRPD = `quota:${modelId}:k${keyIndex}:rpd:${date}`;

      // L0 cache-aware reads: avoids redundant Redis GETs within a single routing cycle
      const [rpm, tpm, rpd] = await Promise.all([
        this._cachedGet(keyRPM),
        this._cachedGet(keyTPM),
        this._cachedGet(keyRPD),
      ]);

      result.rpmUsed = parseInt(rpm || '0');
      result.tpmUsed = parseInt(tpm || '0');
      result.rpdUsed = parseInt(rpd || '0');

      // 3. Vérification avec MARGES DE SÉCURITÉ
      // RPM: Marge par défaut 20% (ne pas dépasser 80% de la limite)
      const rpmThreshold = Math.floor(result.rpmLimit * (1 - margins.rpm));
      if (limits.rpm && result.rpmUsed >= rpmThreshold) {
        result.healthy = false;
        result.reason = `RPM proche limite (${result.rpmUsed}/${result.rpmLimit}, seuil=${rpmThreshold})`;
        return result;
      }

      // TPM: Marge par défaut 10% (ne pas dépasser 90% de la limite)
      const tpmThreshold = Math.floor(result.tpmLimit * (1 - margins.tpm));
      if (limits.tpm && result.tpmUsed >= tpmThreshold) {
        result.healthy = false;
        result.reason = `TPM proche limite (${result.tpmUsed}/${result.tpmLimit}, seuil=${tpmThreshold})`;
        return result;
      }

      // RPD: Marge par défaut 5% (ne pas dépasser 95% de la limite)
      const rpdThreshold = Math.floor(result.rpdLimit * (1 - margins.rpd));
      if (limits.rpd && result.rpdUsed >= rpdThreshold) {
        result.healthy = false;
        result.reason = `RPD proche limite (${result.rpdUsed}/${result.rpdLimit}, seuil=${rpdThreshold})`;
        return result;
      }

      return result;
    } catch (error: unknown) {
      console.error('[QuotaManager] Erreur getModelHealth %s:', modelId, error);
      // FAIL-CLOSED : une erreur de lecture Redis rend le quota inconnu ⇒ on ne
      // déclare pas le modèle sain (ne pas émettre de requête non protégée).
      result.healthy = false;
      result.reason = 'REDIS READ ERROR (fail-closed)';
      return result;
    }
  }

  /**
   * Filtre une liste de modèles pour ne garder que ceux "sains" (avec marge de sécurité)
   * @param {Array<string>} modelIds - Liste des IDs de modèles
   * @param {MarginConfig} margins - Marges de sécurité { rpm: 0.2, tpm: 0.1, rpd: 0.05 }
   * @returns {Promise<Array<string>>} - Liste filtrée des IDs sains
   */
  async filterHealthyModels(
    modelIds: Array<string>,
    margins: MarginConfig = { rpm: 0.2, tpm: 0.1, rpd: 0.05 },
  ): Promise<Array<string>> {
    // FAIL-CLOSED : Redis indisponible ⇒ aucun modèle ne peut être validé sain.
    if (!this.client.isReady) return [];

    const results = await Promise.all(
      modelIds.map(async (modelId: string) => {
        // WHY: Check ALL keys for this model's provider, not just k1.
        // A model is healthy if at least one key passes the health check.
        const providerName = this.modelToProvider.get(modelId);
        const indices = providerName ? envResolver.getAvailableKeysForProvider(providerName) : [1];
        const keyIndices = indices.length > 0 ? indices : [1];

        const keyHealths = await Promise.all(
          keyIndices.map((keyIndex: number) => this.getModelHealth(modelId, margins, keyIndex)),
        );
        const isHealthy = keyHealths.some((h: HealthResult) => h.healthy);
        return { modelId, healthy: isHealthy };
      }),
    );

    return results
      .filter((r: ModelHealthEntry) => r.healthy)
      .map((r: ModelHealthEntry) => r.modelId);
  }

  /**
   * Récupère les familles qui ont au moins un modèle sain
   * @param {Record<string, ProviderConfig>} familiesConfig - Configuration des familles
   * @param {MarginConfig} margins - Marges de sécurité
   * @returns {Promise<Array<string>>} - Liste des noms de familles saines
   */
  async getHealthyFamilies(
    familiesConfig: Record<string, ProviderConfig>,
    margins: MarginConfig = { rpm: 0.2, tpm: 0.1, rpd: 0.05 },
  ): Promise<Array<string>> {
    const familyResults = await Promise.all(
      Object.entries(familiesConfig).map(
        async ([familyName, familyConfig]: [string, ProviderConfig]) => {
          const models: ModelConfigItem[] = familyConfig.modeles || familyConfig.models || [];
          // Exclure les modèles d'embedding du check chat
          const chatModels = models
            .filter(
              (m: ModelConfigItem) =>
                !m.id?.includes('embedding') && !m.types?.includes('embedding'),
            )
            .map((m: ModelConfigItem) => m.id)
            .filter((id): id is string => id !== undefined);

          if (chatModels.length === 0) return { familyName, healthy: false };

          const healthyModels = await this.filterHealthyModels(chatModels, margins);
          return { familyName, healthy: healthyModels.length > 0 };
        },
      ),
    );

    return familyResults
      .filter((r: FamilyHealthResult) => r.healthy)
      .map((r: FamilyHealthResult) => r.familyName);
  }

  /**
   * Mode dégradé : Rate limiting local si Redis down
   * Limite stricte : 1 requête par minute par modèle
   * @param {string} modelId - ID du modèle
   * @returns {boolean} - true si autorisé
   */
  private _allowWithLocalRateLimit(modelId: string): boolean {
    const key = `local:${modelId}`;
    const lastSeen = this.localRateLimit.get(key);
    const now = Date.now();

    // Limite : 60 secondes entre chaque requête
    if (lastSeen && now - lastSeen < 60000) {
      const waitTime = Math.ceil((60000 - (now - lastSeen)) / 1000);
      console.log(`[QuotaManager] ❄️ Mode dégradé: ${modelId} doit attendre ${waitTime}s`);
      return false;
    }

    // Autoriser et enregistrer
    this.localRateLimit.set(key, now);

    // Cleanup : supprimer les entrées > 5 minutes (éviter memory leak)
    if (this.localRateLimit.size > 100) {
      for (const [k, timestamp] of this.localRateLimit.entries()) {
        if (now - timestamp > 300000) {
          // 5 min
          this.localRateLimit.delete(k);
        }
      }
    }

    return true;
  }
}

export const quotaManager = new QuotaManager();
