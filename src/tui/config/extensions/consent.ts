/**
 * consent — Gestion du consentement utilisateur dans le TUI HIVE-MIND.
 *
 * HIVE-MIND n'a pas besoin de consentement IDE/terminal.
 * Toutes les demandes de consentement sont refusées par défaut pour éviter
 * toute modification non sollicitée de l'environnement utilisateur.
 */

import type { ConfirmationRequest } from '../../ui/contexts/UIStateContext.js';

/**
 * Demande un consentement interactif à l'utilisateur.
 * Retourne `false` (refusé) par défaut.
 */
export async function requestConsentInteractive(
  _message: string,
  _addRequest: (request: ConfirmationRequest) => void,
): Promise<boolean> {
  return false;
}

/**
 * Vérifie si un consentement a déjà été enregistré pour une clé donnée.
 */
export function hasConsent(_key: string): boolean {
  return false;
}
