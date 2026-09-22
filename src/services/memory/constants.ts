// Contexte de la base de connaissances globale (documents ingérés, `role: 'system'`) :
// `memories.context_id` est un `uuid NOT NULL`, la sentinelle texte `'global'` est donc
// in-stockable — nil UUID utilisé à la place.
export const GLOBAL_CONTEXT_ID = '00000000-0000-0000-0000-000000000000';
