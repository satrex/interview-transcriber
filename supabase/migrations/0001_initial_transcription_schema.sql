create type public.transcription_job_status as enum (
  'queued',
  'processing',
  'completed',
  'failed'
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'audio',
  'audio',
  false,
  1073741824,
  array[
    'audio/mpeg',
    'audio/m4a',
    'audio/mp4',
    'audio/x-m4a',
    'audio/wav',
    'audio/x-wav'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.transcription_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  original_filename text not null,
  storage_bucket text not null default 'audio',
  storage_path text not null,
  status public.transcription_job_status not null default 'queued',
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  error_message text,
  markdown text,
  worker_id text,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transcription_segments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.transcription_jobs(id) on delete cascade,
  speaker_label text not null,
  start_sec numeric(12, 3) not null check (start_sec >= 0),
  end_sec numeric(12, 3) not null check (end_sec >= start_sec),
  text text not null,
  chunk_index integer not null check (chunk_index >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transcription_jobs_user_id_created_at_idx
  on public.transcription_jobs (user_id, created_at desc);

create index transcription_jobs_status_created_at_idx
  on public.transcription_jobs (status, created_at);

create index transcription_segments_job_id_chunk_index_start_sec_idx
  on public.transcription_segments (job_id, chunk_index, start_sec);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_transcription_jobs_updated_at
before update on public.transcription_jobs
for each row
execute function public.set_updated_at();

create trigger set_transcription_segments_updated_at
before update on public.transcription_segments
for each row
execute function public.set_updated_at();

alter table public.transcription_jobs enable row level security;
alter table public.transcription_segments enable row level security;

create policy "Users can view their own transcription jobs"
on public.transcription_jobs
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own transcription jobs"
on public.transcription_jobs
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own queued transcription jobs"
on public.transcription_jobs
for update
to authenticated
using (auth.uid() = user_id and status = 'queued')
with check (auth.uid() = user_id);

create policy "Users can delete their own transcription jobs"
on public.transcription_jobs
for delete
to authenticated
using (auth.uid() = user_id);

create policy "Users can view segments for their own transcription jobs"
on public.transcription_segments
for select
to authenticated
using (
  exists (
    select 1
    from public.transcription_jobs
    where transcription_jobs.id = transcription_segments.job_id
      and transcription_jobs.user_id = auth.uid()
  )
);
