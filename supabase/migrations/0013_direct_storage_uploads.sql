alter table public.transcription_jobs
add column if not exists audio_file_size_bytes bigint
check (audio_file_size_bytes is null or audio_file_size_bytes >= 0);

alter table public.transcription_jobs
add column if not exists audio_content_type text;

drop policy if exists "Users can upload source audio to their own folder"
on storage.objects;

create policy "Users can upload source audio to their own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'audio-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
);
