-- Migration: Add unique constraints for users.hash and users.jid
-- Date: 2026-09-12

-- 1. Ensure jid column exists and has unique constraint
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS jid text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_jid_key'
  ) THEN
    -- Reconcile historical duplicate JIDs before creating the unique constraint:
    -- Normalize historical JIDs with device suffixes (e.g. device_user:2@s.whatsapp.net -> device_user@s.whatsapp.net)
    -- Keep the normalized JID for the earliest record, and nullify duplicate JIDs so foreign keys are not broken.
    WITH duplicate_jids AS (
      SELECT ctid,
             regexp_replace(jid, ':[0-9]+@', '@') AS norm_jid,
             ROW_NUMBER() OVER (
               PARTITION BY regexp_replace(jid, ':[0-9]+@', '@')
               ORDER BY created_at ASC NULLS LAST, ctid ASC
             ) AS rn
      FROM public.users
      WHERE jid IS NOT NULL
    )
    UPDATE public.users u
    SET jid = CASE
      WHEN d.rn > 1 THEN NULL
      ELSE d.norm_jid
    END
    FROM duplicate_jids d
    WHERE u.ctid = d.ctid AND (d.rn > 1 OR u.jid <> d.norm_jid);

    ALTER TABLE public.users ADD CONSTRAINT users_jid_key UNIQUE (jid);
  END IF;
END $$;

-- 2. Ensure hash column exists and has unique constraint
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS hash character varying;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_hash_key'
  ) THEN
    -- Reconcile historical duplicate hashes before creating the unique constraint:
    -- Keep the hash for the primary/earliest record, and nullify duplicate hashes so they can be regenerated dynamically.
    WITH duplicate_hashes AS (
      SELECT ctid,
             ROW_NUMBER() OVER (PARTITION BY hash ORDER BY created_at ASC NULLS LAST, ctid ASC) AS rn
      FROM public.users
      WHERE hash IS NOT NULL
    )
    UPDATE public.users u
    SET hash = NULL
    FROM duplicate_hashes d
    WHERE u.ctid = d.ctid AND d.rn > 1;

    ALTER TABLE public.users ADD CONSTRAINT users_hash_key UNIQUE (hash);
  END IF;
END $$;
