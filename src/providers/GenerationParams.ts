/**
 * Système unifié de paramètres de génération (plan v3, Step 2).
 *
 * Module séparé unique : normalisation (`GenerationParams`), capacités
 * déclaratives par famille/modèle (`ModelCapabilities`, clé `capacites` de
 * `models_config.json`), validation fail-closed (`validateParams`) et
 * traduction filaire indexée par dialecte de protocole (`toWireParams`).
 *
 * Distinction d'architecture : `reglages_generaux.model_capabilities` de
 * `models_config.json` est une clé morte (jamais lue par le code) — ce module
 * est le SEUL canal actif et lit uniquement `familles.<x>.capacites` et la
 * surcharge `familles.<x>.modeles[i].capacites`.
 *
 * Précédence KKT : `effectiveMaxTokens` est la valeur de `max_tokens`
 * APRÈS bridage budgétaire (`_applyBudgetThrottling` du routeur). Le bridage
 * gagne toujours : un budget de raisonnement est rejeté s'il n'est pas
 * strictement inférieur à cette borne effective (sinon l'API Anthropic
 * répondrait 400 en production).
 *
 * Arbitrage des canaux (documenté dans le plan, Step « Mitigations ») :
 * les valeurs produites par `toWireParams` ont préséance sur les options
 * statiques des déclarations JSON (`protocol_options.extra_body` etc.) —
 * les moteurs de protocole fusionnent les wireParams EN DERNIER.
 *
 * Consommation (Step 4 du plan) :
 * - `openai-compatible` : champs plats du body ChatCompletions
 *   (`max_tokens` ou `max_completion_tokens`, `temperature`,
 *   `reasoning_effort`).
 * - `anthropic-compatible` : champs plats du body Messages
 *   (`max_tokens`, `temperature`, `thinking`).
 * - `gemini-native` : champs plats aux NOMS GEMINI (`maxOutputTokens`,
 *   `thinkingConfig`, `temperature`) destinés à être posés tels quels dans
 *   l'objet `generationConfig` par le natif `gemini.ts`.
 */

import type { ChatMessage } from './types.js';

/** Erreur de validation des paramètres de génération (fail-closed). */
export class GenerationParamsError extends Error {
  constructor(message: string) {
    super(`GenerationParams: ${message}`);
    this.name = 'GenerationParamsError';
  }
}

/** Kind de raisonnement supporté par un modèle. */
export type ThinkingKind = 'anthropic-budget' | 'openai-effort' | 'gemini-budget' | 'none';

/** Paramètres de raisonnement demandés par l'appelant. */
export interface ThinkingParams {
  mode: 'off' | 'budget' | 'effort';
  /** Budget de jetons de raisonnement (modes Anthropic/Gemini). */
  budgetTokens?: number;
  /** Intensité de raisonnement (mode OpenAI o-series/gpt-5). */
  effort?: 'low' | 'medium' | 'high';
}

/** Paramètres de génération normalisés, indépendants du dialecte. */
export interface GenerationParams {
  thinking?: ThinkingParams;
  maxTokens?: number;
  temperature?: number;
  promptCaching?: boolean;
}

/** Champ filaire portant le plafond de jetons de sortie. */
export type MaxTokensField = 'max_tokens' | 'max_completion_tokens' | 'maxOutputTokens';

/** Capacités de génération d'un modèle, résolues depuis la déclaration JSON. */
export interface ModelCapabilities {
  thinking: ThinkingKind;
  promptCaching: boolean;
  /** Bornes inclusives, ou 'unsupported' si le paramètre est rejeté par l'API. */
  temperatureRange: [number, number] | 'unsupported';
  maxTokensField: MaxTokensField;
  /** Vrai quand le dialecte exige un plafond de jetons dans chaque requête. */
  maxTokensRequired: boolean;
}

/** Dialecte de protocole adressable par la traduction filaire. */
export type ProtocolDialect = 'openai-compatible' | 'anthropic-compatible' | 'gemini-native';

const THINKING_KINDS: readonly ThinkingKind[] = [
  'anthropic-budget',
  'openai-effort',
  'gemini-budget',
  'none',
];

const DIALECTS: readonly ProtocolDialect[] = [
  'openai-compatible',
  'anthropic-compatible',
  'gemini-native',
];

const MAX_TOKENS_FIELDS: readonly MaxTokensField[] = [
  'max_tokens',
  'max_completion_tokens',
  'maxOutputTokens',
];

const EFFORTS: readonly string[] = ['low', 'medium', 'high'];

/**
 * Familles natives sans champ `protocol_family` dans le JSON : leur dialecte
 * est connu du code. Table fail-closed — toute autre famille non déclarée
 * est rejetée (codex, antigravity : hors périmètre déclaré du plan).
 */
const NATIVE_DIALECTS: Readonly<Record<string, ProtocolDialect>> = {
  anthropic: 'anthropic-compatible',
  openai: 'openai-compatible',
  gemini: 'gemini-native',
};

/**
 * Profil fail-closed appliqué quand aucune clé `capacites` n'est déclarée :
 * aucune capacité avancée, bornes de température standard, champ filaire
 * historique `max_tokens` non obligatoire.
 */
const CAPABILITIES_NONE: ModelCapabilities = {
  thinking: 'none',
  promptCaching: false,
  temperatureRange: [0, 2],
  maxTokensField: 'max_tokens',
  maxTokensRequired: false,
};

/** Clés admises dans un objet `capacites` JSON (snake_case côté fichier). */
const CAPACITES_KEYS: readonly string[] = [
  'thinking',
  'prompt_caching',
  'temperature_range',
  'max_tokens_field',
  'max_tokens_required',
];

/**
 * Valide qu'une valeur brute est un objet simple non nul.
 *
 * @param value Valeur brute issue du JSON.
 * @param owner Chemin JSON cité dans l'erreur (ex. `familles.anthropic`).
 * @returns Le record validé.
 * @throws {GenerationParamsError} Si la valeur n'est pas un objet simple.
 */
function assertRecord(value: unknown, owner: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GenerationParamsError(
      `"${owner}" doit être un objet JSON simple (reçu : ${
        Array.isArray(value) ? 'tableau' : typeof value
      }).`,
    );
  }
  return value as Record<string, unknown>;
}

/**
 * Normalise `temperature_range` : `"unsupported"` ou couple [min, max] de
 * nombres avec min <= max. Absent → bornes du profil fail-closed.
 *
 * @param value Valeur brute du champ.
 * @param owner Chemin JSON cité dans l'erreur.
 * @returns Bornes opposables ou le marqueur de non-support.
 * @throws {GenerationParamsError} Sur toute autre forme.
 */
function parseTemperatureRange(value: unknown, owner: string): [number, number] | 'unsupported' {
  if (value === undefined) {
    return CAPABILITIES_NONE.temperatureRange;
  }
  if (value === 'unsupported') {
    return 'unsupported';
  }
  const isTuple =
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    value[0] <= value[1];
  if (isTuple && Array.isArray(value)) {
    return [value[0] as number, value[1] as number];
  }
  throw new GenerationParamsError(
    `"${owner}.capacites.temperature_range" doit valoir "unsupported" ` +
      'ou un couple [min, max] de nombres avec min <= max.',
  );
}

/**
 * Normalise le kind de raisonnement : enum admis ou profil fail-closed.
 *
 * @param value Valeur brute du champ `thinking`.
 * @param owner Chemin JSON cité dans l'erreur.
 * @returns Le kind normalisé.
 * @throws {GenerationParamsError} Sur valeur hors de l'enum.
 */
function parseThinkingKind(value: unknown, owner: string): ThinkingKind {
  if (value === undefined) {
    return CAPABILITIES_NONE.thinking;
  }
  if (THINKING_KINDS.includes(value as ThinkingKind)) {
    return value as ThinkingKind;
  }
  throw new GenerationParamsError(
    `"${owner}.capacites.thinking" doit valoir ${THINKING_KINDS.join(' | ')} ` +
      `(reçu : ${String(value)}).`,
  );
}

/**
 * Normalise un champ booléen de `capacites` OU retourne le repli fourni.
 *
 * @param value Valeur brute du champ.
 * @param owner Chemin JSON cité dans l'erreur.
 * @param key Nom de la clé validée.
 * @param fallback Valeur appliquée quand la clé est absente.
 * @returns Le booléen normalisé.
 * @throws {GenerationParamsError} Si la valeur présente n'est pas un booléen.
 */
function parseBooleanField(value: unknown, owner: string, key: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  throw new GenerationParamsError(
    `"${owner}.capacites.${key}" doit être un booléen (reçu : ${typeof value}).`,
  );
}

/**
 * Normalise `max_tokens_field` : nom de champ filaire admis ou valeur du
 * profil fail-closed si absent.
 *
 * @param value Valeur brute du champ.
 * @param owner Chemin JSON cité dans l'erreur.
 * @returns Le champ filaire normalisé.
 * @throws {GenerationParamsError} Sur valeur hors de l'enum.
 */
function parseMaxTokensField(value: unknown, owner: string): MaxTokensField {
  if (value === undefined) {
    return CAPABILITIES_NONE.maxTokensField;
  }
  if (MAX_TOKENS_FIELDS.includes(value as MaxTokensField)) {
    return value as MaxTokensField;
  }
  throw new GenerationParamsError(
    `"${owner}.capacites.max_tokens_field" doit valoir ${MAX_TOKENS_FIELDS.join(' | ')} ` +
      `(reçu : ${String(value)}).`,
  );
}

/**
 * Valide strictement la forme d'un objet `capacites` JSON et le normalise
 * en `ModelCapabilities`. Fail-closed : clé inconnue ou type inattendu →
 * `GenerationParamsError`. Chaque champ est optionnel individuellement ; un
 * champ absent prend la valeur du profil fail-closed `CAPABILITIES_NONE`.
 *
 * @param value Valeur brute de la clé `capacites`.
 * @param owner Chemin JSON cité dans les erreurs.
 * @returns Les capacités normalisées.
 * @throws {GenerationParamsError} Sur toute forme invalide.
 */
function validateCapabilitiesShape(value: unknown, owner: string): ModelCapabilities {
  const record = assertRecord(value, `${owner}.capacites`);
  for (const key of Object.keys(record)) {
    if (!CAPACITES_KEYS.includes(key)) {
      throw new GenerationParamsError(
        `clé inconnue "${key}" dans "${owner}.capacites" ` +
          `(admises : ${CAPACITES_KEYS.join(', ')}).`,
      );
    }
  }

  return {
    thinking: parseThinkingKind(record['thinking'], owner),
    promptCaching: parseBooleanField(
      record['prompt_caching'],
      owner,
      'prompt_caching',
      CAPABILITIES_NONE.promptCaching,
    ),
    temperatureRange: parseTemperatureRange(record['temperature_range'], owner),
    maxTokensField: parseMaxTokensField(record['max_tokens_field'], owner),
    maxTokensRequired: parseBooleanField(
      record['max_tokens_required'],
      owner,
      'max_tokens_required',
      CAPABILITIES_NONE.maxTokensRequired,
    ),
  };
}

/**
 * Résout le dialecte de protocole d'une famille.
 *
 * Ordre : `protocol_family` déclaré dans l'entrée JSON (ajouté par le Step 3
 * du plan amont) s'il est présent et admis ; sinon table native fail-closed
 * (`anthropic`, `openai`, `gemini`) ; sinon rejet explicite.
 *
 * @param familyName Nom de la famille JSON (clé sous `familles`).
 * @param rawFamilyEntry Entrée brute `familles.<familyName>` (cast non validé
 *   du chargeur routeur — la forme est vérifiée ici).
 * @returns Le dialecte résolu.
 * @throws {GenerationParamsError} Si le champ existe mais n'est pas un
 *   dialecte admis, ou si la famille est inconnue sans déclaration.
 */
export function resolveProtocolDialect(
  familyName: string,
  rawFamilyEntry: unknown,
): ProtocolDialect {
  if (typeof rawFamilyEntry === 'object' && rawFamilyEntry !== null) {
    const raw = (rawFamilyEntry as Record<string, unknown>)['protocol_family'];
    if (raw !== undefined) {
      if (typeof raw === 'string' && DIALECTS.includes(raw as ProtocolDialect)) {
        return raw as ProtocolDialect;
      }
      throw new GenerationParamsError(
        `dialecte de protocole non admis pour la famille "${familyName}" ` +
          `(reçu : ${String(raw)} ; admis : ${DIALECTS.join(' | ')}).`,
      );
    }
  }
  const native = Object.hasOwn(NATIVE_DIALECTS, familyName)
    ? (Reflect.get(NATIVE_DIALECTS, familyName) as ProtocolDialect | undefined)
    : undefined;
  if (native !== undefined) return native;
  throw new GenerationParamsError(
    `aucun dialecte résolvable pour la famille "${familyName}" : ` +
      'ni champ "protocol_family" ni correspondance native (codex/antigravity ' +
      'sont hors périmètre déclaré).',
  );
}

/**
 * Résout les capacités d'un modèle : surcharge `modeles[i].capacites` si le
 * modèle est trouvé et en déclare une, sinon `capacites` de la famille,
 * sinon profil fail-closed « nul » (aucune capacité avancée).
 *
 * @param modelId Identifiant du modèle (champ `id` des entrées `modeles`).
 * @param rawFamilyEntry Entrée brute `familles.<x>` (cast non validé).
 * @returns Les capacités normalisées.
 * @throws {GenerationParamsError} Sur forme invalide du bloc `capacites` ou
 *   de la liste `modeles`.
 */
export function resolveCapabilities(modelId: string, rawFamilyEntry: unknown): ModelCapabilities {
  if (typeof rawFamilyEntry !== 'object' || rawFamilyEntry === null) {
    return CAPABILITIES_NONE;
  }
  const entry = rawFamilyEntry as Record<string, unknown>;

  const override = resolveModelOverride(entry['modeles'], modelId);
  if (override !== undefined) {
    return override;
  }

  const rawCaps = entry['capacites'];
  if (rawCaps === undefined) return CAPABILITIES_NONE;
  return validateCapabilitiesShape(rawCaps, 'famille');
}

/**
 * Cherche dans la liste `modeles` une entrée `id === modelId` déclarant une
 * surcharge `capacites`.
 *
 * INVARIANT : une entrée trouvée SANS `capacites` coupe la recherche et
 * laisse la capacité de famille s'appliquer (retour `undefined`) — le
 * premier `id` correspondant fait foi.
 *
 * @param rawModeles Valeur brute de la clé `modeles`.
 * @param modelId Identifiant recherché (champ `id`).
 * @returns La surcharge validée, ou `undefined` si absente.
 * @throws {GenerationParamsError} Si `modeles` n'est pas un tableau ou si la
 *   surcharge est malformée.
 */
function resolveModelOverride(rawModeles: unknown, modelId: string): ModelCapabilities | undefined {
  if (rawModeles === undefined) {
    return undefined;
  }
  if (!Array.isArray(rawModeles)) {
    throw new GenerationParamsError('"modeles" doit être un tableau d’entrées modèle.');
  }
  for (const rawModel of rawModeles) {
    if (typeof rawModel !== 'object' || rawModel === null) continue;
    const model = rawModel as Record<string, unknown>;
    if (model['id'] !== modelId) continue;
    const rawCaps = model['capacites'];
    if (rawCaps === undefined) return undefined;
    return validateCapabilitiesShape(rawCaps, `modele "${modelId}"`);
  }
  return undefined;
}

/**
 * Exige une condition de validité et lève sinon (gardes uniformisées).
 *
 * @param condition Condition qui doit être vraie.
 * @param message Message d'erreur métier.
 * @throws {GenerationParamsError} Si la condition est fausse.
 */
function requireValid(condition: boolean, message: string): void {
  if (!condition) throw new GenerationParamsError(message);
}

/**
 * Valide la cohérence interne du bloc `thinking` (forme seule, indépendante
 * des capacités). Défenses actives même en mode `'off'` : un budget mal
 * formé est rejeté partout plutôt que transporté silencieusement.
 *
 * @param thinking Bloc de raisonnement demandé.
 * @throws {GenerationParamsError} Sur mode inconnu, budget non entier ou
 *   effort hors enum.
 */
function validateThinkingShape(thinking: ThinkingParams): void {
  requireValid(
    thinking.mode === 'off' || thinking.mode === 'budget' || thinking.mode === 'effort',
    `mode de raisonnement inconnu : ${String(thinking.mode)}.`,
  );
  if (thinking.budgetTokens !== undefined) {
    requireValid(
      Number.isInteger(thinking.budgetTokens) && thinking.budgetTokens >= 1,
      'le budget de raisonnement doit être un entier >= 1 ' +
        `(reçu : ${String(thinking.budgetTokens)}).`,
    );
  }
  if (thinking.effort !== undefined) {
    requireValid(
      EFFORTS.includes(thinking.effort),
      `l’intensité de raisonnement doit valoir ${EFFORTS.join(' | ')} ` +
        `(reçu : ${String(thinking.effort)}).`,
    );
  }
}

/**
 * Valide le bloc `thinking` demandé contre la capacité résolue du modèle.
 *
 * Règles : raisonnement actif interdit si capacité `"none"` ; `budget`
 * exige une capacité à budget + un `budgetTokens` entier >= 1 ; `effort`
 * exige la capacité `openai-effort` + une intensité déclarée. Bornage
 * Anthropic : le budget doit être strictement inférieur au plafond effectif
 * post-bridage KKT (l'API répondrait 401/400 sinon).
 *
 * @param thinking Bloc de raisonnement (forme déjà validée).
 * @param caps Capacités résolues du modèle.
 * @param effectiveMaxTokens Plafond effectif post-bridage.
 * @throws {GenerationParamsError} Sur toute violation.
 */
function validateThinkingAgainstCaps(
  thinking: ThinkingParams,
  caps: ModelCapabilities,
  effectiveMaxTokens?: number,
): void {
  if (thinking.mode === 'off') {
    return;
  }
  requireValid(
    caps.thinking !== 'none',
    'raisonnement demandé mais non supporté par ce modèle (capacité "none").',
  );
  if (thinking.mode === 'budget') {
    requireValid(
      caps.thinking === 'anthropic-budget' || caps.thinking === 'gemini-budget',
      `le mode "budget" exige une capacité anthropic-budget ou gemini-budget ` +
        `(capacité résolue : ${caps.thinking}).`,
    );
    requireValid(
      Number.isInteger(thinking.budgetTokens) && (thinking.budgetTokens ?? 0) >= 1,
      'le mode "budget" exige budgetTokens (entier >= 1).',
    );
  }
  if (thinking.mode === 'effort') {
    requireValid(
      caps.thinking === 'openai-effort',
      `le mode "effort" exige la capacité openai-effort (capacité résolue : ${caps.thinking}).`,
    );
    requireValid(
      EFFORTS.includes(thinking.effort ?? ''),
      'le mode "effort" exige une intensité low | medium | high.',
    );
  }
  if (caps.thinking === 'anthropic-budget' && thinking.budgetTokens !== undefined) {
    requireValid(
      typeof effectiveMaxTokens === 'number' && effectiveMaxTokens >= 1,
      'le plafond effectif de jetons de sortie (post-bridage) est requis ' +
        'pour borner un budget de raisonnement Anthropic.',
    );
    requireValid(
      (thinking.budgetTokens ?? 0) < (effectiveMaxTokens ?? 0),
      `le budget de raisonnement (${thinking.budgetTokens}) doit être ` +
        `strictement inférieur au plafond effectif de sortie (${effectiveMaxTokens}) : ` +
        'le bridage budgétaire a préséance.',
    );
  }
}

/**
 * Valide la température demandée contre la plage résolue du modèle.
 *
 * @param temperature Température demandée.
 * @param caps Capacités résolues du modèle.
 * @throws {GenerationParamsError} Si non numérique, non supportée ou hors
 *   des bornes inclusives déclarées.
 */
function validateTemperatureAgainstCaps(temperature: number, caps: ModelCapabilities): void {
  requireValid(
    Number.isFinite(temperature),
    `la température doit être un nombre fini (reçu : ${String(temperature)}).`,
  );
  requireValid(
    caps.temperatureRange !== 'unsupported',
    'température demandée mais rejetée par cette API (capacité "unsupported") : ' +
      'retirer le paramètre pour utiliser le défaut du fournisseur.',
  );
  if (caps.temperatureRange !== 'unsupported') {
    const [min, max] = caps.temperatureRange;
    requireValid(
      temperature >= min && temperature <= max,
      `température ${temperature} hors des bornes admises [${min}, ${max}].`,
    );
  }
}

/**
 * Valide des paramètres de génération contre les capacités du modèle.
 * Fail-closed : toute violation lève `GenerationParamsError` AVANT tout
 * accès réseau (le routeur la classe en échec non-quota).
 *
 * Règle de précédence KKT : le budget de raisonnement Anthropic est borné
 * par `effectiveMaxTokens`, la valeur post-bridage budgétaire — jamais par
 * un plafond déclaré plus large.
 *
 * @param params Paramètres demandés (normalisés).
 * @param caps Capacités résolues du modèle cible.
 * @param effectiveMaxTokens Plafond de jetons de sortie effectif (post-KKT).
 * @throws {GenerationParamsError} Sur toute violation.
 */
export function validateParams(
  params: GenerationParams,
  caps: ModelCapabilities,
  effectiveMaxTokens?: number,
): void {
  requireValid(
    typeof params === 'object' && params !== null,
    'les paramètres de génération doivent former un objet.',
  );

  if (params.thinking !== undefined) {
    validateThinkingShape(params.thinking);
    validateThinkingAgainstCaps(params.thinking, caps, effectiveMaxTokens);
  }

  if (params.temperature !== undefined) {
    validateTemperatureAgainstCaps(params.temperature, caps);
  }

  if (params.maxTokens !== undefined) {
    requireValid(
      Number.isInteger(params.maxTokens) && params.maxTokens >= 1,
      `maxTokens doit être un entier >= 1 (reçu : ${String(params.maxTokens)}).`,
    );
  }

  if (params.promptCaching === true) {
    requireValid(caps.promptCaching, 'prompt caching demandé mais non supporté par ce modèle.');
  }
}

/**
 * Liste les champs de plafond de sortie licites pour un dialecte (cohérence
 * déclaration ↔ moteur ; fail-closed sur déclaration incohérente).
 *
 * @param dialect Dialecte de protocole résolu.
 * @returns Les noms de champ admis pour ce dialecte.
 */
function allowedMaxTokensFields(dialect: ProtocolDialect): readonly MaxTokensField[] {
  switch (dialect) {
    case 'openai-compatible':
      return ['max_tokens', 'max_completion_tokens'];
    case 'anthropic-compatible':
      return ['max_tokens'];
    case 'gemini-native':
      return ['maxOutputTokens'];
  }
}

/**
 * Pose le plafond de sortie dans le wire sous le champ déclaré (branches à
 * clés littérales, convention sécurité du dépôt).
 *
 * @param wire Champs filaires en cours d'assemblage (muté en place).
 * @param field Champ déclaré dans les capacités.
 * @param value Plafond effectif à émettre.
 */
function assignMaxTokensField(
  wire: Record<string, unknown>,
  field: MaxTokensField,
  value: number,
): void {
  if (field === 'max_tokens') {
    wire.max_tokens = value;
  } else if (field === 'max_completion_tokens') {
    wire.max_completion_tokens = value;
  } else {
    wire.maxOutputTokens = value;
  }
}

/**
 * Émet le bloc de raisonnement filaire du dialecte, le cas échéant. Le mode
 * `'off'` n'émet rien (défaut fournisseur) : jamais `{ type: 'disabled' }`
 * ni `thinkingBudget: 0`.
 *
 * @param dialect Dialecte de protocole résolu.
 * @param thinking Bloc demandé (forme et capacité déjà validées).
 * @param wire Champs filaires en cours d'assemblage (muté en place).
 */
function assignThinkingWire(
  dialect: ProtocolDialect,
  thinking: ThinkingParams | undefined,
  wire: Record<string, unknown>,
): void {
  if (thinking === undefined || thinking.mode === 'off') {
    return;
  }
  if (thinking.mode === 'effort') {
    wire.reasoning_effort = thinking.effort;
    return;
  }
  if (dialect === 'anthropic-compatible') {
    wire.thinking = { type: 'enabled', budget_tokens: thinking.budgetTokens };
    return;
  }
  if (dialect === 'gemini-native') {
    wire.thinkingConfig = { thinkingBudget: thinking.budgetTokens };
  }
}

/**
 * Traduit des paramètres validés en champs filaires prêts à fusionner dans
 * le corps de requête, indexés par dialecte de protocole.
 *
 * INVARIANT : `validateParams` est toujours exécuté en premier — aucune
 * traduction sans validation.
 *
 * Cohérence fail-closed : le champ déclaré `maxTokensField` doit appartenir
 * aux champs licites du dialecte (ex. `max_completion_tokens` est rejeté
 * sous `anthropic-compatible`).
 *
 * Sémantique du mode `'off'` : aucun champ de raisonnement n'est émis (le
 * défaut du fournisseur s'applique) — on n'écrit jamais
 * `{ type: 'disabled' }` ni `thinkingBudget: 0`.
 *
 * @param dialect Dialecte résolu de la famille.
 * @param params Paramètres normalisés demandés.
 * @param caps Capacités résolues du modèle cible.
 * @param effectiveMaxTokens Plafond effectif post-bridage (repli si
 *   `params.maxTokens` est absent).
 * @returns Champs filaires à fusionner (dialecte gemini : à poser dans
 *   l'objet `generationConfig` — noms Gemini conservés à plat).
 * @throws {GenerationParamsError} Sur validation échouée, plafond requis
 *   absent, ou incohérence champ/dialecte.
 */
export function toWireParams(
  dialect: ProtocolDialect,
  params: GenerationParams,
  caps: ModelCapabilities,
  effectiveMaxTokens?: number,
): Record<string, unknown> {
  validateParams(params, caps, effectiveMaxTokens);

  const allowedFields = allowedMaxTokensFields(dialect);
  requireValid(
    allowedFields.includes(caps.maxTokensField),
    `le champ de plafond déclaré "${caps.maxTokensField}" est incohérent avec le ` +
      `dialecte "${dialect}" (admis : ${allowedFields.join(' | ')}).`,
  );

  const maxTokens = params.maxTokens ?? effectiveMaxTokens;
  if (maxTokens === undefined && caps.maxTokensRequired) {
    throw new GenerationParamsError(
      `le dialecte "${dialect}" exige un plafond de jetons de sortie dans chaque ` +
        'requête : ni maxTokens ni plafond effectif ne sont fournis.',
    );
  }

  const wire: Record<string, unknown> = {};
  if (maxTokens !== undefined) {
    assignMaxTokensField(wire, caps.maxTokensField, maxTokens);
  }
  if (params.temperature !== undefined) {
    wire.temperature = params.temperature;
  }
  assignThinkingWire(dialect, params.thinking, wire);
  return wire;
}

/**
 * Applique l'annotation de prompt caching Anthropic aux messages.
 *
 * INVARIANT : aucune mutation de l'entrée (copie défensive profonde) ; si
 * la capacité est absente ou la liste vide, la RÉFÉRENCE d'origine est
 * retournée telle quelle (zéro copie inutile).
 *
 * Convention d'annotation (documentée) : `cache_control: { type: 'ephemeral' }`
 * est posé sur le dernier bloc de contenu du PREMIER message `system`
 * rencontré qui possède un contenu non vide, sinon sur le premier message
 * avec contenu. Un message dont le contenu est une chaîne est converti en
 * bloc unique typé `text`. Si aucun message n'a de contenu, la copie est
 * retournée non annotée.
 *
 * @param messages Historique du routeur (non muté).
 * @param caps Capacités résolues du modèle cible.
 * @returns Les messages annotés (copie) ou la référence d'origine.
 */
export function applyPromptCaching(
  messages: ChatMessage[],
  caps: ModelCapabilities,
): ChatMessage[] {
  if (!caps.promptCaching || messages.length === 0) {
    return messages;
  }

  const copy = structuredClone(messages) as ChatMessage[];
  const bySystemThenOrder = [...copy].sort((a, b) => {
    const aSystem = a.role === 'system' ? 0 : 1;
    const bSystem = b.role === 'system' ? 0 : 1;
    return aSystem - bSystem;
  });

  for (const message of bySystemThenOrder) {
    if (annotateLastContentBlock(message)) return copy;
  }
  return copy;
}

/**
 * Pose `cache_control` sur le dernier bloc de contenu d'un message cloné.
 *
 * @param message Message de la copie défensive (mutation locale admise).
 * @returns `true` si l'annotation a été posée, `false` si le message n'a
 *   pas de contenu annotable.
 */
function annotateLastContentBlock(message: ChatMessage): boolean {
  const cacheControl = { type: 'ephemeral' };
  const content = message.content;

  if (typeof content === 'string' && content.length > 0) {
    message.content = [{ type: 'text', text: content, cache_control: cacheControl }];
    return true;
  }
  if (Array.isArray(content) && content.length > 0) {
    const last = content[content.length - 1];
    if (typeof last === 'object' && last !== null) {
      last.cache_control = cacheControl;
      return true;
    }
  }
  return false;
}

function budgetToEffort(budget: number): 'low' | 'medium' | 'high' {
  if (budget <= 2048) return 'low';
  if (budget <= 8192) return 'medium';
  return 'high';
}

function adaptEffortToBudget(
  effort: string | undefined,
  caps: ModelCapabilities,
  effectiveMaxTokens?: number,
): ThinkingParams {
  const effortMap: Record<string, number> = { low: 1024, medium: 4096, high: 16384 };
  let budgetTokens = effortMap[effort ?? 'medium'] ?? 4096;
  if (caps.thinking === 'anthropic-budget' && effectiveMaxTokens) {
    budgetTokens = Math.min(budgetTokens, Math.max(1, effectiveMaxTokens - 1));
  }
  console.warn(
    `[GenerationParams] Conversion de l'intensité de raisonnement (${effort}) vers budget (${budgetTokens} tokens).`,
  );
  return { mode: 'budget', budgetTokens };
}

function adaptThinkingForModel(
  thinking: ThinkingParams,
  caps: ModelCapabilities,
  effectiveMaxTokens?: number,
): ThinkingParams {
  if (caps.thinking === 'none') {
    console.warn(
      `[GenerationParams] Le modèle cible ne supporte pas le raisonnement. Mode désactivé (mode=off).`,
    );
    return { mode: 'off' };
  }

  if (caps.thinking === 'openai-effort' && thinking.mode === 'budget') {
    const budget = thinking.budgetTokens ?? 4096;
    const effort = budgetToEffort(budget);
    console.warn(
      `[GenerationParams] Conversion du budget (${budget} tokens) vers l'intensité OpenAI (${effort}).`,
    );
    return { mode: 'effort', effort };
  }

  if (caps.thinking === 'anthropic-budget' || caps.thinking === 'gemini-budget') {
    if (thinking.mode === 'effort') {
      return adaptEffortToBudget(thinking.effort, caps, effectiveMaxTokens);
    }
    if (thinking.mode === 'budget' && caps.thinking === 'anthropic-budget' && effectiveMaxTokens) {
      if ((thinking.budgetTokens ?? 0) >= effectiveMaxTokens) {
        const clamped = Math.max(1, effectiveMaxTokens - 1);
        console.warn(
          `[GenerationParams] Bridage du budget Anthropic de ${thinking.budgetTokens} vers ${clamped} tokens.`,
        );
        return { mode: 'budget', budgetTokens: clamped };
      }
    }
  }

  return thinking;
}

function adaptTemperature(
  temperature: number | undefined,
  caps: ModelCapabilities,
): number | undefined {
  if (temperature === undefined) return undefined;
  if (caps.temperatureRange === 'unsupported') {
    console.warn(`[GenerationParams] Température non supportée par le modèle cible. Champ retiré.`);
    return undefined;
  }
  const [min, max] = caps.temperatureRange;
  if (temperature < min || temperature > max) {
    const clamped = Math.min(Math.max(temperature, min), max);
    console.warn(
      `[GenerationParams] Température ${temperature} hors bornes [${min}, ${max}]. Ajustée à ${clamped}.`,
    );
    return clamped;
  }
  return temperature;
}

/**
 * Adapte intelligemment les paramètres de génération normalisés pour un modèle cible
 * (Conversion d'intentions vs Purge silencieuse).
 */
export function adaptParamsForTargetModel(
  params: GenerationParams,
  caps: ModelCapabilities,
  effectiveMaxTokens?: number,
): GenerationParams {
  const adapted: GenerationParams = structuredClone(params);

  if (adapted.thinking && adapted.thinking.mode !== 'off') {
    adapted.thinking = adaptThinkingForModel(adapted.thinking, caps, effectiveMaxTokens);
  }

  adapted.temperature = adaptTemperature(adapted.temperature, caps);

  if (adapted.promptCaching === true && !caps.promptCaching) {
    console.warn(
      `[GenerationParams] Prompt caching non supporté par le modèle cible. Option ignorée.`,
    );
    adapted.promptCaching = false;
  }

  return adapted;
}
