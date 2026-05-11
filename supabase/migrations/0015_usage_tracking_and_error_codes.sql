alter table public.transcription_jobs
add column if not exists error_code text;

alter table public.transcription_jobs
add column if not exists cost_estimate_usd numeric(12, 6)
check (cost_estimate_usd is null or cost_estimate_usd >= 0);

alter table public.transcription_jobs
add column if not exists processed_audio_seconds numeric(12, 3)
check (processed_audio_seconds is null or processed_audio_seconds >= 0);

comment on column public.transcription_jobs.error_code is
  'Machine-readable failure code, such as quota_exceeded, rate_limited, or openai_error.';

comment on column public.transcription_jobs.cost_estimate_usd is
  'Estimated transcription cost in USD. Reserved for future pricing configuration.';

comment on column public.transcription_jobs.processed_audio_seconds is
  'Audio seconds successfully processed by the worker for usage and operations tracking.';

drop function if exists public.get_transcription_job_list();

create or replace function public.get_transcription_job_list()
returns table (
  id uuid,
  original_filename text,
  status public.transcription_job_status,
  progress integer,
  audio_duration_sec numeric,
  segment_count bigint,
  segment_duration_sec numeric,
  error_message text,
  error_code text,
  attempt_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    job.id,
    job.original_filename,
    job.status,
    job.progress,
    job.audio_duration_sec,
    count(segment.id) as segment_count,
    max(segment.end_sec) as segment_duration_sec,
    job.error_message,
    job.error_code,
    job.attempt_count,
    job.created_at,
    job.updated_at
  from public.transcription_jobs as job
  left join public.transcription_segments as segment
    on segment.job_id = job.id
  where job.user_id = auth.uid()
  group by job.id
  order by job.updated_at desc, job.created_at desc;
$$;

revoke all on function public.get_transcription_job_list()
from public, anon;

grant execute on function public.get_transcription_job_list()
to authenticated;

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
    error_code = 'worker_attempts_exhausted',
    failed_at = now(),
    updated_at = now()
  where status = 'processing'
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
    from public.transcription_jobs
    where (
        status = 'queued'
        or (
          status = 'processing'
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
  update public.transcription_jobs as job
  set
    status = 'processing',
    worker_id = p_worker_id,
    locked_at = now(),
    started_at = coalesce(job.started_at, now()),
    progress = case when job.status = 'queued' then 5 else job.progress end,
    attempt_count = job.attempt_count + 1,
    error_message = null,
    error_code = null,
    completed_at = null,
    failed_at = null,
    processed_audio_seconds = case
      when job.status = 'queued' then null
      else job.processed_audio_seconds
    end,
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
