-- WhenMeet Calendar: privacy-minimizing database schema.
-- Run this once in the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  timezone text not null,
  start_date date not null,
  end_date date not null,
  day_start time not null,
  day_end time not null,
  slot_minutes integer not null check (slot_minutes in (15, 30, 60)),
  share_code text not null unique,
  admin_hash bytea not null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date - start_date <= 62),
  check (day_end > day_start)
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  edit_hash bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, edit_hash)
);

create table if not exists public.availability (
  participant_id uuid not null references public.participants(id) on delete cascade,
  slot_start timestamptz not null,
  primary key (participant_id, slot_start)
);

alter table public.meetings enable row level security;
alter table public.participants enable row level security;
alter table public.availability enable row level security;

-- The browser must not query the tables directly. It can execute only the RPCs below.
revoke all on public.meetings from anon, authenticated;
revoke all on public.participants from anon, authenticated;
revoke all on public.availability from anon, authenticated;

create or replace function public.create_meeting(
  p_title text,
  p_timezone text,
  p_start_date date,
  p_end_date date,
  p_day_start time,
  p_day_end time,
  p_slot_minutes integer
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_share_code text := encode(gen_random_bytes(18), 'hex');
  v_admin_code text := encode(gen_random_bytes(24), 'hex');
begin
  if char_length(trim(p_title)) < 1 or char_length(trim(p_title)) > 160 then
    raise exception 'Meeting title must be between 1 and 160 characters';
  end if;
  if p_end_date < p_start_date or p_end_date - p_start_date > 62 then
    raise exception 'Meeting date range must be between 1 and 63 days';
  end if;
  if p_day_end <= p_day_start then
    raise exception 'End time must be after start time';
  end if;
  if p_slot_minutes not in (15, 30, 60) then
    raise exception 'Unsupported slot length';
  end if;
  -- Raises on an invalid PostgreSQL/IANA timezone name.
  perform timezone(p_timezone, now());

  insert into public.meetings (
    title, timezone, start_date, end_date, day_start, day_end, slot_minutes, share_code, admin_hash
  ) values (
    trim(p_title), p_timezone, p_start_date, p_end_date, p_day_start, p_day_end, p_slot_minutes,
    v_share_code, digest(v_admin_code, 'sha256')
  );

  return jsonb_build_object('share_code', v_share_code, 'admin_code', v_admin_code);
end;
$$;

create or replace function public.get_meeting(p_share_code text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_meeting public.meetings%rowtype;
  v_participants jsonb;
begin
  select * into v_meeting from public.meetings where share_code = p_share_code;
  if not found then return null; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', p.name,
      'slots', coalesce((
        select jsonb_agg(a.slot_start order by a.slot_start)
        from public.availability a
        where a.participant_id = p.id
      ), '[]'::jsonb)
    ) order by p.created_at
  ), '[]'::jsonb)
  into v_participants
  from public.participants p
  where p.meeting_id = v_meeting.id;

  return jsonb_build_object(
    'meeting', jsonb_build_object(
      'title', v_meeting.title,
      'timezone', v_meeting.timezone,
      'start_date', v_meeting.start_date,
      'end_date', v_meeting.end_date,
      'day_start', v_meeting.day_start,
      'day_end', v_meeting.day_end,
      'slot_minutes', v_meeting.slot_minutes
    ),
    'participants', v_participants
  );
end;
$$;

create or replace function public.save_participant(
  p_share_code text,
  p_edit_code text,
  p_name text,
  p_slots timestamptz[]
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meeting public.meetings%rowtype;
  v_participant_id uuid;
  v_edit_hash bytea;
begin
  if char_length(trim(p_name)) < 1 or char_length(trim(p_name)) > 120 then
    raise exception 'Name must be between 1 and 120 characters';
  end if;
  if char_length(p_edit_code) < 24 then
    raise exception 'Invalid participant edit code';
  end if;
  if coalesce(array_length(p_slots, 1), 0) > 2500 then
    raise exception 'Too many availability slots';
  end if;

  select * into v_meeting from public.meetings where share_code = p_share_code;
  if not found then raise exception 'Meeting not found'; end if;

  v_edit_hash := digest(p_edit_code, 'sha256');
  select id into v_participant_id
  from public.participants
  where meeting_id = v_meeting.id and edit_hash = v_edit_hash;

  if v_participant_id is null then
    insert into public.participants(meeting_id, name, edit_hash)
    values(v_meeting.id, trim(p_name), v_edit_hash)
    returning id into v_participant_id;
  else
    update public.participants
    set name = trim(p_name), updated_at = now()
    where id = v_participant_id;
  end if;

  delete from public.availability where participant_id = v_participant_id;

  insert into public.availability(participant_id, slot_start)
  select v_participant_id, s
  from (select distinct unnest(coalesce(p_slots, '{}'::timestamptz[])) as s) x
  where (s at time zone v_meeting.timezone)::date between v_meeting.start_date and v_meeting.end_date
    and (s at time zone v_meeting.timezone)::time >= v_meeting.day_start
    and (s at time zone v_meeting.timezone)::time < v_meeting.day_end;

  return v_participant_id;
end;
$$;

create or replace function public.delete_meeting(p_share_code text, p_admin_code text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.meetings
  where share_code = p_share_code
    and admin_hash = digest(p_admin_code, 'sha256');
  if v_id is null then return false; end if;
  delete from public.meetings where id = v_id;
  return true;
end;
$$;

revoke all on function public.create_meeting(text,text,date,date,time,time,integer) from public;
revoke all on function public.get_meeting(text) from public;
revoke all on function public.save_participant(text,text,text,timestamptz[]) from public;
revoke all on function public.delete_meeting(text,text) from public;

grant execute on function public.create_meeting(text,text,date,date,time,time,integer) to anon, authenticated;
grant execute on function public.get_meeting(text) to anon, authenticated;
grant execute on function public.save_participant(text,text,text,timestamptz[]) to anon, authenticated;
grant execute on function public.delete_meeting(text,text) to anon, authenticated;
