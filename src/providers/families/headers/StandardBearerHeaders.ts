/**
 * Moteur d'en-têtes `standard-bearer` : schéma `Authorization: Bearer <clé>`.
 *
 * Factorise l'empreinte d'authentification majoritaire des adapters HTTP du
 * routeur (`openai`, `groq`, `openrouter`, `kimi`, …) et ajoute la fusion des
 * en-têtes supplémentaires déclarés côté configuration JSON
 * (`familles.<nom>.headers_extra` dans `src/config/models_config.json`).
 *
 * Consommateurs connus de la fusion :
 * - openrouter : `Accept`, `HTTP-Referer: https://hive-mind.app`,
 *   `X-OpenRouter-Title: HIVE-MIND Agent` (reproduction de l'objet `headers`
 *   de `adapters/openrouter.ts`).
 * - kimi : empreinte réduite `User-Agent: claude-code/1.0.0`,
 *   `X-Client-Name: claude-code` (reprise de `adapters/kimi.ts`).
 *
 * Arbitrage explicite (collision) : `Authorization` et `Content-Type` sont des
 * en-têtes réservés fixés par ce moteur. Toute redéfinition via
 * `headers_extra` lève une erreur plutôt que d'écraser silencieusement le
 * credential ou le type de contenu.
 */

import type { HeaderContext, HeaderFamily } from '../types.js';

/**
 * Noms d'en-têtes (en minuscules, la casse HTTP étant non significative) que
 * `headers_extra` n'a pas le droit de redéfinir.
 */
const RESERVED_HEADERS: readonly string[] = ['authorization', 'content-type'];

/**
 * Extrait et valide `familyConfig.headers_extra`.
 *
 * INVARIANT : la table retournée ne contient que des valeurs de type chaîne
 * non vide, et aucune clé homonyme d'un en-tête réservé.
 *
 * @param ctx Contexte optionnel transmis par le routeur.
 * @returns Table prête à fusionner ; vide si `headers_extra` est absent.
 * @throws {Error} Si `headers_extra` est présent mais n'est pas un objet
 *   `Record<string, string>`, contient une valeur non chaîne ou vide, ou
 *   redéfinit un en-tête réservé.
 */
function extractHeadersExtra(ctx?: HeaderContext): Record<string, string> {
  const raw: unknown = ctx?.familyConfig?.headers_extra;
  if (raw === undefined) return {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(
      '[standard-bearer] headers_extra invalide dans la configuration de la famille : ' +
        'un objet Record<string, string> est attendu.',
    );
  }
  const entries = Object.entries(raw);
  for (const [key, value] of entries) {
    if (RESERVED_HEADERS.includes(key.toLowerCase())) {
      throw new Error(
        `[standard-bearer] headers_extra redéfinit l'en-tête réservé "${key}" : ` +
          'Authorization et Content-Type sont fixés par le moteur.',
      );
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        `[standard-bearer] headers_extra["${key}"] invalide : chaîne non vide attendue.`,
      );
    }
  }
  return Object.fromEntries(entries);
}

/** Singleton du moteur, enregistré dans `../registry.ts`. */
export const standardBearerHeaders = {
  name: 'standard-bearer',

  /**
   * Construit les en-têtes HTTP de la requête.
   *
   * @param apiKey Clé API résolue par le routeur pour la famille courante.
   * @param ctx Contexte optionnel (`familyConfig` lu pour la fusion).
   * @returns `{ Authorization: Bearer <clé>, Content-Type: application/json }`
   *   fusionné avec `headers_extra` éventuel.
   */
  buildHeaders(apiKey: string, ctx?: HeaderContext): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extractHeadersExtra(ctx),
    };
  },
} satisfies HeaderFamily;
