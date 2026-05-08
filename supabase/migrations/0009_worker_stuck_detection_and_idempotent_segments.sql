alter table public.transcription_segments
add column if not exists segment_index integer;

with numbered_segments as (
  select
    id,
    row_number() over (
      partition by job_id, chunk_index
      order by start_sec asc, end_sec asc, created_at asc, id asc
    ) - 1 as next_segment_index
  from public.transcription_segments
  where segment_index is null
)
update public.transcription_segments
set segment_index = numbered_segments.next_segment_index
from numbered_segments
where transcription_segments.id = numbered_segments.id;

alter table public.transcription_segments
alter column segment_index set not null;

alter table public.transcription_segments
add constraint transcription_segments_segment_index_check
check (segment_index >= 0);

create unique index if not exists transcription_segments_job_chunk_segment_idx
  on public.transcription_segments (job_id, chunk_index, segment_index);

create index if not exists transcription_jobs_processing_updated_at_idx
  on public.transcription_jobs (status, updated_at, started_at)
  where status = 'processing';

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
