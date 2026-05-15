-- Migration: 0017_project_splitting
-- Add transcription_projects table and modify transcription_jobs for project-based splitting

-- Create transcription_projects table
create table if not exists public.transcription_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  original_filename text,
  storage_bucket text not null default 'audio',
  storage_path text not null,
  status text not null default 'queued',
  total_duration_sec numeric,
  part_duration_sec numeric not null default 1800,
  total_parts integer,
  completed_parts integer not null default 0,
  failed_parts integer not null default 0,
  error_message text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add project/part columns to transcription_jobs
alter table public.transcription_jobs
add column if not exists project_id uuid references public.transcription_projects(id) on delete cascade;

alter table public.transcription_jobs
add column if not exists part_index integer;

alter table public.transcription_jobs
add column if not exists part_start_sec numeric;

alter table public.transcription_jobs
add column if not exists part_end_sec numeric;

alter table public.transcription_jobs
add column if not exists is_project_part boolean not null default false;

-- Create indexes
create index if not exists idx_transcription_projects_user_id
on public.transcription_projects(user_id);

create index if not exists idx_transcription_jobs_project_id
on public.transcription_jobs(project_id);

create index if not exists idx_transcription_jobs_project_part
on public.transcription_jobs(project_id, part_index);

-- Enable RLS for transcription_projects
alter table public.transcription_projects enable row level security;

-- RLS policies for transcription_projects
create policy "Users can select own transcription projects"
on public.transcription_projects
for select
to authenticated
using (user_id = auth.uid());

create policy "Users can insert own transcription projects"
on public.transcription_projects
for insert
to authenticated
with check (user_id = auth.uid());

create policy "Users can update own transcription projects"
on public.transcription_projects
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users can delete own transcription projects"
on public.transcription_projects
for delete
to authenticated
using (user_id = auth.uid());

-- Update existing transcription_jobs RLS to handle project_id
-- The existing policy should work as job.user_id takes precedence

-- Create RPC function for claiming queued projects
create or replace function claim_queued_project(
  p_worker_id text,
  p_lock_timeout_at timestamptz
)
returns transcription_projects[]
language plpgsql
security definer
as $$
declare
  claimed_project transcription_projects;
begin
  -- Try to claim a queued project
  update transcription_projects
  set
    status = 'splitting',
    updated_at = now()
  where id = (
    select id
    from transcription_projects
    where status = 'queued'
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning * into claimed_project;

  if claimed_project.id is not null then
    return array[claimed_project];
  else
    return array[]::transcription_projects[];
  end if;
end;
$$;
