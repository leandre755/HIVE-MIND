/**
 * utils/dnsHelpers.ts
 * Helpers DNS pour résolution ciblée des problèmes de connectivité
 */

import dns from 'dns';
import http from 'http';
import https from 'https';

export interface IPv4Agents {
  http: http.Agent;
  https: https.Agent;
}

export interface DNSConfig {
  family: number;
  lookup?: (
    hostname: string,
    options: unknown,
    callback: (err: Error | null, address: string, family: number) => void,
  ) => void;
}

/**
 * Force IPv4 pour une URL spécifique (ciblée, pas globale)
 * Utilisé pour résoudre les problèmes avec Kimi/Cloudflare sous Node 17+
 */
export function forceIPv4ForUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;

  const IPV4_REQUIRED_DOMAINS = [
    'kimi.moonshot.cn',
    'api.moonshot.cn',
    'cloudflare.com',
    'workers.dev',
  ];

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    const needsIPv4 = IPV4_REQUIRED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith('.' + domain),
    );

    if (needsIPv4) {
      console.log(`[DNS] 🔧 IPv4 forcing activé pour: ${hostname}`);
      return true;
    }

    return false;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn('[DNS] ⚠️ Erreur parsing URL %s:', url, err.message);
    return false;
  }
}

/**
 * Crée un agent HTTP avec IPv4 forcing pour les requêtes spécifiques
 */
export async function createIPv4Agent(): Promise<IPv4Agents> {
  return {
    http: new http.Agent({
      family: 4, // Force IPv4
      keepAlive: true,
      timeout: 30000,
    }),
    https: new https.Agent({
      family: 4, // Force IPv4
      keepAlive: true,
      timeout: 30000,
    }),
  };
}

/**
 * Configuration DNS ciblée pour les providers problématiques
 */
export function getDNSConfig(providerName: string): DNSConfig | null {
  const dnsConfigs: Record<string, DNSConfig> = {
    kimi: {
      family: 4,
      lookup: (hostname, _options, callback) => {
        dns.lookup(hostname, { family: 4 }, callback);
      },
    },
    moonshot: {
      family: 4,
    },
  };

  return (Reflect.get(dnsConfigs, providerName) as DNSConfig | undefined) || null;
}

/**
 * Vérifie si une erreur de réseau pourrait être résolue par IPv4 forcing
 */
export function shouldTryIPv4Fallback(error: unknown, url: string): boolean {
  if (!error || !url) return false;

  const errorMessages = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'fetch failed', 'network error'];

  const errorStr = String(error).toLowerCase();
  const isNetworkError = errorMessages.some((msg) => errorStr.includes(msg.toLowerCase()));

  if (isNetworkError) {
    console.log(`[DNS] 🔄 IPv4 fallback suggéré pour: ${url}`);
    return forceIPv4ForUrl(url);
  }

  return false;
}

async function attemptIPv4Fallback(
  url: string,
  options: RequestInit & { agent?: http.Agent | https.Agent },
): Promise<Response | null> {
  console.log(`[DNS] 🔄 Tentative IPv4 fallback pour: ${url}`);
  try {
    const agents = await createIPv4Agent();
    const ipv4Options = {
      ...options,
      agent: url.startsWith('https:') ? agents.https : agents.http,
    };
    return await fetch(url, ipv4Options);
  } catch (ipv4Error) {
    const err = ipv4Error instanceof Error ? ipv4Error : new Error(String(ipv4Error));
    console.warn('[DNS] ❌ IPv4 fallback a échoué:', err.message);
    return null;
  }
}

/**
 * Wrapper fetch avec retry et IPv4 fallback intelligent
 */
export async function fetchWithIPv4Fallback(
  url: string,
  options: RequestInit & { agent?: http.Agent | https.Agent } = {},
  maxRetries = 2,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Tentative normale
      return await fetch(url, options);
    } catch (error) {
      lastError = error;

      // Dernière tentative: IPv4 forcing
      if (attempt === maxRetries - 1 && shouldTryIPv4Fallback(error, url)) {
        const fallbackRes = await attemptIPv4Fallback(url, options);
        if (fallbackRes) return fallbackRes;
      }

      if (attempt < maxRetries - 1) {
        const delayMs = Math.pow(2, attempt) * 1000;
        console.log(`[DNS] ⏳ Retry dans ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

export default {
  forceIPv4ForUrl,
  createIPv4Agent,
  getDNSConfig,
  shouldTryIPv4Fallback,
  fetchWithIPv4Fallback,
};
