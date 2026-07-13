-- Migration: 0026_project_stale_reclaim
-- Add lock ownership to transcription_projects and reclaim stale 'splitting'
-- projects, mirroring claim_next_transcription_job (0015).
-- See docs/project-stale-reclaim.md.

alter table public.transcription_projects
add column if not exists worker_id text;

alter table public.transcription_projects
add column if not exists locked_at timestamptz;

alter table public.transcription_projects
add column if not exists started_at timestamptz;

alter table public.transcription_projects
add column if not exists attempt_count integer not null default 0;

-- Makes createPartJobs idempotent when a reclaimed worker re-splits a project.
-- Non-part jobs have NULL project_id/part_index, which never conflict.
create unique index if not exists uq_transcription_jobs_project_part
on public.transcription_jobs (project_id, part_index);

create or replace function public.claim_queued_project(
  p_worker_id text,
  p_lock_timeout_minutes integer default 30,
  p_max_attempts integer default 3
)
returns setof public.transcription_projects
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'p_worker_id is required';
  end if;

  if p_lock_timeout_minutes <= 0 then
    raise exception 'p_lock_timeout_minutes must be positive';
  end if;

  if p_max_attempts <= 0 then
    raise exception 'p_max_attempts must be positive';
  end if;

  update public.transcription_projects
  set
    status = 'failed',
    error_message = 'Project splitting exceeded max attempts while stale.',
    error_code = 'project_split_attempts_exhausted',
    updated_at = now()
  where status = 'splitting'
    and greatest(
      coalesce(locked_at, '-infinity'::timestamptz),
      updated_at,
      coalesce(started_at, '-infinity'::timestamptz),
      created_at
    ) < now() - make_interval(mins => p_lock_timeout_minutes)
    and attempt_count >= p_max_attempts;

  return query
  with candidate as (
    select id
    from public.transcription_projects
    where (
        status = 'queued'
        or (
          status = 'splitting'
          and greatest(
            coalesce(locked_at, '-infinity'::timestamptz),
            updated_at,
            coalesce(started_at, '-infinity'::timestamptz),
            created_at
          ) < now() - make_interval(mins => p_lock_timeout_minutes)
        )
      )
      and attempt_count < p_max_attempts
    order by created_at asc
    limit 1
    for update skip locked
  )
  update public.transcription_projects as project
  set
    status = 'splitting',
    worker_id = p_worker_id,
    locked_at = now(),
    started_at = coalesce(project.started_at, now()),
    attempt_count = project.attempt_count + 1,
    error_message = null,
    error_code = null,
    updated_at = now()
  from candidate
  where project.id = candidate.id
  returning project.*;
end;
$$;

revoke all on function public.claim_queued_project(text, integer, integer)
from public, anon, authenticated;

grant execute on function public.claim_queued_project(text, integer, integer)
to service_role;

-- Compatibility wrapper for workers deployed before this migration; they call
-- claim_queued_project(p_worker_id, p_lock_timeout_at). Delegates to the new
-- implementation so stale reclaim applies during the rollout window too.
-- Drop this overload once all workers pass p_lock_timeout_minutes.
create or replace function public.claim_queued_project(
  p_worker_id text,
  p_lock_timeout_at timestamptz
)
returns transcription_projects[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_timeout_minutes integer;
begin
  v_lock_timeout_minutes := greatest(
    1,
    round(extract(epoch from (p_lock_timeout_at - now())) / 60)::integer
  );

  return coalesce(
    (
      select array_agg(claimed)
      from public.claim_queued_project(p_worker_id, v_lock_timeout_minutes, 3)
        as claimed
    ),
    array[]::transcription_projects[]
  );
end;
$$;

revoke all on function public.claim_queued_project(text, timestamptz)
from public, anon, authenticated;

grant execute on function public.claim_queued_project(text, timestamptz)
to service_role;
