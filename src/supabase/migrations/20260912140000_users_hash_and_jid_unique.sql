-- Migration: Add unique constraints for users.hash and users.jid
-- Date: 2026-09-12

-- 1. Ensure jid column exists and has unique constraint
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS jid text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_jid_key'
  ) THEN
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
    ALTER TABLE public.users ADD CONSTRAINT users_hash_key UNIQUE (hash);
  END IF;
END $$;
