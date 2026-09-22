/**
 * Contexte de la base de connaissances globale (documents ingérés, `role: 'system'`).
 * `memories.context_id` étant un `uuid NOT NULL`, la sentinelle historique
 * `'global'` (texte) est in-stockable : on lui substitue le nil UUID.
 */
export const GLOBAL_CONTEXT_ID = '00000000-0000-0000-0000-000000000000';
