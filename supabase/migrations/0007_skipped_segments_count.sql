alter table public.transcription_jobs
add column if not exists skipped_segments_count integer not null default 0
check (skipped_segments_count >= 0);
