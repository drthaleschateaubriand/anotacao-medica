-- ANOTAÇÃO MÉDICA — esquema (todas as tabelas com prefixo am_, isoladas de qualquer outro app no mesmo projeto).
-- Todas as tabelas são PRIVADAS: RLS ligado e forçado, nenhuma policy, REVOKE para anon/authenticated/public.
-- O acesso acontece apenas via Edge Functions (am-*) com a service role.

create extension if not exists pgcrypto with schema extensions;

create table public.am_server_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Conta ÚNICA (dono). A senha NUNCA é guardada em texto: só PBKDF2-SHA256 (sal próprio + pepper do servidor).
create table public.am_users (
  id uuid primary key default gen_random_uuid(),
  pw_hash text,                       -- "pbkdf2$<iterações>$<sal hex>$<hash hex>"
  is_owner boolean not null default true,
  pw_changed_at timestamptz,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index am_users_single_owner on public.am_users ((true)) where is_owner;

create table public.am_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.am_users(id) on delete cascade,
  access_hash text not null unique,
  access_expires_at timestamptz not null,
  refresh_hash text not null unique,
  prev_refresh_hash text,
  refresh_expires_at timestamptz not null,
  rotated_at timestamptz,
  persistent boolean not null default false,
  device_name text not null default 'Dispositivo',
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index am_sessions_user_idx on public.am_sessions(user_id);
create index am_sessions_prev_refresh_idx on public.am_sessions(prev_refresh_hash) where prev_refresh_hash is not null;

create table public.am_preferences (
  user_id uuid primary key references public.am_users(id) on delete cascade,
  theme text not null default 'system' check (theme in ('system','light','dark')),
  font_size text not null default 'md' check (font_size in ('sm','md','lg')),
  language text not null default 'pt-BR',
  memory_enabled boolean not null default true,
  default_model text not null default 'auto',
  auto_speak boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.am_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.am_users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 200),
  instructions text not null check (char_length(btrim(instructions)) between 1 and 4000),
  emoji text check (emoji is null or char_length(emoji) <= 8),
  preferred_model text not null default 'auto'
    check (preferred_model = 'auto' or preferred_model ~ '^[a-z]{3,20}\|[A-Za-z0-9._:/-]{1,100}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index am_agents_user_idx on public.am_agents(user_id, created_at);

-- SKILLS: instruções/padrões reutilizáveis. Podem ser globais (is_global) e/ou anexadas a agentes.
create table public.am_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.am_users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 200),
  instructions text not null check (char_length(btrim(instructions)) between 1 and 4000),
  preferred_model text not null default 'auto'
    check (preferred_model = 'auto' or preferred_model ~ '^[a-z]{3,20}\|[A-Za-z0-9._:/-]{1,100}$'),
  is_global boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index am_skills_user_idx on public.am_skills(user_id, created_at);

create table public.am_agent_skills (
  agent_id uuid not null references public.am_agents(id) on delete cascade,
  skill_id uuid not null references public.am_skills(id) on delete cascade,
  user_id uuid not null references public.am_users(id) on delete cascade,
  position integer not null default 0,
  primary key (agent_id, skill_id)
);
create index am_agent_skills_skill_idx on public.am_agent_skills(skill_id);

create table public.am_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.am_users(id) on delete cascade,
  agent_id uuid references public.am_agents(id) on delete set null,
  title text not null default 'Nova conversa',
  pinned boolean not null default false,
  summary text,
  summary_upto bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index am_conversations_user_idx on public.am_conversations(user_id, updated_at desc);
create index am_conversations_agent_idx on public.am_conversations(agent_id) where agent_id is not null;

create table public.am_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  conversation_id uuid not null references public.am_conversations(id) on delete cascade,
  user_id uuid not null references public.am_users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  provider text,
  model text,
  fallback_used boolean not null default false,
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz not null default now()
);
create index am_messages_conv_idx on public.am_messages(conversation_id, seq);
create index am_messages_user_idx on public.am_messages(user_id);

create table public.am_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.am_users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index am_memories_user_idx on public.am_memories(user_id);

-- NOTAS (bloco de notas): texto livre, salvamento automático pelo app.
create table public.am_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.am_users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 200),
  content text not null default '' check (char_length(content) <= 100000),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index am_notes_user_idx on public.am_notes(user_id, pinned desc, updated_at desc);

create table public.am_provider_usage (
  provider text not null,
  model text not null,
  day date not null,
  requests integer not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  errors integer not null default 0,
  rate_limited integer not null default 0,
  limit_info jsonb,
  updated_at timestamptz not null default now(),
  primary key (provider, model, day)
);

create table public.am_provider_state (
  provider text not null,
  model text not null,
  cooldown_until timestamptz,
  last_status integer,
  last_error text,
  consecutive_failures integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (provider, model)
);

create table public.am_rate_limits (
  scope text not null,
  key text not null,
  window_start timestamptz not null default now(),
  count integer not null default 0,
  strikes integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (scope, key)
);

create table public.am_auth_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,
  ok boolean not null,
  ip_hash text,
  reason text
);
create index am_auth_attempts_at_idx on public.am_auth_attempts(at);

do $$
declare t text;
begin
  foreach t in array array['am_server_secrets','am_users','am_sessions','am_preferences','am_agents','am_skills','am_agent_skills','am_conversations','am_messages','am_memories','am_notes','am_provider_usage','am_provider_state','am_rate_limits','am_auth_attempts']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on sequence public.am_messages_seq_seq to service_role;
grant usage, select on sequence public.am_auth_attempts_id_seq to service_role;
revoke all on sequence public.am_messages_seq_seq from anon, authenticated, public;
revoke all on sequence public.am_auth_attempts_id_seq from anon, authenticated, public;

-- Pepper próprio (gerado no banco; nunca vai para o Git nem para o front).
insert into public.am_server_secrets(name, value)
values ('PEPPER', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;
