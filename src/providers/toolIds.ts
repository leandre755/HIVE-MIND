/**
 * Génération et validation des IDs de `tool_call` au format Mistral.
 *
 * Les endpoints Mistral et Codestral rejettent (erreur 400) tout ID de
 * `tool_call` qui n'est pas exactement 9 caractères alphanumériques, alors que
 * les autres fournisseurs émettent des IDs longs préfixés (`call_abc123…`).
 * Les deux adapters concernés dupliquaient cette logique : elle est centralisée
 * ici pour qu'un seul format fasse foi.
 *
 * Module autonome : aucun import depuis `./index.ts`.
 */
import { randomInt } from 'node:crypto';

/** Alphabet imposé par le format Mistral : `[a-zA-Z0-9]`. */
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Longueur exacte exigée par l'API. Toute autre longueur est rejetée en 400. */
const ID_LENGTH = 9;

/** Contrôle de conformité du format Mistral, ancré aux deux extrémités. */
const ID_PATTERN = /^[a-zA-Z0-9]{9}$/;

/**
 * Vérifie qu'un ID est conforme au format Mistral/Codestral.
 *
 * INVARIANT : retourne `true` si et seulement si `id` fait exactement
 * {@link ID_LENGTH} caractères, tous dans `[a-zA-Z0-9]`.
 */
export function isValidToolId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/**
 * Produit un ID de `tool_call` conforme au format Mistral/Codestral.
 *
 * Utilise `randomInt` de `node:crypto` (tirage uniforme sans biais de modulo)
 * et non `Math.random()` : ces IDs corrèlent une requête d'outil à sa réponse
 * dans une conversation, une collision réattribuerait un résultat d'outil au
 * mauvais appel.
 *
 * INVARIANT : la valeur retournée satisfait toujours {@link isValidToolId}.
 */
export function generateSafeToolId(): string {
  let id = '';
  for (let index = 0; index < ID_LENGTH; index += 1) {
    id += ID_ALPHABET.charAt(randomInt(0, ID_ALPHABET.length));
  }

  if (!isValidToolId(id)) {
    throw new Error(`[toolIds] ID généré non conforme au format Mistral: ${id}`);
  }

  return id;
}
