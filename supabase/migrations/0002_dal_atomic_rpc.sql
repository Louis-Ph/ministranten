-- Migration 0002 — atomic RPC functions used by the Node DAL.
--
-- Every function below runs in a single transaction (Postgres functions are
-- atomic by default) and is granted to `service_role` only. The Node layer
-- calls them via PostgREST `POST /rest/v1/rpc/<fn>`.
--
-- Naming:
--   replace_*           → wipe + insert, used by admin import / reset.
--   upsert_*            → insert-or-update one aggregate.
--   increment_user_stat → safe concurrent counter.
--   set_user_stat       → admin override of one stat field.
--
-- All functions are SECURITY DEFINER so they can write through the deny-all
-- RLS policies. They run as the schema owner (`postgres`).

begin;

-- ---------------------------------------------------------------------------
-- 1. increment_user_stat — race-free counter update.
-- ---------------------------------------------------------------------------

create or replace function public.increment_user_stat(
  p_user_id uuid,
  p_field   text,
  p_delta   integer
) returns public.user_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.user_stats;
begin
  if p_field not in ('attended', 'cancelled', 'lateCancelled') then
    raise exception 'invalid stat field: %', p_field
      using errcode = '22023';
  end if;

  -- Insert a zero row if the user has no stats yet, then update atomically.
  insert into public.user_stats (user_id) values (p_user_id)
    on conflict (user_id) do nothing;

  if p_field = 'attended' then
    update public.user_stats
      set attended = greatest(0, attended + p_delta)
      where user_id = p_user_id
      returning * into result;
  elsif p_field = 'cancelled' then
    update public.user_stats
      set cancelled = greatest(0, cancelled + p_delta)
      where user_id = p_user_id
      returning * into result;
  else
    update public.user_stats
      set late_cancelled = greatest(0, late_cancelled + p_delta)
      where user_id = p_user_id
      returning * into result;
  end if;

  return result;
end;
$$;

revoke all on function public.increment_user_stat(uuid, text, integer) from public;
grant execute on function public.increment_user_stat(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 2. set_user_stat — atomic absolute-set of one field.
-- ---------------------------------------------------------------------------

create or replace function public.set_user_stat(
  p_user_id uuid,
  p_field   text,
  p_value   integer
) returns public.user_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.user_stats;
  v integer := greatest(0, coalesce(p_value, 0));
begin
  if p_field not in ('attended', 'cancelled', 'lateCancelled') then
    raise exception 'invalid stat field: %', p_field
      using errcode = '22023';
  end if;

  insert into public.user_stats (user_id, attended, cancelled, late_cancelled)
    values (
      p_user_id,
      case when p_field = 'attended' then v else 0 end,
      case when p_field = 'cancelled' then v else 0 end,
      case when p_field = 'lateCancelled' then v else 0 end
    )
    on conflict (user_id) do update set
      attended       = case when p_field = 'attended'       then v else public.user_stats.attended end,
      cancelled      = case when p_field = 'cancelled'      then v else public.user_stats.cancelled end,
      late_cancelled = case when p_field = 'lateCancelled'  then v else public.user_stats.late_cancelled end
    returning * into result;

  return result;
end;
$$;

revoke all on function public.set_user_stat(uuid, text, integer) from public;
grant execute on function public.set_user_stat(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. replace_stats — atomic full reset of user_stats.
-- ---------------------------------------------------------------------------

create or replace function public.replace_stats(
  p_stats jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Inside this function, all statements share one transaction. The window
  -- where the table is empty NEVER becomes visible to concurrent readers.
  delete from public.user_stats;

  insert into public.user_stats (user_id, attended, cancelled, late_cancelled)
  select
    key::uuid,
    coalesce((value->>'attended')::integer, 0),
    coalesce((value->>'cancelled')::integer, 0),
    coalesce((value->>'lateCancelled')::integer, 0)
  from jsonb_each(coalesce(p_stats, '{}'::jsonb))
  where key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (select 1 from public.app_users u where u.user_id = key::uuid);
end;
$$;

revoke all on function public.replace_stats(jsonb) from public;
grant execute on function public.replace_stats(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. replace_attendees_of — atomic "wipe + reinsert" for one service.
-- ---------------------------------------------------------------------------

create or replace function public.replace_attendees_of(
  p_service_id text,
  p_attendees  jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.service_events where service_id = p_service_id) then
    raise exception 'service not found: %', p_service_id
      using errcode = 'P0002';
  end if;

  delete from public.service_attendees where service_id = p_service_id;

  insert into public.service_attendees (service_id, user_id, signed_up_at)
  select
    p_service_id,
    (elem->>'user_id')::uuid,
    coalesce((elem->>'signed_up_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_attendees, '[]'::jsonb)) as elem
  where elem->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (select 1 from public.app_users u where u.user_id = (elem->>'user_id')::uuid);
end;
$$;

revoke all on function public.replace_attendees_of(text, jsonb) from public;
grant execute on function public.replace_attendees_of(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. upsert_service_with_attendees — atomic single-aggregate write.
-- ---------------------------------------------------------------------------

create or replace function public.upsert_service_with_attendees(
  p_service_id text,
  p_service    jsonb,
  p_attendees  jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.service_events (
    service_id, title, description, start_at, deadline_days, min_slots,
    color, replacement_needed, stats_applied, created_by, created_at
  ) values (
    p_service_id,
    coalesce(p_service->>'title', ''),
    coalesce(p_service->>'description', ''),
    coalesce((p_service->>'start_at')::timestamptz, now()),
    coalesce((p_service->>'deadline_days')::integer, 0),
    coalesce((p_service->>'min_slots')::integer, 1),
    case when coalesce(p_service->>'color', '') ~ '^#[0-9A-Fa-f]{6}$'
         then p_service->>'color' else '#0066cc' end,
    coalesce((p_service->>'replacement_needed')::boolean, false),
    coalesce((p_service->>'stats_applied')::boolean, false),
    case when coalesce(p_service->>'created_by', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         then (p_service->>'created_by')::uuid else null end,
    coalesce((p_service->>'created_at')::timestamptz, now())
  )
  on conflict (service_id) do update set
    title              = excluded.title,
    description        = excluded.description,
    start_at           = excluded.start_at,
    deadline_days      = excluded.deadline_days,
    min_slots          = excluded.min_slots,
    color              = excluded.color,
    replacement_needed = excluded.replacement_needed,
    stats_applied      = excluded.stats_applied,
    created_by         = excluded.created_by;

  -- Replace attendees of THIS service only — same transaction.
  delete from public.service_attendees where service_id = p_service_id;

  insert into public.service_attendees (service_id, user_id, signed_up_at)
  select
    p_service_id,
    (elem->>'user_id')::uuid,
    coalesce((elem->>'signed_up_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_attendees, '[]'::jsonb)) as elem
  where elem->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (select 1 from public.app_users u where u.user_id = (elem->>'user_id')::uuid);
end;
$$;

revoke all on function public.upsert_service_with_attendees(text, jsonb, jsonb) from public;
grant execute on function public.upsert_service_with_attendees(text, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6. replace_services — atomic full reset of services + attendees.
--
-- The argument is the domain-shaped `services` map (camelCase keys), exactly
-- like `RootState.services`. We do the column rename inside the function
-- so the Node mapper doesn't have to invent a "DB JSON" intermediate format.
-- ---------------------------------------------------------------------------

create or replace function public.replace_services(
  p_services jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.service_attendees;
  delete from public.service_events;

  insert into public.service_events (
    service_id, title, description, start_at, deadline_days, min_slots,
    color, replacement_needed, stats_applied, created_by, created_at
  )
  select
    key,
    coalesce(value->>'title', ''),
    coalesce(value->>'description', ''),
    to_timestamp(coalesce((value->>'startMs')::double precision, extract(epoch from now()) * 1000) / 1000),
    coalesce((value->>'deadlineDays')::integer, 0),
    coalesce((value->>'minSlots')::integer, 1),
    case when coalesce(value->>'color', '') ~ '^#[0-9A-Fa-f]{6}$' then value->>'color' else '#0066cc' end,
    coalesce((value->>'replacement')::boolean, false),
    coalesce((value->>'statsApplied')::boolean, false),
    case when coalesce(value->>'createdBy', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (select 1 from public.app_users u where u.user_id = (value->>'createdBy')::uuid)
      then (value->>'createdBy')::uuid else null end,
    to_timestamp(coalesce((value->>'createdAt')::double precision, extract(epoch from now()) * 1000) / 1000)
  from jsonb_each(coalesce(p_services, '{}'::jsonb));

  insert into public.service_attendees (service_id, user_id, signed_up_at)
  select
    service.key,
    attendee.key::uuid,
    to_timestamp(coalesce((attendee.value->>'ts')::double precision, extract(epoch from now()) * 1000) / 1000)
  from jsonb_each(coalesce(p_services, '{}'::jsonb)) as service(key, value)
  cross join lateral jsonb_each(coalesce(service.value->'attendees', '{}'::jsonb)) as attendee(key, value)
  where attendee.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (select 1 from public.app_users u where u.user_id = attendee.key::uuid);
end;
$$;

revoke all on function public.replace_services(jsonb) from public;
grant execute on function public.replace_services(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 7. replace_chat — atomic full reset of chat_messages.
-- ---------------------------------------------------------------------------

create or replace function public.replace_chat(
  p_chat jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.chat_messages;

  insert into public.chat_messages (
    message_id, author_user_id, body, system, triggered_by, created_at
  )
  select
    key,
    case when coalesce((value->>'system')::boolean, false) then null
         when coalesce(value->>'uid', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              and exists (select 1 from public.app_users u where u.user_id = (value->>'uid')::uuid)
         then (value->>'uid')::uuid else null end,
    value->>'text',
    coalesce((value->>'system')::boolean, false),
    case when coalesce(value->>'triggeredBy', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              and exists (select 1 from public.app_users u where u.user_id = (value->>'triggeredBy')::uuid)
         then (value->>'triggeredBy')::uuid else null end,
    to_timestamp(coalesce((value->>'ts')::double precision, extract(epoch from now()) * 1000) / 1000)
  from jsonb_each(coalesce(p_chat, '{}'::jsonb))
  where value ? 'text'
    and length(value->>'text') between 1 and 2000
    and (
      coalesce((value->>'system')::boolean, false)
      or (
        coalesce(value->>'uid', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and exists (select 1 from public.app_users u where u.user_id = (value->>'uid')::uuid)
      )
    );
end;
$$;

revoke all on function public.replace_chat(jsonb) from public;
grant execute on function public.replace_chat(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 8. replace_root_state — single-shot atomic import of users/services/stats/chat.
--
-- Used by dev-role admin import. Replaces every aggregate in one transaction:
-- if any single sub-statement fails, nothing is committed.
-- ---------------------------------------------------------------------------

create or replace function public.replace_root_state(
  p_root jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_users jsonb := coalesce(p_root->'users', '{}'::jsonb);
begin
  -- 1) Users — upsert (we never wipe app_users to preserve FK integrity).
  insert into public.app_users (
    user_id, username, email, display_name, role_id, must_change_password, created_at
  )
  select
    key::uuid,
    value->>'username',
    coalesce(value->>'email', lower(value->>'username') || '@minis-wettstetten.de'),
    coalesce(value->>'displayName', value->>'username'),
    case when value->>'role' in ('user', 'admin', 'dev') then value->>'role' else 'user' end,
    coalesce((value->>'mustChangePassword')::boolean, true),
    to_timestamp(coalesce((value->>'createdAt')::double precision, extract(epoch from now()) * 1000) / 1000)
  from jsonb_each(v_users)
  where key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and value ? 'username'
  on conflict (user_id) do update set
    username             = excluded.username,
    email                = excluded.email,
    display_name         = excluded.display_name,
    role_id              = excluded.role_id,
    must_change_password = excluded.must_change_password;

  -- 2) Stats / Services / Chat — delegate to the per-aggregate replace functions.
  perform public.replace_stats(coalesce(p_root->'stats', '{}'::jsonb));
  perform public.replace_services(coalesce(p_root->'services', '{}'::jsonb));
  perform public.replace_chat(coalesce(p_root->'chat', '{}'::jsonb));
end;
$$;

revoke all on function public.replace_root_state(jsonb) from public;
grant execute on function public.replace_root_state(jsonb) to service_role;

commit;
