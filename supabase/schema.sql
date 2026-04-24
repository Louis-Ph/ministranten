create table if not exists public.app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_state (id, data)
values ('main', '{"users":{},"publicProfiles":{},"services":{},"stats":{},"chat":{}}'::jsonb)
on conflict (id) do nothing;

create or replace function public.touch_app_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_state_touch_updated_at on public.app_state;

create trigger app_state_touch_updated_at
before update on public.app_state
for each row
execute function public.touch_app_state_updated_at();

alter table public.app_state enable row level security;

drop policy if exists app_state_no_direct_client_access on public.app_state;

create policy app_state_no_direct_client_access
on public.app_state
for all
using (false)
with check (false);

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.app_state to service_role;
grant execute on function public.touch_app_state_updated_at() to service_role;
