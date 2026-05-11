-- Souvella initial Supabase schema.
-- Run this file in the Supabase SQL Editor after creating your project.
-- It is safe to run again while prototyping; policies and functions are replaced.

create extension if not exists pgcrypto;

create table if not exists public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.circle_members (
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  nickname text,
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

alter table public.circle_members add column if not exists nickname text;

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'photo', 'voice')),
  title text not null,
  note text,
  content_base64 text,
  content_mime_type text,
  media_url text,
  memory_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.memories add column if not exists kind text not null default 'text';
alter table public.memories add column if not exists content_base64 text;
alter table public.memories add column if not exists content_mime_type text;
alter table public.memories add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'memories_kind_check'
  ) then
    alter table public.memories
    add constraint memories_kind_check check (kind in ('text', 'photo', 'voice'));
  end if;
end;
$$;

create unique index if not exists memories_one_per_user_per_day
on public.memories (circle_id, author_id, memory_date);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_memories_updated_at on public.memories;
create trigger set_memories_updated_at
before update on public.memories
for each row
execute function public.set_updated_at();

alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.memories enable row level security;

drop policy if exists "Members can read their circles" on public.circles;
drop policy if exists "Users can create circles for themselves" on public.circles;
drop policy if exists "Circle owners can update their circles" on public.circles;
drop policy if exists "Users can read their own memberships" on public.circle_members;
drop policy if exists "Users can read memberships in their circles" on public.circle_members;
drop policy if exists "Users can add themselves to circles" on public.circle_members;
drop policy if exists "Members can read memories in their circles" on public.memories;
drop policy if exists "Members can create memories in their circles" on public.memories;
drop policy if exists "Authors can update their memories" on public.memories;
drop policy if exists "Authors can delete their memories" on public.memories;

create policy "Members can read their circles"
on public.circles
for select
to authenticated
using (
  exists (
    select 1
    from public.circle_members
    where circle_members.circle_id = circles.id
      and circle_members.user_id = auth.uid()
  )
);

create policy "Circle owners can update their circles"
on public.circles
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

create policy "Users can read their own memberships"
on public.circle_members
for select
to authenticated
using (user_id = auth.uid());

create policy "Members can read memories in their circles"
on public.memories
for select
to authenticated
using (
  exists (
    select 1
    from public.circle_members
    where circle_members.circle_id = memories.circle_id
      and circle_members.user_id = auth.uid()
  )
);

create policy "Members can create memories in their circles"
on public.memories
for insert
to authenticated
with check (
  author_id = auth.uid()
  and exists (
    select 1
    from public.circle_members
    where circle_members.circle_id = memories.circle_id
      and circle_members.user_id = auth.uid()
  )
);

create policy "Authors can update their memories"
on public.memories
for update
to authenticated
using (author_id = auth.uid())
with check (author_id = auth.uid());

create policy "Authors can delete their memories"
on public.memories
for delete
to authenticated
using (author_id = auth.uid());

drop function if exists public.upload_daily_memory(uuid, text, text, text, text);
drop function if exists public.upload_daily_memory(uuid, text, text, text, text, text);

create or replace function public.upload_daily_memory(
  circle_id_input uuid,
  kind_input text,
  title_input text,
  note_input text,
  content_base64_input text,
  content_mime_type_input text default null,
  memory_date_input date default current_date
)
returns public.memories
language plpgsql
security definer
set search_path = public
as $$
declare
  new_memory public.memories;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to upload a memory.';
  end if;

  if kind_input not in ('text', 'photo', 'voice') then
    raise exception 'Memory kind must be text, photo, or voice.';
  end if;

  if not exists (
    select 1
    from public.circle_members
    where circle_id = circle_id_input
      and user_id = auth.uid()
  ) then
    raise exception 'You are not a member of this circle.';
  end if;

  if exists (
    select 1
    from public.memories
    where circle_id = circle_id_input
      and author_id = auth.uid()
      and memory_date = memory_date_input
  ) then
    raise exception 'You already uploaded a memory today.';
  end if;

  insert into public.memories (
    circle_id,
    author_id,
    kind,
    title,
    note,
    content_base64,
    content_mime_type,
    memory_date
  )
  values (
    circle_id_input,
    auth.uid(),
    kind_input,
    coalesce(nullif(trim(title_input), ''), 'Today''s memory'),
    nullif(trim(note_input), ''),
    content_base64_input,
    nullif(trim(content_mime_type_input), ''),
    memory_date_input
  )
  returning * into new_memory;

  return new_memory;
end;
$$;

create or replace function public.update_circle_nickname(
  circle_id_input uuid,
  nickname_input text
)
returns public.circle_members
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_membership public.circle_members;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to update a nickname.';
  end if;

  update public.circle_members
  set nickname = nullif(trim(nickname_input), '')
  where circle_id = circle_id_input
    and user_id = auth.uid()
  returning * into updated_membership;

  if updated_membership.circle_id is null then
    raise exception 'You are not a member of this circle.';
  end if;

  return updated_membership;
end;
$$;

create or replace function public.get_memory_gems(circle_id_input uuid, gem_count int default 5)
returns setof public.memories
language sql
security definer
set search_path = public
as $$
  select memories.*
  from public.memories
  where memories.circle_id = circle_id_input
    and memories.memory_date < current_date
    and exists (
      select 1
      from public.circle_members
      where circle_members.circle_id = circle_id_input
        and circle_members.user_id = auth.uid()
    )
  order by random()
  limit least(greatest(gem_count, 1), 20);
$$;

create or replace function public.create_memory_circle(circle_name text)
returns public.circles
language plpgsql
security definer
set search_path = public
as $$
declare
  new_circle public.circles;
  new_invite_code text;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to create a memory circle.';
  end if;

  if nullif(trim(circle_name), '') is null then
    raise exception 'Circle name is required.';
  end if;

  loop
    new_invite_code := substr(upper(replace(gen_random_uuid()::text, '-', '')), 1, 6);
    exit when not exists (
      select 1
      from public.circles
      where invite_code = new_invite_code
    );
  end loop;

  insert into public.circles (name, invite_code, created_by)
  values (trim(circle_name), new_invite_code, auth.uid())
  returning * into new_circle;

  insert into public.circle_members (circle_id, user_id, role)
  values (new_circle.id, auth.uid(), 'owner')
  on conflict (circle_id, user_id) do update
  set role = excluded.role;

  return new_circle;
end;
$$;

create or replace function public.join_memory_circle(invite_code_input text)
returns public.circles
language plpgsql
security definer
set search_path = public
as $$
declare
  joined_circle public.circles;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to join a memory circle.';
  end if;

  select *
  into joined_circle
  from public.circles
  where invite_code = upper(trim(invite_code_input));

  if joined_circle.id is null then
    raise exception 'Invite code not found.';
  end if;

  insert into public.circle_members (circle_id, user_id, role)
  values (joined_circle.id, auth.uid(), 'member')
  on conflict (circle_id, user_id) do nothing;

  return joined_circle;
end;
$$;

revoke all on function public.create_memory_circle(text) from public;
revoke all on function public.join_memory_circle(text) from public;
revoke all on function public.upload_daily_memory(uuid, text, text, text, text, text, date) from public;
revoke all on function public.update_circle_nickname(uuid, text) from public;
revoke all on function public.get_memory_gems(uuid, int) from public;

grant execute on function public.create_memory_circle(text) to authenticated;
grant execute on function public.join_memory_circle(text) to authenticated;
grant execute on function public.upload_daily_memory(uuid, text, text, text, text, text, date) to authenticated;
grant execute on function public.update_circle_nickname(uuid, text) to authenticated;
grant execute on function public.get_memory_gems(uuid, int) to authenticated;
