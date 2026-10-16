-- ANOTAÇÃO MÉDICA — funções auxiliares atômicas, executáveis SOMENTE pela service role.

create or replace function public.am_rl_hit(
  p_scope text, p_key text, p_max integer, p_window integer, p_block integer, p_max_block integer default 86400
) returns table(allowed boolean, retry_after integer)
language plpgsql
set search_path = ''
as $$
declare
  r public.am_rate_limits%rowtype;
  n timestamptz := now();
  wait integer;
begin
  insert into public.am_rate_limits(scope, key, window_start, count)
  values (p_scope, p_key, n, 0)
  on conflict (scope, key) do nothing;

  select * into r from public.am_rate_limits where scope = p_scope and key = p_key for update;

  -- ainda bloqueado?
  if r.blocked_until is not null and r.blocked_until > n then
    return query select false, greatest(1, ceil(extract(epoch from (r.blocked_until - n)))::integer);
    return;
  end if;

  -- nova janela
  if r.window_start + make_interval(secs => p_window) <= n then
    -- strikes decaem se a janela anterior terminou sem estourar e passou tempo suficiente
    update public.am_rate_limits
       set window_start = n, count = 1,
           strikes = case when r.blocked_until is null or r.blocked_until + make_interval(secs => p_window * 4) < n then 0 else r.strikes end,
           blocked_until = null, updated_at = n
     where scope = p_scope and key = p_key;
    return query select true, 0;
    return;
  end if;

  if r.count + 1 > p_max then
    wait := least(p_max_block, p_block * (2 ^ least(r.strikes, 10))::integer);
    update public.am_rate_limits
       set count = r.count + 1, strikes = r.strikes + 1,
           blocked_until = n + make_interval(secs => wait), updated_at = n
     where scope = p_scope and key = p_key;
    return query select false, wait;
    return;
  end if;

  update public.am_rate_limits set count = r.count + 1, updated_at = n where scope = p_scope and key = p_key;
  return query select true, 0;
end $$;

-- Apenas consulta (sem incrementar): está bloqueado?
create or replace function public.am_rl_peek(p_scope text, p_key text)
returns integer language sql stable set search_path = '' as $$
  select coalesce((select greatest(1, ceil(extract(epoch from (blocked_until - now())))::integer)
                   from public.am_rate_limits
                   where scope = p_scope and key = p_key and blocked_until > now()), 0);
$$;

create or replace function public.am_usage_add(
  p_provider text, p_model text, p_req integer, p_tin integer, p_tout integer,
  p_err integer, p_limited integer, p_info jsonb default null
) returns void language sql set search_path = '' as $$
  insert into public.am_provider_usage(provider, model, day, requests, tokens_in, tokens_out, errors, rate_limited, limit_info, updated_at)
  values (p_provider, p_model, (now() at time zone 'utc')::date, p_req, p_tin, p_tout, p_err, p_limited, p_info, now())
  on conflict (provider, model, day) do update set
    requests = public.am_provider_usage.requests + excluded.requests,
    tokens_in = public.am_provider_usage.tokens_in + excluded.tokens_in,
    tokens_out = public.am_provider_usage.tokens_out + excluded.tokens_out,
    errors = public.am_provider_usage.errors + excluded.errors,
    rate_limited = public.am_provider_usage.rate_limited + excluded.rate_limited,
    limit_info = coalesce(excluded.limit_info, public.am_provider_usage.limit_info),
    updated_at = now();
$$;

create or replace function public.am_housekeeping() returns void language sql set search_path = '' as $$
  delete from public.am_auth_attempts where at < now() - interval '30 days';
  delete from public.am_sessions where refresh_expires_at < now() - interval '7 days' or revoked_at < now() - interval '7 days';
  delete from public.am_rate_limits where updated_at < now() - interval '2 days' and (blocked_until is null or blocked_until < now());
$$;

revoke all on function public.am_rl_hit(text,text,integer,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.am_rl_peek(text,text) from public, anon, authenticated;
revoke all on function public.am_usage_add(text,text,integer,integer,integer,integer,integer,jsonb) from public, anon, authenticated;
revoke all on function public.am_housekeeping() from public, anon, authenticated;
grant execute on function public.am_rl_hit(text,text,integer,integer,integer,integer) to service_role;
grant execute on function public.am_rl_peek(text,text) to service_role;
grant execute on function public.am_usage_add(text,text,integer,integer,integer,integer,integer,jsonb) to service_role;
grant execute on function public.am_housekeeping() to service_role;

-- Lista de notas (sem o texto inteiro): título, prévia de 160 caracteres, fixada, datas. Busca opcional em título e texto.
create or replace function public.am_notes_list(p_user uuid, p_q text default '')
returns table(id uuid, title text, snippet text, pinned boolean, chars integer, created_at timestamptz, updated_at timestamptz)
language sql stable set search_path = '' as $$
  select n.id, n.title, left(regexp_replace(n.content, '\s+', ' ', 'g'), 160), n.pinned, char_length(n.content), n.created_at, n.updated_at
  from public.am_notes n
  where n.user_id = p_user
    and (coalesce(p_q, '') = ''
         or n.title ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
         or n.content ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by n.pinned desc, n.updated_at desc
  limit 2000;
$$;
revoke all on function public.am_notes_list(uuid,text) from public, anon, authenticated;
grant execute on function public.am_notes_list(uuid,text) to service_role;
