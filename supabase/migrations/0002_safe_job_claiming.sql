alter table public.transcription_jobs
add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0);

create index if not exists transcription_jobs_retry_claim_idx
  on public.transcription_jobs (status, locked_at, created_at)
  where status in ('queued', 'processing');

create or replace function public.claim_next_transcription_job(
  p_worker_id text,
  p_lock_timeout_minutes integer default 30,
  p_max_attempts integer default 3
)
returns setof public.transcription_jobs
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

  update public.transcription_jobs
  set
    status = 'failed',
    error_message = 'Job exceeded max attempts while stale in processing.',
    failed_at = now(),
    updated_at = now()
  where status = 'processing'
    and locked_at < now() - make_interval(mins => p_lock_timeout_minutes)
    and attempt_count >= p_max_attempts;

  return query
  with candidate as (
    select id
    from public.transcription_jobs
    where (
        status = 'queued'
        or (
          status = 'processing'
          and locked_at < now() - make_interval(mins => p_lock_timeout_minutes)
        )
      )
      and attempt_count < p_max_attempts
    order by created_at asc
    limit 1
    for update skip locked
  )
  update public.transcription_jobs as job
  set
    status = 'processing',
    worker_id = p_worker_id,
    locked_at = now(),
    started_at = coalesce(job.started_at, now()),
    progress = case when job.status = 'queued' then 5 else job.progress end,
    attempt_count = job.attempt_count + 1,
    error_message = null,
    completed_at = null,
    failed_at = null,
    updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.*;
end;
$$;

revoke all on function public.claim_next_transcription_job(text, integer, integer)
from public, anon, authenticated;

grant execute on function public.claim_next_transcription_job(text, integer, integer)
to service_role;
