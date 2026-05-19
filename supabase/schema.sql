-- Souvella initial Supabase schema.
-- Run this file in the Supabase SQL Editor after creating your project.
-- It is safe to run again while prototyping; policies and functions are replaced.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  default_username text,
  avatar_base64 text,
  avatar_mime_type text,
  terms_accepted_at timestamptz,
  privacy_accepted_at timestamptz,
  legal_version text,
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists privacy_accepted_at timestamptz;
alter table public.profiles add column if not exists legal_version text;

create table if not exists public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  avatar_base64 text,
  avatar_mime_type text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.circles add column if not exists avatar_base64 text;
alter table public.circles add column if not exists avatar_mime_type text;

alter table public.circles alter column created_by drop not null;
alter table public.circles drop constraint if exists circles_created_by_fkey;
alter table public.circles
add constraint circles_created_by_fkey
foreign key (created_by) references auth.users(id) on delete set null;

create table if not exists public.circle_members (
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  nickname text,
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

alter table public.circle_members add column if not exists nickname text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'circle_members_role_check'
  ) then
    alter table public.circle_members
    add constraint circle_members_role_check check (role in ('owner', 'admin', 'member'));
  end if;
end;
$$;

update public.circle_members
set role = 'owner'
from public.circles
where circle_members.circle_id = circles.id
  and circle_members.user_id = circles.created_by
  and not exists (
    select 1
    from public.circle_members existing_owner
    where existing_owner.circle_id = circle_members.circle_id
      and existing_owner.role = 'owner'
  );

update public.circle_members
set role = 'owner'
where circle_members.user_id = (
  select candidate.user_id
  from public.circle_members candidate
  where candidate.circle_id = circle_members.circle_id
  order by
    case candidate.role
      when 'admin' then 1
      else 2
    end,
    candidate.joined_at asc
  limit 1
)
and not exists (
  select 1
  from public.circle_members existing_owner
  where existing_owner.circle_id = circle_members.circle_id
    and existing_owner.role = 'owner'
);

create unique index if not exists circle_members_one_owner
on public.circle_members (circle_id)
where role = 'owner';

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

create table if not exists public.memory_likes (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  like_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (memory_id, user_id)
);

create table if not exists public.memory_comments (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.memory_reports (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  circle_id uuid not null references public.circles(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  unique (memory_id, reporter_id)
);

create table if not exists public.circle_join_requests (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  requester_id uuid references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  unique (circle_id, requester_id)
);

alter table public.memories add column if not exists kind text not null default 'text';
alter table public.memories add column if not exists content_base64 text;
alter table public.memories add column if not exists content_mime_type text;
alter table public.memories add column if not exists updated_at timestamptz not null default now();
alter table public.memories add column if not exists deleted_at timestamptz;
alter table public.memories add column if not exists deleted_by uuid references auth.users(id) on delete set null;

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

drop index if exists memories_one_per_user_per_day;
create unique index memories_one_per_user_per_day
on public.memories (circle_id, author_id, memory_date)
where deleted_at is null;

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

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create or replace function public.is_circle_member(circle_id_input uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.circle_members
    where circle_members.circle_id = circle_id_input
      and circle_members.user_id = auth.uid()
  );
$$;

create or replace function public.is_circle_admin(circle_id_input uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.circle_members
    where circle_members.circle_id = circle_id_input
      and circle_members.user_id = auth.uid()
      and circle_members.role in ('owner', 'admin')
  );
$$;

create or replace function public.ensure_circle_has_owner(circle_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.circle_members
    where circle_id = circle_id_input
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.circle_members
    where circle_id = circle_id_input
      and role = 'owner'
  ) then
    return;
  end if;

  update public.circle_members
  set role = 'owner'
  where user_id = (
    select candidate.user_id
    from public.circle_members candidate
    where candidate.circle_id = circle_id_input
    order by
      case candidate.role
        when 'admin' then 1
        else 2
      end,
      candidate.joined_at asc
    limit 1
  )
  and circle_id = circle_id_input;
end;
$$;

create or replace function public.ensure_circle_owner_after_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_circle_has_owner(coalesce(old.circle_id, new.circle_id));
  return null;
end;
$$;

drop trigger if exists ensure_circle_owner_after_delete on public.circle_members;
create trigger ensure_circle_owner_after_delete
after delete on public.circle_members
for each row
execute function public.ensure_circle_owner_after_membership_change();

drop trigger if exists ensure_circle_owner_after_role_update on public.circle_members;
create trigger ensure_circle_owner_after_role_update
after update of role on public.circle_members
for each row
execute function public.ensure_circle_owner_after_membership_change();

alter table public.circles enable row level security;
alter table public.profiles enable row level security;
alter table public.circle_members enable row level security;
alter table public.memories enable row level security;
alter table public.memory_likes enable row level security;
alter table public.memory_comments enable row level security;
alter table public.memory_reports enable row level security;
alter table public.circle_join_requests enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Users can create their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Members can read their circles" on public.circles;
drop policy if exists "Users can create circles for themselves" on public.circles;
drop policy if exists "Circle owners can update their circles" on public.circles;
drop policy if exists "Users can read their own memberships" on public.circle_members;
drop policy if exists "Users can read memberships in their circles" on public.circle_members;
drop policy if exists "Members can read memberships in their circles" on public.circle_members;
drop policy if exists "Users can add themselves to circles" on public.circle_members;
drop policy if exists "Members can read memories in their circles" on public.memories;
drop policy if exists "Members can create memories in their circles" on public.memories;
drop policy if exists "Authors can update their memories" on public.memories;
drop policy if exists "Authors can delete their memories" on public.memories;
drop policy if exists "Members can read likes in their circles" on public.memory_likes;
drop policy if exists "Members can read comments in their circles" on public.memory_comments;
drop policy if exists "Members can insert reports in their circles" on public.memory_reports;
drop policy if exists "Users can read their join requests" on public.circle_join_requests;
drop policy if exists "Admins can read circle join requests" on public.circle_join_requests;

create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "Users can create their own profile"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

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

create policy "Members can read memberships in their circles"
on public.circle_members
for select
to authenticated
using (public.is_circle_member(circle_id));

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

create policy "Members can read likes in their circles"
on public.memory_likes
for select
to authenticated
using (
  exists (
    select 1
    from public.circle_members
    where circle_members.circle_id = memory_likes.circle_id
      and circle_members.user_id = auth.uid()
  )
);

create policy "Members can read comments in their circles"
on public.memory_comments
for select
to authenticated
using (
  exists (
    select 1
    from public.circle_members
    where circle_members.circle_id = memory_comments.circle_id
      and circle_members.user_id = auth.uid()
  )
);

create policy "Users can read their join requests"
on public.circle_join_requests
for select
to authenticated
using (requester_id = auth.uid());

create policy "Admins can read circle join requests"
on public.circle_join_requests
for select
to authenticated
using (public.is_circle_admin(circle_id));

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
      and deleted_at is null
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

create or replace function public.update_circle_profile(
  circle_id_input uuid,
  name_input text,
  avatar_base64_input text default null,
  avatar_mime_type_input text default null
)
returns public.circles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_circle public.circles;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to update a circle.';
  end if;

  if not public.is_circle_admin(circle_id_input) then
    raise exception 'Only circle admins can update the circle profile.';
  end if;

  if nullif(trim(name_input), '') is null then
    raise exception 'Circle name is required.';
  end if;

  update public.circles
  set name = trim(name_input),
      avatar_base64 = avatar_base64_input,
      avatar_mime_type = nullif(trim(avatar_mime_type_input), '')
  where id = circle_id_input
  returning * into updated_circle;

  return updated_circle;
end;
$$;

create or replace function public.get_circle_members(circle_id_input uuid)
returns table (
  user_id uuid,
  nickname text,
  role text,
  joined_at timestamptz,
  default_username text,
  avatar_base64 text,
  avatar_mime_type text
)
language sql
security definer
set search_path = public
as $$
  select
    circle_members.user_id,
    circle_members.nickname,
    circle_members.role,
    circle_members.joined_at,
    profiles.default_username,
    profiles.avatar_base64,
    profiles.avatar_mime_type
  from public.circle_members
  left join public.profiles on profiles.id = circle_members.user_id
  where circle_members.circle_id = circle_id_input
    and public.is_circle_member(circle_id_input)
  order by
    case circle_members.role
      when 'owner' then 1
      when 'admin' then 2
      else 3
    end,
    circle_members.joined_at asc;
$$;

create or replace function public.get_circle_join_requests(circle_id_input uuid)
returns table (
  id uuid,
  requester_id uuid,
  requester_name text,
  avatar_base64 text,
  avatar_mime_type text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    circle_join_requests.id,
    circle_join_requests.requester_id,
    coalesce(profiles.default_username, 'Someone') as requester_name,
    profiles.avatar_base64,
    profiles.avatar_mime_type,
    circle_join_requests.created_at
  from public.circle_join_requests
  left join public.profiles on profiles.id = circle_join_requests.requester_id
  where circle_join_requests.circle_id = circle_id_input
    and circle_join_requests.status = 'pending'
    and public.is_circle_admin(circle_id_input)
  order by circle_join_requests.created_at asc;
$$;

create or replace function public.get_circle_like_state(
  circle_id_input uuid,
  like_date_input date default current_date
)
returns table (likes_limit int, likes_used int)
language sql
security definer
set search_path = public
as $$
  select
    (
      select count(*)::int
      from public.circle_members
      where circle_members.circle_id = circle_id_input
    ) as likes_limit,
    (
      select count(*)::int
      from public.memory_likes
      where memory_likes.circle_id = circle_id_input
        and memory_likes.user_id = auth.uid()
        and memory_likes.like_date = like_date_input
    ) as likes_used
  where exists (
    select 1
    from public.circle_members
    where circle_members.circle_id = circle_id_input
      and circle_members.user_id = auth.uid()
  );
$$;

create or replace function public.like_memory(
  memory_id_input uuid,
  like_date_input date default current_date
)
returns public.memory_likes
language plpgsql
security definer
set search_path = public
as $$
declare
  target_memory public.memories;
  existing_like public.memory_likes;
  member_count int;
  likes_used int;
  new_like public.memory_likes;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to like a memory.';
  end if;

  select *
  into target_memory
  from public.memories
  where id = memory_id_input
    and deleted_at is null;

  if target_memory.id is null then
    raise exception 'Memory not found.';
  end if;

  if not exists (
    select 1
    from public.circle_members
    where circle_id = target_memory.circle_id
      and user_id = auth.uid()
  ) then
    raise exception 'You are not a member of this circle.';
  end if;

  select *
  into existing_like
  from public.memory_likes
  where memory_id = memory_id_input
    and user_id = auth.uid();

  if existing_like.id is not null then
    return existing_like;
  end if;

  select count(*)::int
  into member_count
  from public.circle_members
  where circle_id = target_memory.circle_id;

  select count(*)::int
  into likes_used
  from public.memory_likes
  where circle_id = target_memory.circle_id
    and user_id = auth.uid()
    and like_date = like_date_input;

  if likes_used >= member_count then
    raise exception 'You can only like % posts per day', member_count;
  end if;

  insert into public.memory_likes (memory_id, circle_id, user_id, like_date)
  values (memory_id_input, target_memory.circle_id, auth.uid(), like_date_input)
  returning * into new_like;

  return new_like;
end;
$$;

create or replace function public.add_memory_comment(
  memory_id_input uuid,
  body_input text
)
returns public.memory_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  target_memory public.memories;
  new_comment public.memory_comments;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to comment on a memory.';
  end if;

  if nullif(trim(body_input), '') is null then
    raise exception 'Comment cannot be empty.';
  end if;

  select *
  into target_memory
  from public.memories
  where id = memory_id_input
    and deleted_at is null;

  if target_memory.id is null then
    raise exception 'Memory not found.';
  end if;

  if not exists (
    select 1
    from public.circle_members
    where circle_id = target_memory.circle_id
      and user_id = auth.uid()
  ) then
    raise exception 'You are not a member of this circle.';
  end if;

  insert into public.memory_comments (memory_id, circle_id, user_id, body)
  values (memory_id_input, target_memory.circle_id, auth.uid(), trim(body_input))
  returning * into new_comment;

  return new_comment;
end;
$$;

create or replace function public.delete_memory(memory_id_input uuid)
returns public.memories
language plpgsql
security definer
set search_path = public
as $$
declare
  target_memory public.memories;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to delete a memory.';
  end if;

  select *
  into target_memory
  from public.memories
  where id = memory_id_input
    and deleted_at is null;

  if target_memory.id is null then
    raise exception 'Memory not found.';
  end if;

  if target_memory.author_id <> auth.uid() then
    raise exception 'You can only delete your own memories.';
  end if;

  update public.memories
  set deleted_at = now(),
      deleted_by = auth.uid()
  where id = memory_id_input
  returning * into target_memory;

  return target_memory;
end;
$$;

create or replace function public.report_memory(
  memory_id_input uuid,
  reason_input text default null
)
returns public.memory_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  target_memory public.memories;
  new_report public.memory_reports;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to report a memory.';
  end if;

  select *
  into target_memory
  from public.memories
  where id = memory_id_input
    and deleted_at is null;

  if target_memory.id is null then
    raise exception 'Memory not found.';
  end if;

  if target_memory.author_id = auth.uid() then
    raise exception 'You cannot report your own memory.';
  end if;

  if not exists (
    select 1
    from public.circle_members
    where circle_id = target_memory.circle_id
      and user_id = auth.uid()
  ) then
    raise exception 'You are not a member of this circle.';
  end if;

  insert into public.memory_reports (memory_id, circle_id, reporter_id, reason)
  values (memory_id_input, target_memory.circle_id, auth.uid(), nullif(trim(reason_input), ''))
  on conflict (memory_id, reporter_id) do update
  set reason = excluded.reason,
      created_at = now()
  returning * into new_report;

  return new_report;
end;
$$;

create or replace function public.delete_current_user()
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Must be logged in to delete an account.';
  end if;

  delete from auth.users
  where id = current_user_id;

  return true;
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
    and memories.deleted_at is null
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

create or replace function public.request_join_memory_circle(invite_code_input text)
returns table (circle_id uuid, circle_name text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_circle public.circles;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to request joining a memory circle.';
  end if;

  select *
  into target_circle
  from public.circles
  where invite_code = upper(trim(invite_code_input));

  if target_circle.id is null then
    raise exception 'Invite code not found.';
  end if;

  if exists (
    select 1
    from public.circle_members
    where circle_members.circle_id = target_circle.id
      and circle_members.user_id = auth.uid()
  ) then
    return query select target_circle.id, target_circle.name, 'already_member'::text;
    return;
  end if;

  insert into public.circle_join_requests (circle_id, requester_id, status)
  values (target_circle.id, auth.uid(), 'pending')
  on conflict (circle_id, requester_id) do update
  set status = 'pending',
      decided_at = null,
      decided_by = null,
      created_at = now();

  return query select target_circle.id, target_circle.name, 'pending'::text;
end;
$$;

create or replace function public.approve_join_request(request_id_input uuid)
returns public.circle_members
language plpgsql
security definer
set search_path = public
as $$
declare
  target_request public.circle_join_requests;
  new_membership public.circle_members;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to approve requests.';
  end if;

  select *
  into target_request
  from public.circle_join_requests
  where id = request_id_input
    and status = 'pending';

  if target_request.id is null then
    raise exception 'Join request not found.';
  end if;

  if not public.is_circle_admin(target_request.circle_id) then
    raise exception 'Only circle admins can approve join requests.';
  end if;

  insert into public.circle_members (circle_id, user_id, role)
  values (target_request.circle_id, target_request.requester_id, 'member')
  on conflict (circle_id, user_id) do nothing;

  select *
  into new_membership
  from public.circle_members
  where circle_id = target_request.circle_id
    and user_id = target_request.requester_id;

  update public.circle_join_requests
  set status = 'approved',
      decided_at = now(),
      decided_by = auth.uid()
  where id = request_id_input;

  return new_membership;
end;
$$;

create or replace function public.reject_join_request(request_id_input uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_request public.circle_join_requests;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to reject requests.';
  end if;

  select *
  into target_request
  from public.circle_join_requests
  where id = request_id_input
    and status = 'pending';

  if target_request.id is null then
    raise exception 'Join request not found.';
  end if;

  if not public.is_circle_admin(target_request.circle_id) then
    raise exception 'Only circle admins can reject join requests.';
  end if;

  update public.circle_join_requests
  set status = 'rejected',
      decided_at = now(),
      decided_by = auth.uid()
  where id = request_id_input;

  return true;
end;
$$;

create or replace function public.update_circle_member_role(
  circle_id_input uuid,
  member_id_input uuid,
  role_input text
)
returns public.circle_members
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  target_role text;
  updated_membership public.circle_members;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to update member roles.';
  end if;

  if role_input not in ('admin', 'member') then
    raise exception 'Role must be admin or member.';
  end if;

  select role into actor_role
  from public.circle_members
  where circle_id = circle_id_input
    and user_id = auth.uid();

  select role into target_role
  from public.circle_members
  where circle_id = circle_id_input
    and user_id = member_id_input;

  if actor_role <> 'owner' then
    raise exception 'Only the circle owner can change roles.';
  end if;

  if target_role = 'owner' then
    raise exception 'The owner role cannot be changed.';
  end if;

  update public.circle_members
  set role = role_input
  where circle_id = circle_id_input
    and user_id = member_id_input
  returning * into updated_membership;

  return updated_membership;
end;
$$;

create or replace function public.remove_circle_member(
  circle_id_input uuid,
  member_id_input uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  target_role text;
begin
  if auth.uid() is null then
    raise exception 'Must be logged in to remove a member.';
  end if;

  select role into actor_role
  from public.circle_members
  where circle_id = circle_id_input
    and user_id = auth.uid();

  select role into target_role
  from public.circle_members
  where circle_id = circle_id_input
    and user_id = member_id_input;

  if actor_role not in ('owner', 'admin') then
    raise exception 'Only circle admins can remove members.';
  end if;

  if member_id_input = auth.uid() then
    raise exception 'You cannot remove yourself here.';
  end if;

  if target_role is null then
    raise exception 'Member not found.';
  end if;

  if target_role = 'owner' then
    raise exception 'The circle owner cannot be removed.';
  end if;

  if actor_role = 'admin' and target_role = 'admin' then
    raise exception 'Admins cannot remove other admins.';
  end if;

  delete from public.circle_members
  where circle_id = circle_id_input
    and user_id = member_id_input;

  return true;
end;
$$;

revoke all on function public.create_memory_circle(text) from public;
revoke all on function public.join_memory_circle(text) from public;
revoke all on function public.is_circle_member(uuid) from public;
revoke all on function public.is_circle_admin(uuid) from public;
revoke all on function public.ensure_circle_has_owner(uuid) from public;
revoke all on function public.upload_daily_memory(uuid, text, text, text, text, text, date) from public;
revoke all on function public.update_circle_nickname(uuid, text) from public;
revoke all on function public.update_circle_profile(uuid, text, text, text) from public;
revoke all on function public.get_circle_members(uuid) from public;
revoke all on function public.get_circle_join_requests(uuid) from public;
revoke all on function public.get_circle_like_state(uuid, date) from public;
revoke all on function public.like_memory(uuid, date) from public;
revoke all on function public.add_memory_comment(uuid, text) from public;
revoke all on function public.delete_memory(uuid) from public;
revoke all on function public.report_memory(uuid, text) from public;
revoke all on function public.delete_current_user() from public;
revoke all on function public.get_memory_gems(uuid, int) from public;
revoke all on function public.request_join_memory_circle(text) from public;
revoke all on function public.approve_join_request(uuid) from public;
revoke all on function public.reject_join_request(uuid) from public;
revoke all on function public.update_circle_member_role(uuid, uuid, text) from public;
revoke all on function public.remove_circle_member(uuid, uuid) from public;

grant execute on function public.create_memory_circle(text) to authenticated;
grant execute on function public.join_memory_circle(text) to authenticated;
grant execute on function public.is_circle_member(uuid) to authenticated;
grant execute on function public.is_circle_admin(uuid) to authenticated;
grant execute on function public.ensure_circle_has_owner(uuid) to authenticated;
grant execute on function public.upload_daily_memory(uuid, text, text, text, text, text, date) to authenticated;
grant execute on function public.update_circle_nickname(uuid, text) to authenticated;
grant execute on function public.update_circle_profile(uuid, text, text, text) to authenticated;
grant execute on function public.get_circle_members(uuid) to authenticated;
grant execute on function public.get_circle_join_requests(uuid) to authenticated;
grant execute on function public.get_circle_like_state(uuid, date) to authenticated;
grant execute on function public.like_memory(uuid, date) to authenticated;
grant execute on function public.add_memory_comment(uuid, text) to authenticated;
grant execute on function public.delete_memory(uuid) to authenticated;
grant execute on function public.report_memory(uuid, text) to authenticated;
grant execute on function public.delete_current_user() to authenticated;
grant execute on function public.get_memory_gems(uuid, int) to authenticated;
grant execute on function public.request_join_memory_circle(text) to authenticated;
grant execute on function public.approve_join_request(uuid) to authenticated;
grant execute on function public.reject_join_request(uuid) to authenticated;
grant execute on function public.update_circle_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_circle_member(uuid, uuid) to authenticated;
