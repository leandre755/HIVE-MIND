/**
 * Moteur d'en-têtes `claude-code` : signature Stainless complète.
 *
 * ATTENTION — cible du plan, pas factorisation d'existant : aucun adapter
 * actuel n'émet cette empreinte. Ce moteur matérialise la capacité prévue par
 * le plan de regroupement des familles de s'identifier comme le CLI officiel
 * `claude-cli` auprès de l'API Anthropic (en-têtes d'instrumentation du SDK
 * Stainless : `x-app`, `X-Stainless-*`).
 *
 * La famille `kimi` conserve en parallèle son empreinte réduite
 * (`User-Agent: claude-code/1.0.0`, `X-Client-Name: claude-code`, cf.
 * `adapters/kimi.ts`) : elle est portée par `headers_extra` déclaré côté JSON
 * (`src/config/models_config.json`) et fusionné par le moteur
 * `standard-bearer` — en aucun cas par ce moteur-ci.
 *
 * Paramétrage via le contexte (`ctx.options`, transmis par le routeur) :
 * - `version` : version du CLI annoncée dans `User-Agent` et
 *   `X-Stainless-Package-Version` (repli `1.0.0` si absente ou non chaîne) ;
 * - `anthropic_beta` : tableau de chaînes joint par `,` dans l'en-tête
 *   `anthropic-beta` (omis si absent ou vide).
 *
 * Les autres valeurs (`X-Stainless-OS`, `X-Stainless-Arch`,
 * `X-Stainless-Runtime-Version`) sont lues depuis `process` au moment de
 * l'appel, comme le ferait le SDK officiel exécuté en local.
 */

import type { HeaderContext, HeaderFamily } from '../types.js';

/** Version annoncée quand `options['version']` ne fournit pas de chaîne. */
const DEFAULT_CLI_VERSION = '1.0.0';

/**
 * Version de l'API Messages d'Anthropic — alignée sur
 * `adapters/anthropic.ts`, reprise ici sans interpolation dynamique.
 */
const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * Lit la version du CLI depuis le contexte.
 *
 * @param ctx Contexte optionnel transmis par le routeur.
 * @returns `ctx.options['version']` si c'est une chaîne non vide, sinon le
 *   repli `DEFAULT_CLI_VERSION`.
 */
function readCliVersion(ctx?: HeaderContext): string {
  const raw: unknown = ctx?.options?.['version'];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return DEFAULT_CLI_VERSION;
}

/**
 * Lit et valide le tableau `anthropic_beta` du contexte.
 *
 * @param ctx Contexte optionnel transmis par le routeur.
 * @returns Les flags joints par `,`, ou `null` si l'option est absente ou est
 *   un tableau vide (l'en-tête `anthropic-beta` est alors omis).
 * @throws {Error} Si une entrée du tableau n'est pas une chaîne non vide.
 */
function readBetaFlags(ctx?: HeaderContext): string | null {
  const raw: unknown = ctx?.options?.['anthropic_beta'];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(
        '[claude-code] Option anthropic_beta invalide : toutes les entrées ' +
          'doivent être des chaînes non vides.',
      );
    }
  }
  return raw.join(',');
}

/** Singleton du moteur, enregistré dans `../registry.ts`. */
export const claudeCodeHeaders = {
  name: 'claude-code',

  /**
   * Construit la signature Stainless complète de la requête.
   *
   * @param apiKey Clé API Anthropic résolue par le routeur (OAuth ou clé
   *   classique, portée par un en-tête `Authorization: Bearer`).
   * @param ctx Contexte optionnel (`options['version']`,
   *   `options['anthropic_beta']`).
   * @returns En-têtes fixes de la signature, augmentés de `anthropic-beta`
   *   uniquement si des flags ont été fournis.
   */
  buildHeaders(apiKey: string, ctx?: HeaderContext): Record<string, string> {
    const version = readCliVersion(ctx);
    const beta = readBetaFlags(ctx);
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': `claude-cli/${version} (external, cli)`,
      'x-app': 'cli',
      'X-Stainless-Lang': 'js',
      'X-Stainless-Package-Version': version,
      'X-Stainless-OS': process.platform,
      'X-Stainless-Arch': process.arch,
      'X-Stainless-Runtime': 'node',
      'X-Stainless-Runtime-Version': process.version,
      'anthropic-version': ANTHROPIC_API_VERSION,
      ...(beta === null ? {} : { 'anthropic-beta': beta }),
    };
  },
} satisfies HeaderFamily;
