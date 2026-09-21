-- Migration: Add unique constraints for graph memory entities and relationships
-- Date: 2026-09-20

-- 1. Ensure entities table has unique constraint on (context_id, name)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entities_context_name_unique'
  ) THEN
    -- Map discarded entity id to survivor entity id
    CREATE TEMP TABLE entity_survivor_map ON COMMIT DROP AS
    WITH ranked_entities AS (
      SELECT id,
             FIRST_VALUE(id) OVER (
               PARTITION BY context_id, name
               ORDER BY updated_at DESC NULLS LAST, created_at ASC NULLS LAST, ctid ASC
             ) AS survivor_id,
             ROW_NUMBER() OVER (
               PARTITION BY context_id, name
               ORDER BY updated_at DESC NULLS LAST, created_at ASC NULLS LAST, ctid ASC
             ) AS rn
      FROM public.entities
      WHERE context_id IS NOT NULL AND name IS NOT NULL
    )
    SELECT id AS old_id, survivor_id AS new_id
    FROM ranked_entities
    WHERE rn > 1 AND id <> survivor_id;

    -- Repoint relationships source_id
    UPDATE public.relationships r
    SET source_id = m.new_id
    FROM entity_survivor_map m
    WHERE r.source_id = m.old_id;

    -- Repoint relationships target_id
    UPDATE public.relationships r
    SET target_id = m.new_id
    FROM entity_survivor_map m
    WHERE r.target_id = m.old_id;

    -- Reconcile duplicate relationships that might have been created by repointing
    WITH duplicate_repointed_rels AS (
      SELECT ctid,
             ROW_NUMBER() OVER (
               PARTITION BY source_id, target_id, relation_type
               ORDER BY created_at ASC NULLS LAST, ctid ASC
             ) AS rn
      FROM public.relationships
      WHERE source_id IS NOT NULL AND target_id IS NOT NULL AND relation_type IS NOT NULL
    )
    DELETE FROM public.relationships
    WHERE ctid IN (SELECT ctid FROM duplicate_repointed_rels WHERE rn > 1);

    -- Now safely delete discarded duplicate entities
    DELETE FROM public.entities
    WHERE id IN (SELECT old_id FROM entity_survivor_map);

    DROP TABLE IF EXISTS entity_survivor_map;

    ALTER TABLE public.entities ADD CONSTRAINT entities_context_name_unique UNIQUE (context_id, name);
  END IF;
END $$;

-- 2. Ensure relationships table has unique constraint on (source_id, target_id, relation_type)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'relationships_source_target_type_unique'
  ) THEN
    -- Reconcile historical duplicate relationships by (source_id, target_id, relation_type)
    WITH duplicate_rels AS (
      SELECT ctid,
             ROW_NUMBER() OVER (
               PARTITION BY source_id, target_id, relation_type
               ORDER BY created_at ASC NULLS LAST, ctid ASC
             ) AS rn
      FROM public.relationships
      WHERE source_id IS NOT NULL AND target_id IS NOT NULL AND relation_type IS NOT NULL
    )
    DELETE FROM public.relationships
    WHERE ctid IN (SELECT ctid FROM duplicate_rels WHERE rn > 1);

    ALTER TABLE public.relationships ADD CONSTRAINT relationships_source_target_type_unique UNIQUE (source_id, target_id, relation_type);
  END IF;
END $$;
