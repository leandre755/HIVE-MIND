-- ============================================================================
-- OMNI-CHANNEL SCHEMA (HIVE-MIND Phase 5) - IDEMPOTENT & IN-PLACE UPGRADE SCRIPT
-- ============================================================================
-- Ce script est strictement idempotent et non destructif.
-- Il peut être exécuté sur une base vierge OU sur une base de données existante
-- sans perte de données, en appliquant automatiquement les ajouts de colonnes,
-- contraintes uniques et fonctions RPC nécessaires.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- SECTION 1: USERS (Contacts) & IDENTITIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  jid text,
  username text,
  interaction_count bigint DEFAULT 0,
  language character varying,
  timezone character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  hash character varying,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

-- Colonnes additionnelles sur base existante
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS jid text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS interaction_count bigint DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS language character varying;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS timezone character varying;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS hash character varying;

-- Contraintes uniques idempotentes pour users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_jid_key' AND connamespace = 'public'::regnamespace
  ) THEN
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
    SET jid = CASE WHEN d.rn > 1 THEN NULL ELSE d.norm_jid END
    FROM duplicate_jids d
    WHERE u.ctid = d.ctid AND (d.rn > 1 OR u.jid <> d.norm_jid);

    ALTER TABLE public.users ADD CONSTRAINT users_jid_key UNIQUE (jid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_hash_key' AND connamespace = 'public'::regnamespace
  ) THEN
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

CREATE TABLE IF NOT EXISTS public.user_identities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL,
  platform_user_id text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_identities_pkey PRIMARY KEY (id),
  CONSTRAINT user_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

ALTER TABLE public.user_identities ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.user_identities ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.user_identities ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_identities_platform_user_id_key' AND connamespace = 'public'::regnamespace
  ) THEN
    WITH duplicate_identities AS (
      SELECT ctid,
             ROW_NUMBER() OVER (
               PARTITION BY platform, platform_user_id
               ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, ctid ASC
             ) AS rn
      FROM public.user_identities
      WHERE platform IS NOT NULL AND platform_user_id IS NOT NULL
    )
    DELETE FROM public.user_identities
    WHERE ctid IN (SELECT ctid FROM duplicate_identities WHERE rn > 1);

    ALTER TABLE public.user_identities ADD CONSTRAINT user_identities_platform_user_id_key UNIQUE (platform, platform_user_id);
  END IF;
END $$;

-- ============================================================================
-- SECTION 2: GROUPS & ADMINS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  platform_group_id text NOT NULL,
  name text,
  description text,
  bot_mission text,
  founder_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT groups_pkey PRIMARY KEY (id),
  CONSTRAINT groups_founder_id_fkey FOREIGN KEY (founder_id) REFERENCES public.users(id) ON DELETE SET NULL
);

ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS bot_mission text;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS founder_id uuid;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'groups_platform_group_id_key' AND connamespace = 'public'::regnamespace
  ) THEN
    WITH duplicate_groups AS (
      SELECT ctid,
             ROW_NUMBER() OVER (
               PARTITION BY platform, platform_group_id
               ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, ctid ASC
             ) AS rn
      FROM public.groups
      WHERE platform IS NOT NULL AND platform_group_id IS NOT NULL
    )
    DELETE FROM public.groups
    WHERE ctid IN (SELECT ctid FROM duplicate_groups WHERE rn > 1);

    ALTER TABLE public.groups ADD CONSTRAINT groups_platform_group_id_key UNIQUE (platform, platform_group_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.global_admins (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  role text CHECK (role = ANY (ARRAY['owner'::text, 'moderator'::text])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT global_admins_pkey PRIMARY KEY (id),
  CONSTRAINT global_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'global_admins_user_id_key' AND connamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE public.global_admins ADD CONSTRAINT global_admins_user_id_key UNIQUE (user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.group_admins (
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text DEFAULT 'admin'::text CHECK (role = ANY (ARRAY['admin'::text, 'superadmin'::text])),
  promoted_at timestamp with time zone DEFAULT now(),
  promoted_by uuid,
  CONSTRAINT group_admins_pkey PRIMARY KEY (group_id, user_id),
  CONSTRAINT group_admins_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE,
  CONSTRAINT group_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.group_configs (
  group_id uuid NOT NULL,
  welcome_message text,
  is_filtering_active boolean DEFAULT false,
  warning_limit integer DEFAULT 3,
  auto_ban boolean DEFAULT false,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT group_configs_pkey PRIMARY KEY (group_id),
  CONSTRAINT group_configs_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE
);

-- ============================================================================
-- SECTION 3: MODERATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.group_filters (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  group_id uuid NOT NULL,
  keyword text NOT NULL,
  regex_variants jsonb DEFAULT '[]'::jsonb,
  context_rule text,
  severity text CHECK (severity = ANY (ARRAY['warn'::text, 'kick'::text, 'ban'::text, 'mute'::text])),
  created_by uuid,
  CONSTRAINT group_filters_pkey PRIMARY KEY (id),
  CONSTRAINT group_filters_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.group_member_history (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  action text CHECK (action = ANY (ARRAY['add'::text, 'remove'::text, 'promote'::text, 'demote'::text])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT group_member_history_pkey PRIMARY KEY (id),
  CONSTRAINT group_member_history_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.group_whitelist (
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  added_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT group_whitelist_pkey PRIMARY KEY (group_id, user_id),
  CONSTRAINT group_whitelist_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE,
  CONSTRAINT group_whitelist_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.user_warnings (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  reason text,
  filter_id bigint,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_warnings_pkey PRIMARY KEY (id),
  CONSTRAINT user_warnings_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE,
  CONSTRAINT user_warnings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT user_warnings_filter_id_fkey FOREIGN KEY (filter_id) REFERENCES public.group_filters(id) ON DELETE SET NULL
);

-- ============================================================================
-- SECTION 4: AGENTIC & MEMORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.memories (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  context_id uuid NOT NULL,
  content text NOT NULL,
  role text CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])),
  embedding vector(1024),
  created_at timestamp with time zone DEFAULT now(),
  decay_score numeric DEFAULT 0.5,
  archived_at timestamp with time zone,
  recall_count integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT memories_pkey PRIMARY KEY (id)
);

ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS decay_score numeric DEFAULT 0.5;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS recall_count integer DEFAULT 0;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS embedding vector(1024);

CREATE TABLE IF NOT EXISTS public.agent_workspace (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  context_id uuid NOT NULL,
  key character varying(255) NOT NULL,
  content text NOT NULL,
  tags text[] DEFAULT '{}'::text[],
  embedding vector(1024),
  variance double precision DEFAULT 1.0,
  access_count integer DEFAULT 0,
  last_accessed timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT agent_workspace_pkey PRIMARY KEY (id)
);

ALTER TABLE public.agent_workspace ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[];
ALTER TABLE public.agent_workspace ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE public.agent_workspace ADD COLUMN IF NOT EXISTS variance double precision DEFAULT 1.0;
ALTER TABLE public.agent_workspace ADD COLUMN IF NOT EXISTS access_count integer DEFAULT 0;
ALTER TABLE public.agent_workspace ADD COLUMN IF NOT EXISTS last_accessed timestamp with time zone DEFAULT now();
ALTER TABLE public.agent_workspace ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.agent_workspace ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_workspace_context_key_unique' AND connamespace = 'public'::regnamespace
  ) THEN
    WITH duplicate_workspace AS (
      SELECT ctid,
             ROW_NUMBER() OVER (
               PARTITION BY context_id, key
               ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, ctid ASC
             ) AS rn
      FROM public.agent_workspace
      WHERE context_id IS NOT NULL AND key IS NOT NULL
    )
    DELETE FROM public.agent_workspace
    WHERE ctid IN (SELECT ctid FROM duplicate_workspace WHERE rn > 1);

    ALTER TABLE public.agent_workspace ADD CONSTRAINT agent_workspace_context_key_unique UNIQUE (context_id, key);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.facts (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  context_id uuid NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT facts_pkey PRIMARY KEY (id)
);

ALTER TABLE public.facts ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'facts_context_key_unique' AND connamespace = 'public'::regnamespace
  ) THEN
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

CREATE TABLE IF NOT EXISTS public.entities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  context_id uuid NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  embedding vector(1024),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT entities_pkey PRIMARY KEY (id)
);

ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public.relationships (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  context_id uuid NOT NULL,
  source_id uuid,
  target_id uuid,
  relation_type text NOT NULL,
  strength double precision DEFAULT 1.0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT relationships_pkey PRIMARY KEY (id),
  CONSTRAINT relationships_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.entities(id) ON DELETE CASCADE,
  CONSTRAINT relationships_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.entities(id) ON DELETE CASCADE
);

ALTER TABLE public.relationships ADD COLUMN IF NOT EXISTS strength double precision DEFAULT 1.0;
ALTER TABLE public.relationships ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.relationships ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entities_context_name_unique' AND connamespace = 'public'::regnamespace
  ) THEN
    CREATE TEMP TABLE IF NOT EXISTS entity_survivor_map ON COMMIT DROP AS
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

    UPDATE public.relationships r
    SET source_id = m.new_id
    FROM entity_survivor_map m
    WHERE r.source_id = m.old_id;

    UPDATE public.relationships r
    SET target_id = m.new_id
    FROM entity_survivor_map m
    WHERE r.target_id = m.old_id;

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

    DELETE FROM public.entities
    WHERE id IN (SELECT old_id FROM entity_survivor_map);

    DROP TABLE IF EXISTS entity_survivor_map;

    ALTER TABLE public.entities ADD CONSTRAINT entities_context_name_unique UNIQUE (context_id, name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'relationships_source_target_type_unique' AND connamespace = 'public'::regnamespace
  ) THEN
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

CREATE TABLE IF NOT EXISTS public.agent_actions (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  context_id uuid NOT NULL,
  tool_name text NOT NULL,
  params jsonb,
  result jsonb,
  status text CHECK (status = ANY (ARRAY['active'::text, 'success'::text, 'error'::text, 'interrupted'::text, 'completed'::text])),
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  steps jsonb DEFAULT '[]'::jsonb,
  CONSTRAINT agent_actions_pkey PRIMARY KEY (id)
);

ALTER TABLE public.agent_actions ADD COLUMN IF NOT EXISTS steps jsonb DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.action_scores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  action_id bigint,
  tool character varying NOT NULL,
  success boolean NOT NULL,
  execution_time_ms integer,
  result_quality numeric DEFAULT 0.5,
  user_feedback character varying,
  detected_reaction text,
  final_score numeric NOT NULL,
  learned text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT action_scores_pkey PRIMARY KEY (id),
  CONSTRAINT action_scores_action_id_fkey FOREIGN KEY (action_id) REFERENCES public.agent_actions(id) ON DELETE CASCADE
);

ALTER TABLE public.action_scores ADD COLUMN IF NOT EXISTS execution_time_ms integer;
ALTER TABLE public.action_scores ADD COLUMN IF NOT EXISTS result_quality numeric DEFAULT 0.5;
ALTER TABLE public.action_scores ADD COLUMN IF NOT EXISTS user_feedback character varying;
ALTER TABLE public.action_scores ADD COLUMN IF NOT EXISTS detected_reaction text;
ALTER TABLE public.action_scores ADD COLUMN IF NOT EXISTS learned text;
ALTER TABLE public.action_scores ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public.autonomous_goals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  target_context_id uuid,
  title text NOT NULL,
  description text,
  status text DEFAULT 'pending'::text,
  priority integer DEFAULT 5,
  execute_at timestamp with time zone,
  result text,
  origin text,
  trigger_type text DEFAULT 'TIME'::text CHECK (trigger_type = ANY (ARRAY['TIME'::text, 'EVENT'::text])),
  trigger_event text,
  trigger_condition jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT autonomous_goals_pkey PRIMARY KEY (id)
);

ALTER TABLE public.autonomous_goals ADD COLUMN IF NOT EXISTS trigger_type text DEFAULT 'TIME'::text;
ALTER TABLE public.autonomous_goals ADD COLUMN IF NOT EXISTS trigger_event text;
ALTER TABLE public.autonomous_goals ADD COLUMN IF NOT EXISTS trigger_condition jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.reminders (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  context_id uuid NOT NULL,
  message text NOT NULL,
  remind_at timestamp with time zone NOT NULL,
  sent boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT reminders_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.bot_tools (
  name text NOT NULL,
  plugin_name text NOT NULL,
  description text NOT NULL,
  definition jsonb NOT NULL,
  embedding vector(1024),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT bot_tools_pkey PRIMARY KEY (name)
);

ALTER TABLE public.bot_tools ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE public.bot_tools ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- ============================================================================
-- SECTION 5: RPC FUNCTIONS
-- ============================================================================

-- Function to match memories using pgvector
CREATE OR REPLACE FUNCTION match_memories (
  query_embedding vector(1024),
  match_threshold float,
  match_count int,
  match_context_id uuid
)
RETURNS TABLE (
  id bigint,
  content text,
  role text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    memories.id,
    memories.content,
    memories.role,
    1 - (memories.embedding <=> query_embedding) AS similarity
  FROM memories
  WHERE memories.context_id = match_context_id
    AND 1 - (memories.embedding <=> query_embedding) > match_threshold
  ORDER BY memories.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function for CMA synaptic boost
CREATE OR REPLACE FUNCTION cma_boost_memory(memory_ids bigint[])
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE memories
  SET recall_count = recall_count + 1,
      decay_score = LEAST(1.0, decay_score + 0.2)
  WHERE id = ANY(memory_ids);
END;
$$;

-- Function to match workspace using pgvector and Fisher variance approximation
CREATE OR REPLACE FUNCTION match_workspace (
  query_embedding vector(1024),
  match_threshold float,
  match_count int,
  match_context_id uuid
)
RETURNS TABLE (
  id uuid,
  key character varying(255),
  content text,
  tags text[],
  similarity float,
  variance double precision
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    agent_workspace.id,
    agent_workspace.key,
    agent_workspace.content,
    agent_workspace.tags,
    1 - (agent_workspace.embedding <=> query_embedding) AS similarity,
    agent_workspace.variance
  FROM agent_workspace
  WHERE agent_workspace.context_id = match_context_id
    AND 1 - (agent_workspace.embedding <=> query_embedding) > match_threshold
  ORDER BY agent_workspace.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function to increment access_count for Langevin dynamics
CREATE OR REPLACE FUNCTION increment_workspace_access (
  match_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE agent_workspace
  SET access_count = access_count + 1,
      last_accessed = now()
  WHERE id = match_id;
END;
$$;

-- Function to count user warnings
CREATE OR REPLACE FUNCTION count_user_warnings (
  p_group_id uuid,
  p_user_id uuid,
  p_days integer
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  warning_count integer;
BEGIN
  SELECT count(*)
  INTO warning_count
  FROM user_warnings
  WHERE group_id = p_group_id
    AND user_id = p_user_id
    AND created_at >= (now() - (p_days || ' days')::interval);
    
  RETURN warning_count;
END;
$$;

-- Function to match bot_tools by embedding similarity (RAG Tool Selection)
CREATE OR REPLACE FUNCTION match_tools (
  query_embedding vector(1024),
  match_count int
)
RETURNS TABLE (
  name text,
  plugin_name text,
  description text,
  definition jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    bot_tools.name,
    bot_tools.plugin_name,
    bot_tools.description,
    bot_tools.definition,
    1 - (bot_tools.embedding <=> query_embedding) AS similarity
  FROM bot_tools
  WHERE bot_tools.embedding IS NOT NULL
  ORDER BY bot_tools.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function to match entities by embedding similarity
CREATE OR REPLACE FUNCTION match_entities (
  query_embedding vector(1024),
  match_threshold float,
  match_count int,
  match_context_id uuid
)
RETURNS TABLE (
  id uuid,
  name text,
  type text,
  description text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    entities.id,
    entities.name,
    entities.type,
    entities.description,
    entities.metadata,
    1 - (entities.embedding <=> query_embedding) AS similarity
  FROM entities
  WHERE entities.context_id = match_context_id
    AND 1 - (entities.embedding <=> query_embedding) > match_threshold
  ORDER BY entities.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
