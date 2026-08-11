-- ============================================================================
-- OMNI-CHANNEL SCHEMA (HIVE-MIND Phase 5) - IDEMPOTENT SCRIPT
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- SECTION 0: CLEANUP (Idempotency)
-- ============================================================================

DROP TABLE IF EXISTS public.bot_tools CASCADE;
DROP TABLE IF EXISTS public.reminders CASCADE;
DROP TABLE IF EXISTS public.autonomous_goals CASCADE;
DROP TABLE IF EXISTS public.action_scores CASCADE;
DROP TABLE IF EXISTS public.agent_actions CASCADE;
DROP TABLE IF EXISTS public.relationships CASCADE;
DROP TABLE IF EXISTS public.entities CASCADE;
DROP TABLE IF EXISTS public.facts CASCADE;
DROP TABLE IF EXISTS public.memories CASCADE;
DROP TABLE IF EXISTS public.agent_workspace CASCADE;
DROP TABLE IF EXISTS public.user_warnings CASCADE;
DROP TABLE IF EXISTS public.group_whitelist CASCADE;
DROP TABLE IF EXISTS public.group_member_history CASCADE;
DROP TABLE IF EXISTS public.group_filters CASCADE;
DROP TABLE IF EXISTS public.group_configs CASCADE;
DROP TABLE IF EXISTS public.group_admins CASCADE;
DROP TABLE IF EXISTS public.global_admins CASCADE;
DROP TABLE IF EXISTS public.groups CASCADE;
DROP TABLE IF EXISTS public.user_identities CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- ============================================================================
-- SECTION 1: USERS (Contacts) & IDENTITIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  username text,
  interaction_count bigint DEFAULT 0,
  language varchar(10),
  timezone varchar(50),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  hash character varying,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.user_identities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL,
  platform_user_id text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_identities_pkey PRIMARY KEY (id),
  CONSTRAINT user_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT user_identities_platform_user_id_key UNIQUE (platform, platform_user_id)
);

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
  CONSTRAINT groups_platform_group_id_key UNIQUE (platform, platform_group_id),
  CONSTRAINT groups_founder_id_fkey FOREIGN KEY (founder_id) REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.global_admins (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id uuid NOT NULL,
  role text CHECK (role = ANY (ARRAY['owner'::text, 'moderator'::text])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT global_admins_pkey PRIMARY KEY (id),
  CONSTRAINT global_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT global_admins_user_id_key UNIQUE (user_id)
);

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
  CONSTRAINT agent_workspace_pkey PRIMARY KEY (id),
  CONSTRAINT agent_workspace_context_key_unique UNIQUE (context_id, key)
);

CREATE TABLE IF NOT EXISTS public.facts (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  context_id uuid NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT facts_pkey PRIMARY KEY (id)
);

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
