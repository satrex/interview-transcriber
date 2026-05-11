-- Direct browser uploads use the existing private `audio` bucket.
-- Storage policies for `audio` already exist in the project, so this migration
-- intentionally does not alter `storage.objects`; that table is owned by
-- Supabase internals and policy changes can fail with "must be owner".

alter table public.transcription_jobs
  alter column storage_bucket set default 'audio';
