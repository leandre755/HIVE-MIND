/**
 * Moteur d'en-têtes `x-api-key` : schéma d'authentification natif d'Anthropic.
 *
 * Reproduit exactement les en-têtes de `adapters/anthropic.ts` : la clé
 * transite par `x-api-key` (PAS d'en-tête `Authorization`), accompagnée de la
 * version de l'API Messages et du type de contenu JSON.
 */

import type { HeaderFamily } from '../types.js';

/**
 * Version de l'API Messages d'Anthropic — valeur en vigueur dans
 * `adapters/anthropic.ts`, reprise ici sans interpolation dynamique.
 */
const ANTHROPIC_API_VERSION = '2023-06-01';

/** Singleton du moteur, enregistré dans `../registry.ts`. */
export const xApiKeyHeaders = {
  name: 'x-api-key',

  /**
   * Construit les en-têtes HTTP de la requête.
   *
   * @param apiKey Clé API Anthropic résolue par le routeur.
   * @returns `{ x-api-key, anthropic-version, Content-Type }` — sans
   *   `Authorization`.
   */
  buildHeaders(apiKey: string): Record<string, string> {
    return {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
      'Content-Type': 'application/json',
    };
  },
} satisfies HeaderFamily;
