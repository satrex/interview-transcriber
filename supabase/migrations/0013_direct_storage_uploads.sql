insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do nothing;

drop policy if exists "Authenticated users can upload own audio" on storage.objects;
drop policy if exists "Authenticated users can read own audio" on storage.objects;
drop policy if exists "Authenticated users can update own audio" on storage.objects;
drop policy if exists "Authenticated users can delete own audio" on storage.objects;

create policy "Authenticated users can upload own audio"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Authenticated users can read own audio"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Authenticated users can update own audio"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'audio'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Authenticated users can delete own audio"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);