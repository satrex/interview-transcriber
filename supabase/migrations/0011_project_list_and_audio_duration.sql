alter table public.transcription_jobs
add column if not exists audio_duration_sec numeric(12, 3)
check (audio_duration_sec is null or audio_duration_sec >= 0);

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
