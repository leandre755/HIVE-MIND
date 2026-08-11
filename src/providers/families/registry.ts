/**
 * Registre fail-closed des familles de protocole et des moteurs d'en-têtes.
 *
 * Point d'entrée unique pour résoudre un nom de famille (déclaré dans la
 * configuration) vers son implémentation. La résolution d'un nom inconnu lève
 * une `Error` explicite : aucun repli silencieux ne doit produire des requêtes
 * mal signées ou mal sérialisées vers un fournisseur.
 *
 * Le registre valide au chargement du module que chaque singleton expose un
 * `name` identique à sa clé d'enregistrement et qu'aucun doublon n'existe :
 * une dérive de câblage échoue à l'import, avant tout trafic réseau.
 *
 * Accès : `getProtocolFamily(nom)` / `getHeaderFamily(nom)` pour la résolution,
 * `listProtocolFamilies()` / `listHeaderFamilies()` pour l'introspection (le
 * routeur et la configuration restent découplés des fichiers d'implémentation).
 */

import type { HeaderFamily, ProtocolFamily } from './types.js';
import { claudeCodeHeaders } from './headers/ClaudeCodeHeaders.js';
import { standardBearerHeaders } from './headers/StandardBearerHeaders.js';
import { tokenAuthHeaders } from './headers/TokenAuthHeaders.js';
import { xApiKeyHeaders } from './headers/XApiKeyHeaders.js';
import { anthropicCompatibleProtocol } from './protocols/AnthropicCompatibleProtocol.js';
import { openAICompatibleProtocol } from './protocols/OpenAICompatibleProtocol.js';

export type {
  HeaderContext,
  HeaderFamily,
  ProtocolContext,
  ProtocolFamily,
  ProtocolOptions,
} from './types.js';

/** Contrainte minimale commune aux familles enregistrables. */
interface NamedFamily {
  name: string;
}

/**
 * Construit une table de résolution validée à partir de couples clé/singleton.
 *
 * INVARIANT : chaque clé est unique et égale au `name` exposé par son
 * singleton ; toute violation lève une erreur au chargement du module.
 *
 * @param label Étiquette humaine du type de famille (pour situer l'erreur).
 * @param entries Couples `[nom enregistré, singleton]`.
 * @returns Table en lecture seule indexée par nom de famille.
 * @throws {Error} Sur doublon de nom ou divergence entre clé et `name`.
 */
function buildRegistry<T extends NamedFamily>(
  label: string,
  entries: [string, T][],
): ReadonlyMap<string, T> {
  const table = new Map<string, T>();
  for (const [key, family] of entries) {
    if (family.name !== key) {
      throw new Error(
        `[registry] ${label} enregistrée sous "${key}" mais expose le nom ` +
          `"${family.name}" : câblage incohérent.`,
      );
    }
    if (table.has(key)) {
      throw new Error(`[registry] ${label} en double sous le nom "${key}".`);
    }
    table.set(key, family);
  }
  return table;
}

/** Familles de protocole connues, indexées par leur nom de configuration. */
const PROTOCOL_FAMILIES: ReadonlyMap<string, ProtocolFamily> = buildRegistry<ProtocolFamily>(
  'ProtocolFamily',
  [
    ['openai-compatible', openAICompatibleProtocol],
    ['anthropic-compatible', anthropicCompatibleProtocol],
  ],
);

/** Moteurs d'en-têtes connus, indexés par leur nom de configuration. */
const HEADER_FAMILIES: ReadonlyMap<string, HeaderFamily> = buildRegistry<HeaderFamily>(
  'HeaderFamily',
  [
    ['standard-bearer', standardBearerHeaders],
    ['standard-token', tokenAuthHeaders],
    ['x-api-key', xApiKeyHeaders],
    ['claude-code', claudeCodeHeaders],
  ],
);

/**
 * Résout une famille de protocole par son nom.
 *
 * @param name Nom déclaré dans la configuration (ex. `openai-compatible`).
 * @returns Le singleton correspondant.
 * @throws {Error} Si le nom n'est pas enregistré.
 */
export function getProtocolFamily(name: string): ProtocolFamily {
  const family = PROTOCOL_FAMILIES.get(name);
  if (!family) {
    throw new Error(`ProtocolFamily inconnue: ${name}`);
  }
  return family;
}

/**
 * Résout un moteur d'en-têtes par son nom.
 *
 * @param name Nom déclaré dans la configuration (ex. `standard-bearer`).
 * @returns Le singleton correspondant.
 * @throws {Error} Si le nom n'est pas enregistré.
 */
export function getHeaderFamily(name: string): HeaderFamily {
  const family = HEADER_FAMILIES.get(name);
  if (!family) {
    throw new Error(`HeaderFamily inconnue: ${name}`);
  }
  return family;
}

/**
 * Énumère les noms des familles de protocole enregistrées.
 *
 * @returns Copie instantanée des noms, dans l'ordre d'enregistrement.
 */
export function listProtocolFamilies(): string[] {
  return [...PROTOCOL_FAMILIES.keys()];
}

/**
 * Énumère les noms des moteurs d'en-têtes enregistrés.
 *
 * @returns Copie instantanée des noms, dans l'ordre d'enregistrement.
 */
export function listHeaderFamilies(): string[] {
  return [...HEADER_FAMILIES.keys()];
}
