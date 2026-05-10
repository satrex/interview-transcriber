alter table public.transcription_jobs
add column if not exists audio_chunk_duration_sec numeric(12, 3)
check (
  audio_chunk_duration_sec is null
  or audio_chunk_duration_sec > 0
);

comment on column public.transcription_jobs.audio_chunk_duration_sec is
  'Duration in seconds used for browser-playable audio chunks stored at jobs/{job_id}/chunks/chunk_000.wav etc. Null means chunks may not exist and UI should fall back to source audio.';
