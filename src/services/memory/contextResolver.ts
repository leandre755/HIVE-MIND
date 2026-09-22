import { db } from '../supabase.js';

/**
 * Résout un identifiant legacy (JID / plateforme) en `context_id` uuid canonique.
 * Retourne `null` quand aucune identité ne correspond ou que la résolution échoue :
 * les appelants doivent alors abandonner plutôt que d'écrire un identifiant non-uuid
 * dans une colonne `context_id uuid NOT NULL`.
 */
export async function resolveMemoryContextId(chatId: string): Promise<string | null> {
  try {
    const resolved = await db.resolveContextFromLegacyId(chatId);
    return resolved ? resolved.context_id : null;
  } catch (error: unknown) {
    console.warn(
      '[Memory] Résolution context_id échouée:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
