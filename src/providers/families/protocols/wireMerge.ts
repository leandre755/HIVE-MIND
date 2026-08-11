/**
 * Fusion filtrée des `wireParams` dans un corps de requête (allowlist
 * fail-closed, règle 4).
 *
 * Partagé par les moteurs de dialectes (`OpenAICompatibleProtocol`,
 * `AnthropicCompatibleProtocol`) : les wireParams — produits par
 * `GenerationParams.toWireParams` ou déclarés dans le JSON — ont le dernier
 * mot sur le corps (arbitrage documenté du plan : un wireParam validé prime
 * sur toute option statique du moteur).
 *
 * INVARIANT : seules les clés de `allowlist` présentes dans `wireParams`
 * sont écrites ; aucune clé n'est supprimée ; le corps est muté en place
 * (contrat d'assemblage des moteurs). Les accès dynamiques passent par
 * `Object.hasOwn`/`Reflect` (convention sécurité du dépôt).
 */

/**
 * Fusionne dans `body` les clés autorisées de `wireParams`.
 *
 * @param body Corps de requête en cours d'assemblage (muté en place).
 * @param wireParams Paramètres filaires bruts (`undefined` si rien à faire).
 * @param allowlist Clés admises à la fusion, dans l'ordre de déclaration.
 */
export function mergeWireParams(
  body: Record<string, unknown>,
  wireParams: Record<string, unknown> | undefined,
  allowlist: readonly string[],
): void {
  if (wireParams === undefined) {
    return;
  }
  for (const key of allowlist) {
    if (Object.hasOwn(wireParams, key)) {
      const value = Reflect.get(wireParams, key) as unknown;
      if (value !== undefined) {
        Reflect.set(body, key, value);
      }
    }
  }
}
