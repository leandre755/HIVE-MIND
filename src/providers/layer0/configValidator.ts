/**
 * Configuration Validators for models_config.json and services_config.json.
 *
 * Three pure functions that detect structural defects, ID collisions,
 * and broken cross-references via console.warn — never throw unless
 * the root shape is irrecoverably invalid.
 */

const TAG = '[configValidator]';

/**
 * Structural type guard for plain JSON objects.
 * @param value - Any runtime value.
 * @returns True when value is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a string property safely via Reflect.get and validates it.
 * @param obj - The record to read from.
 * @param key - The property key.
 * @returns The string value, or undefined when missing/non-string/empty.
 */
function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const raw = Reflect.get(obj, key);
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/**
 * Checks whether a key is a valid fallback slot (fallback, fallback_2, fallback_3, …).
 * Avoids regex with quantifiers to satisfy security/detect-unsafe-regex.
 * @param key - The property key to test.
 */
function isFallbackKey(key: string): boolean {
  if (key === 'fallback') return true;
  if (!key.startsWith('fallback_')) return false;
  const suffix = key.slice('fallback_'.length);
  if (suffix.length === 0) return false;
  for (const ch of suffix) {
    if (ch < '0' || ch > '9') return false;
  }
  return true;
}

/**
 * Validates a single model entry within a family and updates the collision map.
 * @param familyName - Name of the parent family.
 * @param rawModel - The raw model record from the JSON.
 * @param idToFamilies - Mutable collision accumulator.
 */
function validateModelEntry(
  familyName: string,
  rawModel: unknown,
  idToFamilies: Map<string, string[]>,
): void {
  if (!isRecord(rawModel)) return;
  const modelId = readString(rawModel, 'id');
  if (modelId === undefined) {
    console.warn(`${TAG} Famille "${familyName}": modèle sans id valide.`);
    return;
  }
  if (readString(rawModel, 'description') === undefined) {
    console.warn(`${TAG} Modèle "${modelId}" (${familyName}): description manquante.`);
  }
  const existing = idToFamilies.get(modelId) ?? [];
  existing.push(familyName);
  idToFamilies.set(modelId, existing);
}

/**
 * Validates a single family block and indexes its models into the collision map.
 * @param familyName - Name of the family.
 * @param rawFamily - The raw family record from the JSON.
 * @param idToFamilies - Mutable collision accumulator.
 */
function validateFamilyBlock(
  familyName: string,
  rawFamily: unknown,
  idToFamilies: Map<string, string[]>,
): void {
  if (!isRecord(rawFamily)) {
    console.warn(`${TAG} Famille "${familyName}" ignorée (pas un objet).`);
    return;
  }
  if (readString(rawFamily, 'base_url') === undefined) {
    console.warn(`${TAG} Famille "${familyName}": base_url manquant ou vide.`);
  }
  if (readString(rawFamily, 'protocol_family') === undefined) {
    console.warn(`${TAG} Famille "${familyName}": protocol_family manquant ou vide.`);
  }
  const modeles = Reflect.get(rawFamily, 'modeles');
  if (!Array.isArray(modeles)) {
    console.warn(`${TAG} Famille "${familyName}": modeles absent ou non-tableau.`);
    return;
  }
  for (const rawModel of modeles) {
    validateModelEntry(familyName, rawModel, idToFamilies);
  }
}

/**
 * Reports all ID collisions found in the accumulator.
 * @param idToFamilies - The populated collision map.
 */
function reportCollisions(idToFamilies: Map<string, string[]>): void {
  for (const [id, familyList] of idToFamilies.entries()) {
    if (familyList.length > 1) {
      console.warn(`${TAG} Collision ID: ${id} dans ${familyList.join(', ')}`);
    }
  }
}

/**
 * Validates the structural integrity of a parsed models_config.json.
 *
 * Performs three checks:
 * 1. Required family-level fields: `base_url`, `protocol_family`.
 * 2. Required model-level fields: `id`, `description`.
 * 3. ID collision detection: warns when one model ID appears in multiple families.
 *
 * @param modelsConfig - Parsed JSON content of models_config.json (typed as unknown for safety).
 * @throws {Error} When modelsConfig is not an object or `familles` is missing/malformed.
 */
export function validateModelsConfig(modelsConfig: unknown): void {
  if (!isRecord(modelsConfig)) {
    throw new Error(`${TAG} modelsConfig must be a JSON object.`);
  }
  const familles = Reflect.get(modelsConfig, 'familles');
  if (!isRecord(familles)) {
    throw new Error(`${TAG} modelsConfig.familles must be a JSON object.`);
  }

  const idToFamilies = new Map<string, string[]>();
  for (const [familyName, rawFamily] of Object.entries(familles)) {
    validateFamilyBlock(familyName, rawFamily, idToFamilies);
  }
  reportCollisions(idToFamilies);
}

/**
 * Checks that every fallback field in an entry is a non-empty string when defined.
 * @param entry - Service recipe or chat category record.
 * @param label - Human-readable label for warning messages.
 */
function validateFallbackFields(entry: Record<string, unknown>, label: string): void {
  for (const [key, value] of Object.entries(entry)) {
    if (!isFallbackKey(key)) continue;
    if (typeof value !== 'string' || value.length === 0) {
      console.warn(`${TAG} ${label}: ${key} défini mais vide ou non-string.`);
    }
  }
}

/**
 * Validates all service_recipes entries.
 * @param serviceRecipes - The service_recipes block.
 */
function validateServiceRecipes(serviceRecipes: Record<string, unknown>): void {
  for (const [name, rawRecipe] of Object.entries(serviceRecipes)) {
    if (!isRecord(rawRecipe)) continue;
    if (readString(rawRecipe, 'model') === undefined) {
      console.warn(`${TAG} Service "${name}": champ model manquant.`);
    }
    validateFallbackFields(rawRecipe, `service "${name}"`);
  }
}

/**
 * Validates all chat_recipes.categories entries.
 * @param chatRecipes - The chat_recipes block.
 */
function validateChatRecipes(chatRecipes: Record<string, unknown>): void {
  const categories = Reflect.get(chatRecipes, 'categories');
  if (!isRecord(categories)) return;
  for (const [name, rawCat] of Object.entries(categories)) {
    if (!isRecord(rawCat)) continue;
    if (readString(rawCat, 'primary') === undefined) {
      console.warn(`${TAG} Catégorie "${name}": champ primary manquant.`);
    }
    validateFallbackFields(rawCat, `catégorie "${name}"`);
  }
}

/**
 * Validates the structural integrity of a parsed services_config.json.
 *
 * Checks that every service recipe declares a `model` field and every
 * chat recipe category declares a `primary` field. Fallback fields
 * (fallback, fallback_2, …) are checked for string validity when present.
 *
 * @param servicesConfig - Parsed JSON content of services_config.json.
 * @throws {Error} When servicesConfig is not a valid object.
 */
export function validateServicesConfig(servicesConfig: unknown): void {
  if (!isRecord(servicesConfig)) {
    throw new Error(`${TAG} servicesConfig must be a JSON object.`);
  }
  const serviceRecipes = Reflect.get(servicesConfig, 'service_recipes');
  if (isRecord(serviceRecipes)) {
    validateServiceRecipes(serviceRecipes);
  }
  const chatRecipes = Reflect.get(servicesConfig, 'chat_recipes');
  if (isRecord(chatRecipes)) {
    validateChatRecipes(chatRecipes);
  }
}

/**
 * Extracts model IDs from a single family's modeles array.
 * @param familyEntry - A raw family record from the JSON.
 * @returns Array of valid model ID strings found in this family.
 */
function extractFamilyModelIds(familyEntry: unknown): string[] {
  if (!isRecord(familyEntry)) return [];
  const modeles = Reflect.get(familyEntry, 'modeles');
  if (!Array.isArray(modeles)) return [];
  const ids: string[] = [];
  for (const m of modeles) {
    if (isRecord(m)) {
      const id = readString(m, 'id');
      if (id !== undefined) ids.push(id);
    }
  }
  return ids;
}

/**
 * Collects every model ID declared across all familles.
 * @param modelsConfig - Parsed models_config.json content.
 * @returns A Set of every model ID found.
 */
function collectAllModelIds(modelsConfig: unknown): Set<string> {
  const ids = new Set<string>();
  if (!isRecord(modelsConfig)) return ids;
  const familles = Reflect.get(modelsConfig, 'familles');
  if (!isRecord(familles)) return ids;
  for (const familyEntry of Object.values(familles)) {
    for (const id of extractFamilyModelIds(familyEntry)) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Extracts every model reference (primary + all fallbacks) from a service/category entry.
 * @param entry - A single service recipe or chat category record.
 * @returns Array of model ID strings referenced by this entry.
 */
function collectReferencedModelIds(entry: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const primaryRef = readString(entry, 'model') ?? readString(entry, 'primary');
  if (primaryRef !== undefined) ids.push(primaryRef);
  for (const [key, value] of Object.entries(entry)) {
    if (isFallbackKey(key) && typeof value === 'string' && value.length > 0) {
      ids.push(value);
    }
  }
  return ids;
}

/**
 * Checks all references in one service/category entry against known model IDs.
 * @param serviceName - Human-readable service or category name.
 * @param entry - The recipe record.
 * @param knownIds - Set of all declared model IDs.
 */
function checkEntryReferences(
  serviceName: string,
  entry: Record<string, unknown>,
  knownIds: Set<string>,
): void {
  for (const modelId of collectReferencedModelIds(entry)) {
    if (!knownIds.has(modelId)) {
      console.warn(`${TAG} Modèle référencé introuvable: ${modelId} dans service ${serviceName}`);
    }
  }
}

/**
 * Cross-checks chat_recipes.categories references against known model IDs.
 * @param servicesConfig - The root services config record.
 * @param knownIds - Set of all declared model IDs.
 */
function crossCheckChatRecipes(
  servicesConfig: Record<string, unknown>,
  knownIds: Set<string>,
): void {
  const chatRecipes = Reflect.get(servicesConfig, 'chat_recipes');
  if (!isRecord(chatRecipes)) return;
  const categories = Reflect.get(chatRecipes, 'categories');
  if (!isRecord(categories)) return;
  for (const [name, rawCat] of Object.entries(categories)) {
    if (isRecord(rawCat)) checkEntryReferences(name, rawCat, knownIds);
  }
}

/**
 * Validates cross-references between services_config.json and models_config.json.
 *
 * Extracts all known model IDs from modelsConfig, then verifies that every
 * model reference in servicesConfig (primary/model, fallback, fallback_2, …)
 * resolves to a declared model ID. Emits console.warn for each broken reference.
 *
 * @param modelsConfig - Parsed JSON content of models_config.json.
 * @param servicesConfig - Parsed JSON content of services_config.json.
 * @throws {Error} When servicesConfig is not a valid object.
 */
export function validateCrossReferences(modelsConfig: unknown, servicesConfig: unknown): void {
  const knownModelIds = collectAllModelIds(modelsConfig);
  if (!isRecord(servicesConfig)) {
    throw new Error(`${TAG} servicesConfig must be a JSON object.`);
  }
  const serviceRecipes = Reflect.get(servicesConfig, 'service_recipes');
  if (isRecord(serviceRecipes)) {
    for (const [name, rawRecipe] of Object.entries(serviceRecipes)) {
      if (isRecord(rawRecipe)) checkEntryReferences(name, rawRecipe, knownModelIds);
    }
  }
  crossCheckChatRecipes(servicesConfig, knownModelIds);
}
