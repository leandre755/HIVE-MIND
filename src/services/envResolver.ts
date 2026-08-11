// services/envResolver.ts
// ============================================================================
// Module Unifié de Résolution des Variables d'Environnement
// ============================================================================
// Centralise TOUTE la logique de résolution .env pour éviter la fragmentation

interface EnvStats {
  hits: number;
  misses: number;
  warnings: string[];
}

/**
 * Service singleton pour résoudre les variables d'environnement
 * Supporte les formats :
 * - API providers: PROVIDER_KEY, PROVIDER_KEY_1, PROVIDER_KEY_2...
 * - no_key / NO_KEY disables a key slot explicitly
 */
function getEnvVar(key: string): string | undefined {
  if (Object.hasOwn(process.env, key)) {
    const val = Reflect.get(process.env, key);
    if (typeof val === 'string') return val;
  }
  return undefined;
}

function getCandidates(prefix: string, keyIndex: number | null): string[] {
  if (keyIndex === null || keyIndex === undefined) {
    return [prefix, ...Array.from({ length: 7 }, (_, index) => `${prefix}_${index + 1}`)];
  }
  if (Number(keyIndex) === 1) {
    return [`${prefix}_1`, prefix];
  }
  return [`${prefix}_${Number(keyIndex)}`];
}

export class EnvResolver {
  resolved: Map<string, string | null>;
  stats: EnvStats;

  constructor() {
    this.resolved = new Map<string, string | null>();
    this.stats = {
      hits: 0,
      misses: 0,
      warnings: [],
    };
  }

  private _resolveByVarName(cacheKey: string, varName: string): string | null {
    const mainValue = getEnvVar(varName);
    if (mainValue && !this._isDisabledKey(mainValue)) {
      this._cache(cacheKey, mainValue);
      return mainValue;
    }
    const indexedValue = getEnvVar(`${varName}_1`);
    if (indexedValue && !this._isDisabledKey(indexedValue)) {
      this._cache(cacheKey, indexedValue);
      return indexedValue;
    }
    return null;
  }

  /**
   * Résout une valeur depuis .env avec plusieurs stratégies
   * @param value - Valeur brute (peut être placeholder, variable, ou valeur directe)
   * @param [varName] - Nom de variable suggéré (ex: 'GEMINI_KEY')
   * @returns Valeur résolue ou null si introuvable
   */
  resolve(value: unknown, varName: string | null = null): string | null {
    if (!value || typeof value !== 'string' || this._isDisabledKey(value)) return null;

    const cacheKey = `${value}::${varName || ''}`;
    if (this.resolved.has(cacheKey)) {
      this.stats.hits++;
      return this.resolved.get(cacheKey) ?? null;
    }

    if (!this._isPlaceholder(value)) {
      this._cache(cacheKey, value);
      return value;
    }

    if (value.startsWith('${') && value.endsWith('}')) {
      const envKey = value.slice(2, -1);
      const envValue = getEnvVar(envKey);
      if (envValue && !this._isDisabledKey(envValue)) {
        this._cache(cacheKey, envValue);
        return envValue;
      }
    }

    if (varName) {
      const res = this._resolveByVarName(cacheKey, varName);
      if (res) return res;
    }

    this.stats.misses++;
    this._cache(cacheKey, null);
    return null;
  }

  /**
   * Résout une clé provider strictement depuis PROVIDER_KEY / PROVIDER_KEY_N.
   * N'utilise pas credentials.json ni les anciens alias legacy.
   */
  resolveProviderKey(providerName: string, keyIndex: number | null = null): string | null {
    const prefix = `${String(providerName).toUpperCase()}_KEY`;
    const candidates = getCandidates(prefix, keyIndex);

    for (const envName of candidates) {
      const value = getEnvVar(envName);
      if (value && !this._isDisabledKey(value)) {
        return value;
      }
    }

    return null;
  }

  /**
   * Retourne les indices des clés disponibles pour un fournisseur donné
   * @param providerName - Nom du provider (ex: 'GEMINI')
   * @returns Liste des indices
   */
  getAvailableKeysForProvider(providerName: string): number[] {
    const prefix = `${providerName.toUpperCase()}_KEY`;
    const indices: number[] = [];

    for (let i = 1; i <= 7; i++) {
      const envValue = getEnvVar(`${prefix}_${i}`);
      if (envValue && !this._isDisabledKey(envValue)) {
        indices.push(i);
      }
    }

    if (indices.length === 0) {
      const baseValue = getEnvVar(prefix);
      if (baseValue && !this._isDisabledKey(baseValue)) {
        indices.push(1);
      }
    }

    return indices;
  }

  private _isDisabledKey(value: unknown): boolean {
    return typeof value === 'string' && value.trim().toLowerCase() === 'no_key';
  }

  /**
   * Vérifie si une valeur est un placeholder
   */
  private _isPlaceholder(value: string): boolean {
    return (
      value.startsWith('${') ||
      value.startsWith('YOUR_') ||
      value === 'undefined' ||
      value === 'null'
    );
  }

  /**
   * Cache une résolution
   */
  private _cache(key: string, value: string | null): void {
    this.resolved.set(key, value);
  }

  /**
   * Efface le cache (utile pour tests ou rechargement config)
   */
  clearCache(): void {
    this.resolved.clear();
    console.log('[EnvResolver] Cache vidé');
  }

  /**
   * Retourne les statistiques d'utilisation
   */
  getStats(): EnvStats & { cacheSize: number; hitRate: number } {
    return {
      ...this.stats,
      cacheSize: this.resolved.size,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
    };
  }

  /**
   * Affiche un rapport de diagnostic
   */
  diagnose(): void {
    const stats = this.getStats();
    console.log('\n[EnvResolver] 📊 Diagnostic:');
    console.log(`  Cache: ${stats.cacheSize} entrées`);
    console.log(`  Hit Rate: ${(stats.hitRate * 100).toFixed(1)}%`);
    console.log(`  Hits: ${stats.hits}, Misses: ${stats.misses}`);

    if (stats.warnings.length > 0) {
      console.log(`\n  ⚠️ Warnings (${stats.warnings.length}):`);
      stats.warnings.slice(0, 5).forEach((w: string) => console.log(`    - ${w}`));
      if (stats.warnings.length > 5) {
        console.log(`    ... et ${stats.warnings.length - 5} autres`);
      }
    }
  }
}

// Export singleton
export const envResolver = new EnvResolver();
export default envResolver;
