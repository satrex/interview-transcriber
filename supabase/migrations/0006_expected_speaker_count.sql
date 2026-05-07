alter table public.transcription_jobs
add column if not exists expected_speaker_count integer not null default 2
check (expected_speaker_count > 0 and expected_speaker_count <= 20);
