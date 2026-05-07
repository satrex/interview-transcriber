create table public.transcription_job_speaker_names (
  job_id uuid not null references public.transcription_jobs(id) on delete cascade,
  speaker_label text not null check (length(btrim(speaker_label)) > 0),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, speaker_label)
);

create index transcription_job_speaker_names_user_id_updated_at_idx
  on public.transcription_job_speaker_names (user_id, updated_at desc);

create trigger set_transcription_job_speaker_names_updated_at
before update on public.transcription_job_speaker_names
for each row
execute function public.set_updated_at();

alter table public.transcription_job_speaker_names enable row level security;

create policy "Users can view speaker names for their own jobs"
on public.transcription_job_speaker_names
for select
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.transcription_jobs
    where transcription_jobs.id = transcription_job_speaker_names.job_id
      and transcription_jobs.user_id = auth.uid()
  )
);

create policy "Users can create speaker names for their own jobs"
on public.transcription_job_speaker_names
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.transcription_jobs
    where transcription_jobs.id = transcription_job_speaker_names.job_id
      and transcription_jobs.user_id = auth.uid()
  )
);

create policy "Users can update speaker names for their own jobs"
on public.transcription_job_speaker_names
for update
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.transcription_jobs
    where transcription_jobs.id = transcription_job_speaker_names.job_id
      and transcription_jobs.user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.transcription_jobs
    where transcription_jobs.id = transcription_job_speaker_names.job_id
      and transcription_jobs.user_id = auth.uid()
  )
);
