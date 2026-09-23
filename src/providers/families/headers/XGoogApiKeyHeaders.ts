/**
 * Moteur d'en-têtes `x-goog-api-key` : schéma d'authentification natif de
 * l'API Google Gemini (AI Studio / `@google/genai`).
 *
 * La clé transite par `x-goog-api-key` (PAS d'en-tête `Authorization`, PAS de
 * paramètre `query key=` qui fuiterait dans les journaux de proxy).
 */

import type { HeaderFamily } from '../types.js';

/** Singleton du moteur, enregistré dans `../registry.ts`. */
export const xGoogApiKeyHeaders = {
  name: 'x-goog-api-key',

  /**
   * Construit les en-têtes HTTP de la requête.
   *
   * @param apiKey Clé API Gemini résolue par le routeur.
   * @returns `{ x-goog-api-key, Content-Type }` — sans `Authorization`.
   */
  buildHeaders(apiKey: string): Record<string, string> {
    return {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    };
  },
} satisfies HeaderFamily;
