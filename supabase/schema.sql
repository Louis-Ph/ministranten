begin;

create table if not exists public.app_roles (
  role_id text primary key,
  role_rank smallint not null unique,
  display_label text not null,
  check (role_id in ('user', 'admin', 'dev'))
);

insert into public.app_roles (role_id, role_rank, display_label)
values
  ('user', 1, 'Ministrant'),
  ('admin', 2, 'Oberministrant'),
  ('dev', 3, 'Entwickler')
on conflict (role_id) do update set
  role_rank = excluded.role_rank,
  display_label = excluded.display_label;

create table if not exists public.app_users (
  user_id uuid primary key,
  username text not null unique,
  email text not null unique,
  display_name text not null,
  role_id text not null references public.app_roles(role_id),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  check (username ~ '^[a-z0-9._-]{2,40}$')
);

create table if not exists public.service_events (
  service_id text primary key,
  title text not null,
  description text not null default '',
  start_at timestamptz not null,
  deadline_days integer not null default 0 check (deadline_days between 0 and 30),
  min_slots integer not null default 1 check (min_slots between 1 and 50),
  color text not null default '#0066cc' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  replacement_needed boolean not null default false,
  stats_applied boolean not null default false,
  created_by uuid references public.app_users(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.service_attendees (
  service_id text not null references public.service_events(service_id) on delete cascade,
  user_id uuid not null references public.app_users(user_id) on delete cascade,
  signed_up_at timestamptz not null default now(),
  primary key (service_id, user_id)
);

create table if not exists public.user_stats (
  user_id uuid primary key references public.app_users(user_id) on delete cascade,
  attended integer not null default 0 check (attended >= 0),
  cancelled integer not null default 0 check (cancelled >= 0),
  late_cancelled integer not null default 0 check (late_cancelled >= 0)
);

create table if not exists public.chat_messages (
  message_id text primary key,
  author_user_id uuid references public.app_users(user_id) on delete set null,
  body text not null,
  system boolean not null default false,
  triggered_by uuid references public.app_users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  check (length(body) between 1 and 2000),
  check ((system = true and author_user_id is null) or (system = false and author_user_id is not null))
);

create index if not exists idx_service_events_start_at on public.service_events(start_at);
create index if not exists idx_service_attendees_user_id on public.service_attendees(user_id);
create index if not exists idx_chat_messages_created_at on public.chat_messages(created_at);

alter table public.app_roles enable row level security;
alter table public.app_users enable row level security;
alter table public.service_events enable row level security;
alter table public.service_attendees enable row level security;
alter table public.user_stats enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists app_roles_no_direct_client_access on public.app_roles;
drop policy if exists app_users_no_direct_client_access on public.app_users;
drop policy if exists service_events_no_direct_client_access on public.service_events;
drop policy if exists service_attendees_no_direct_client_access on public.service_attendees;
drop policy if exists user_stats_no_direct_client_access on public.user_stats;
drop policy if exists chat_messages_no_direct_client_access on public.chat_messages;

create policy app_roles_no_direct_client_access on public.app_roles for all using (false) with check (false);
create policy app_users_no_direct_client_access on public.app_users for all using (false) with check (false);
create policy service_events_no_direct_client_access on public.service_events for all using (false) with check (false);
create policy service_attendees_no_direct_client_access on public.service_attendees for all using (false) with check (false);
create policy user_stats_no_direct_client_access on public.user_stats for all using (false) with check (false);
create policy chat_messages_no_direct_client_access on public.chat_messages for all using (false) with check (false);

revoke all on table public.app_roles from anon, authenticated;
revoke all on table public.app_users from anon, authenticated;
revoke all on table public.service_events from anon, authenticated;
revoke all on table public.service_attendees from anon, authenticated;
revoke all on table public.user_stats from anon, authenticated;
revoke all on table public.chat_messages from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.app_roles to service_role;
grant select, insert, update, delete on table public.app_users to service_role;
grant select, insert, update, delete on table public.service_events to service_role;
grant select, insert, update, delete on table public.service_attendees to service_role;
grant select, insert, update, delete on table public.user_stats to service_role;
grant select, insert, update, delete on table public.chat_messages to service_role;

do $$
declare
  root jsonb;
begin
  if to_regclass('public.app_state') is null then
    return;
  end if;

  execute 'select data from public.app_state where id = $1' into root using 'main';
  if root is null then
    return;
  end if;

  insert into public.app_users (user_id, username, email, display_name, role_id, must_change_password, created_at)
  select
    key::uuid,
    value->>'username',
    coalesce(value->>'email', lower(value->>'username') || '@minis-wettstetten.de'),
    coalesce(value->>'displayName', value->>'username'),
    case when value->>'role' in ('user', 'admin', 'dev') then value->>'role' else 'user' end,
    coalesce((value->>'mustChangePassword')::boolean, true),
    to_timestamp(coalesce((value->>'createdAt')::double precision, extract(epoch from now()) * 1000) / 1000)
  from jsonb_each(coalesce(root->'users', '{}'::jsonb))
  where key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and value ? 'username'
  on conflict (user_id) do update set
    username = excluded.username,
    email = excluded.email,
    display_name = excluded.display_name,
    role_id = excluded.role_id,
    must_change_password = excluded.must_change_password;

  insert into public.service_events (service_id, title, description, start_at, deadline_days, min_slots, color, replacement_needed, stats_applied, created_by, created_at)
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
  from jsonb_each(coalesce(root->'services', '{}'::jsonb))
  on conflict (service_id) do update set
    title = excluded.title,
    description = excluded.description,
    start_at = excluded.start_at,
    deadline_days = excluded.deadline_days,
    min_slots = excluded.min_slots,
    color = excluded.color,
    replacement_needed = excluded.replacement_needed,
    stats_applied = excluded.stats_applied,
    created_by = excluded.created_by;

  insert into public.service_attendees (service_id, user_id, signed_up_at)
  select
    service.key,
    attendee.key::uuid,
    to_timestamp(coalesce((attendee.value->>'ts')::double precision, extract(epoch from now()) * 1000) / 1000)
  from jsonb_each(coalesce(root->'services', '{}'::jsonb)) as service(key, value)
  cross join lateral jsonb_each(coalesce(service.value->'attendees', '{}'::jsonb)) as attendee(key, value)
  where attendee.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (select 1 from public.app_users u where u.user_id = attendee.key::uuid)
  on conflict (service_id, user_id) do update set
    signed_up_at = excluded.signed_up_at;

  insert into public.user_stats (user_id, attended, cancelled, late_cancelled)
  select
    key::uuid,
    coalesce((value->>'attended')::integer, 0),
    coalesce((value->>'cancelled')::integer, 0),
    coalesce((value->>'lateCancelled')::integer, 0)
  from jsonb_each(coalesce(root->'stats', '{}'::jsonb))
  where key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (select 1 from public.app_users u where u.user_id = key::uuid)
  on conflict (user_id) do update set
    attended = excluded.attended,
    cancelled = excluded.cancelled,
    late_cancelled = excluded.late_cancelled;

  insert into public.chat_messages (message_id, author_user_id, body, system, triggered_by, created_at)
  select
    key,
    case when coalesce(value->>'system', 'false')::boolean then null
      when coalesce(value->>'uid', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and exists (select 1 from public.app_users u where u.user_id = (value->>'uid')::uuid)
      then (value->>'uid')::uuid else null end,
    value->>'text',
    coalesce((value->>'system')::boolean, false),
    case when coalesce(value->>'triggeredBy', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (select 1 from public.app_users u where u.user_id = (value->>'triggeredBy')::uuid)
      then (value->>'triggeredBy')::uuid else null end,
    to_timestamp(coalesce((value->>'ts')::double precision, extract(epoch from now()) * 1000) / 1000)
  from jsonb_each(coalesce(root->'chat', '{}'::jsonb))
  where value ? 'text'
    and length(value->>'text') between 1 and 2000
    and (
      coalesce((value->>'system')::boolean, false)
      or (
        coalesce(value->>'uid', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and exists (select 1 from public.app_users u where u.user_id = (value->>'uid')::uuid)
      )
    )
  on conflict (message_id) do update set
    author_user_id = excluded.author_user_id,
    body = excluded.body,
    system = excluded.system,
    triggered_by = excluded.triggered_by,
    created_at = excluded.created_at;
end $$;

commit;
