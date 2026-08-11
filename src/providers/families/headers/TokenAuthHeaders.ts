/**
 * Moteur d'en-têtes `standard-token` : schéma `Authorization: Token <clé>`.
 *
 * Reproduit l'empreinte exacte de `adapters/nlpcloud.ts` : NLP Cloud exige le
 * préfixe `Token` et non `Bearer`. Aucune fusion de `headers_extra` : le
 * consommateur actuel n'en déclare pas.
 */

import type { HeaderFamily } from '../types.js';

/** Singleton du moteur, enregistré dans `../registry.ts`. */
export const tokenAuthHeaders = {
  name: 'standard-token',

  /**
   * Construit les en-têtes HTTP de la requête.
   *
   * @param apiKey Clé API résolue par le routeur pour la famille courante.
   * @returns `{ Authorization: Token <clé>, Content-Type: application/json }`.
   */
  buildHeaders(apiKey: string): Record<string, string> {
    return {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    };
  },
} satisfies HeaderFamily;
