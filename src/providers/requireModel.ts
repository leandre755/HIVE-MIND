/**
 * Garde d'identifiant de modèle partagé par les adapters.
 *
 * Les adapters ne déclarent aucun identifiant de modèle : la liste fait foi
 * dans `src/config/models_config.json` (`familles.<nom>.modeles[].id`), et le
 * routeur la résout avant l'appel. `ProviderRouter.chat()` n'invoque
 * `adapter.chat` qu'à l'intérieur de `for (const model of modelsToTry)`
 * (`src/providers/index.ts`), où `modelsToTry` vaut soit `[options.model]`,
 * soit les `id` lus dans la configuration de la famille : `options.model` est
 * donc toujours renseigné sur ce chemin.
 *
 * Ce garde couvre le chemin restant — un appel direct à un adapter, hors
 * routeur. Il échoue de façon fermée et nommée plutôt que d'émettre une
 * requête portant un modèle de repli inventé, qui produirait soit une erreur
 * 400 distante illisible, soit une facturation sur un modèle non voulu.
 *
 * Module autonome : aucun import depuis `./index.ts` (éviterait un cycle).
 */

/**
 * Retourne l'identifiant de modèle fourni par le routeur.
 *
 * INVARIANT : la valeur retournée est une chaîne non vide et non composée
 * uniquement d'espaces. Tout autre cas lève une erreur.
 *
 * @param model Valeur de `options.model` transmise à l'adapter.
 * @param adapterName Nom de l'adapter, pour situer l'erreur.
 * @throws {Error} Si `model` est absent, vide ou uniquement composé d'espaces.
 */
export function requireModel(model: string | undefined, adapterName: string): string {
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new Error(
      `[${adapterName}] Aucun modèle fourni. L'identifiant doit provenir de ` +
        `models_config.json via le routeur (options.model), jamais d'un défaut local.`,
    );
  }
  return model;
}

/**
 * Même garde, pour un réglage de rendu non modèle également piloté par la
 * configuration — typiquement un identifiant de voix TTS
 * (`voice_provider.tts_models[].voice` / `.voice_id`).
 *
 * INVARIANT : la valeur retournée est une chaîne non vide et non composée
 * uniquement d'espaces. Tout autre cas lève une erreur.
 *
 * @param value Valeur transmise à l'adapter dans ses options.
 * @param optionName Nom de l'option, tel qu'écrit dans la configuration.
 * @param adapterName Nom de l'adapter, pour situer l'erreur.
 * @throws {Error} Si `value` est absente, vide ou uniquement composée d'espaces.
 */
export function requireOption(
  value: string | undefined,
  optionName: string,
  adapterName: string,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `[${adapterName}] Option "${optionName}" absente. La valeur doit provenir de ` +
        `models_config.json (voice_provider), jamais d'un défaut local.`,
    );
  }
  return value;
}
