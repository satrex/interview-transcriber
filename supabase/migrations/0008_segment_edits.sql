create table public.transcription_segment_edits (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.transcription_segments(id) on delete cascade,
  job_id uuid not null references public.transcription_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  edited_text text,
  is_skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (segment_id)
);

create index transcription_segment_edits_job_id_updated_at_idx
  on public.transcription_segment_edits (job_id, updated_at desc);

create index transcription_segment_edits_user_id_updated_at_idx
  on public.transcription_segment_edits (user_id, updated_at desc);

create trigger set_transcription_segment_edits_updated_at
before update on public.transcription_segment_edits
for each row
execute function public.set_updated_at();

alter table public.transcription_segment_edits enable row level security;

create policy "Users can view segment edits for their own jobs"
on public.transcription_segment_edits
for select
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.transcription_segments
    join public.transcription_jobs
      on transcription_jobs.id = transcription_segments.job_id
    where transcription_segments.id = transcription_segment_edits.segment_id
      and transcription_segments.job_id = transcription_segment_edits.job_id
      and transcription_jobs.id = transcription_segment_edits.job_id
      and transcription_jobs.user_id = auth.uid()
  )
);

create policy "Users can create segment edits for their own jobs"
on public.transcription_segment_edits
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.transcription_segments
    join public.transcription_jobs
      on transcription_jobs.id = transcription_segments.job_id
    where transcription_segments.id = transcription_segment_edits.segment_id
      and transcription_segments.job_id = transcription_segment_edits.job_id
      and transcription_jobs.id = transcription_segment_edits.job_id
      and transcription_jobs.user_id = auth.uid()
  )
);

create policy "Users can update segment edits for their own jobs"
on public.transcription_segment_edits
for update
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.transcription_segments
    join public.transcription_jobs
      on transcription_jobs.id = transcription_segments.job_id
    where transcription_segments.id = transcription_segment_edits.segment_id
      and transcription_segments.job_id = transcription_segment_edits.job_id
      and transcription_jobs.id = transcription_segment_edits.job_id
      and transcription_jobs.user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.transcription_segments
    join public.transcription_jobs
      on transcription_jobs.id = transcription_segments.job_id
    where transcription_segments.id = transcription_segment_edits.segment_id
      and transcription_segments.job_id = transcription_segment_edits.job_id
      and transcription_jobs.id = transcription_segment_edits.job_id
      and transcription_jobs.user_id = auth.uid()
  )
);
