begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  website_url text not null check (
    char_length(website_url) <= 2048
    and website_url ~ '^https?://(\[[0-9A-Fa-f:.]+\]|[^[:space:]/?#@:]+)(:[0-9]+)?([/?#][^[:space:]]*)?$'
  ),
  description text check (description is null or char_length(description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_created_idx on public.projects(owner_id, created_at desc);

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger projects_updated_at before update on public.projects
for each row execute function public.set_updated_at();

create function public.create_user_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name)
  values (new.id, case when jsonb_typeof(new.raw_user_meta_data -> 'full_name') = 'string'
    then nullif(left(btrim(new.raw_user_meta_data ->> 'full_name'), 120), '') else null end)
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger auth_user_profile after insert on auth.users
for each row execute function public.create_user_profile();
-- Existing auth users get profiles too; confirmation is not required for record creation.
insert into public.profiles(id) select id from auth.users on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;

revoke all on public.profiles, public.projects from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update(full_name) on public.profiles to authenticated;
grant select, delete on public.projects to authenticated;
grant insert(name, website_url, description) on public.projects to authenticated;
grant update(name, website_url, description) on public.projects to authenticated;

create policy profiles_select_own on public.profiles for select to authenticated
using ((select auth.uid()) = id and not coalesce((select auth.jwt()) ->> 'is_anonymous', 'false')::boolean);
create policy profiles_update_own on public.profiles for update to authenticated
using ((select auth.uid()) = id and not coalesce((select auth.jwt()) ->> 'is_anonymous', 'false')::boolean)
with check ((select auth.uid()) = id and not coalesce((select auth.jwt()) ->> 'is_anonymous', 'false')::boolean);

create policy projects_select_own on public.projects for select to authenticated
using ((select auth.uid()) = owner_id and not coalesce((select auth.jwt()) ->> 'is_anonymous', 'false')::boolean);
create policy projects_insert_own on public.projects for insert to authenticated
with check ((select auth.uid()) = owner_id and not coalesce((select auth.jwt()) ->> 'is_anonymous', 'false')::boolean);
create policy projects_update_own on public.projects for update to authenticated
using ((select auth.uid()) = owner_id and not coalesce((select auth.jwt()) ->> 'is_anonymous', 'false')::boolean)
with check ((select auth.uid()) = owner_id and not coalesce((select auth.jwt()) ->> 'is_anonymous', 'false')::boolean);
create policy projects_delete_own on public.projects for delete to authenticated
using ((select auth.uid()) = owner_id and not coalesce((select auth.jwt()) ->> 'is_anonymous', 'false')::boolean);

-- Trigger functions are never public RPC entry points.
revoke all on function public.create_user_profile() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
commit;
