import { db } from '../supabase.js';

// Résout un identifiant legacy (JID / plateforme) en `context_id` uuid canonique.
// `null` = introuvable ou résolution en échec : l'appelant doit abandonner plutôt
// qu'écrire un identifiant non-uuid dans une colonne `context_id uuid NOT NULL`.
export async function resolveMemoryContextId(chatId: string): Promise<string | null> {
  try {
    const resolved = await db.resolveContextFromLegacyId(chatId);
    return resolved ? resolved.context_id : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[Memory] Résolution context_id échouée:', message);
    return null;
  }
}
