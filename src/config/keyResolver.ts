import { envResolver } from '../services/envResolver.js';

/**
 * Résout une valeur de credential depuis .env si c'est un placeholder
 */
export function resolveApiKey(credentialValue: string, providerName?: string): string | null {
  const resolvedValue = envResolver.resolve(credentialValue);
  if (resolvedValue !== null) {
    return resolvedValue;
  }

  const inferredProvider = providerName || inferProviderName(credentialValue);
  if (!inferredProvider) {
    return null;
  }

  return envResolver.resolveProviderKey(inferredProvider);
}

function inferProviderName(credentialValue: string): string | null {
  const strVal = String(credentialValue || '');
  if (!strVal.startsWith('${') || !strVal.endsWith('}')) {
    return null;
  }
  const envName = strVal.slice(2, -1).toUpperCase();
  const keyIdx = envName.indexOf('_KEY');
  if (keyIdx === -1) {
    return null;
  }

  return envName.slice(0, keyIdx).toLowerCase();
}

/**
 * Résout un objet credentials complet (notamment les familles_ia)
 */
export function resolveCredentials(credentials: Record<string, unknown>): Record<string, unknown> {
  if (!credentials) return {};
  const resolved = { ...credentials };

  if (resolved.familles_ia && typeof resolved.familles_ia === 'object') {
    const familles = { ...(resolved.familles_ia as Record<string, unknown>) };
    resolved.familles_ia = familles;
    for (const [family, key] of Object.entries(familles)) {
      if (typeof key === 'string') {
        Reflect.set(familles, family, resolveApiKey(key, family));
      }
    }
  }

  return resolved;
}
