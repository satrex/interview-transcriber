alter table public.transcription_jobs
add column if not exists audio_file_size_bytes bigint
check (
  audio_file_size_bytes is null
  or audio_file_size_bytes >= 0
);

alter table public.transcription_jobs
add column if not exists audio_content_type text;

comment on column public.transcription_jobs.audio_file_size_bytes is
  'Size in bytes of the uploaded source audio file.';

comment on column public.transcription_jobs.audio_content_type is
  'MIME content type recorded for the uploaded source audio file.';
