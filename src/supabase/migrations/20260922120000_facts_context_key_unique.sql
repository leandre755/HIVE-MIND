-- Migration: Add unique constraint for facts (context_id, key)
-- Date: 2026-09-22

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'facts_context_key_unique'
      AND connamespace = 'public'::regnamespace
  ) THEN
    -- Reconcile historical duplicate facts by (context_id, key), keeping the most
    -- recent value so the result matches the last-write-wins upsert semantics.
    WITH duplicate_facts AS (
      SELECT ctid,
             ROW_NUMBER() OVER (
               PARTITION BY context_id, key
               ORDER BY created_at DESC NULLS LAST, id DESC
             ) AS rn
      FROM public.facts
      WHERE context_id IS NOT NULL AND key IS NOT NULL
    )
    DELETE FROM public.facts
    WHERE ctid IN (SELECT ctid FROM duplicate_facts WHERE rn > 1);

    ALTER TABLE public.facts ADD CONSTRAINT facts_context_key_unique UNIQUE (context_id, key);
  END IF;
END $$;
