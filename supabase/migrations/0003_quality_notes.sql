create table public.transcription_job_quality_notes (
  job_id uuid primary key references public.transcription_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  recording_environment text not null default '',
  misrecognition_notes text not null default '',
  speaker_misidentification_notes text not null default '',
  timestamp_offset_notes text not null default '',
  general_quality_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transcription_job_quality_notes_user_id_updated_at_idx
  on public.transcription_job_quality_notes (user_id, updated_at desc);

create trigger set_transcription_job_quality_notes_updated_at
before update on public.transcription_job_quality_notes
for each row
execute function public.set_updated_at();

alter table public.transcription_job_quality_notes enable row level security;

create policy "Users can view quality notes for their own jobs"
on public.transcription_job_quality_notes
for select
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.transcription_jobs
    where transcription_jobs.id = transcription_job_quality_notes.job_id
      and transcription_jobs.user_id = auth.uid()
  )
);

create policy "Users can create quality notes for their own jobs"
on public.transcription_job_quality_notes
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.transcription_jobs
    where transcription_jobs.id = transcription_job_quality_notes.job_id
      and transcription_jobs.user_id = auth.uid()
  )
);

create policy "Users can update quality notes for their own jobs"
on public.transcription_job_quality_notes
for update
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.transcription_jobs
    where transcription_jobs.id = transcription_job_quality_notes.job_id
      and transcription_jobs.user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.transcription_jobs
    where transcription_jobs.id = transcription_job_quality_notes.job_id
      and transcription_jobs.user_id = auth.uid()
  )
);
