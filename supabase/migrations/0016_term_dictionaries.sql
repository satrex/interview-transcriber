create table if not exists public.term_dictionaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.term_dictionary_entries (
  id uuid primary key default gen_random_uuid(),
  dictionary_id uuid not null references public.term_dictionaries(id) on delete cascade,
  term text not null,
  reading text,
  category text,
  description text,
  aliases text[] not null default '{}',
  priority integer not null default 100,
  sort_order integer not null default 0,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.transcription_jobs
add column if not exists term_dictionary_id uuid
references public.term_dictionaries(id) on delete set null;

create index if not exists term_dictionaries_user_id_updated_at_idx
  on public.term_dictionaries (user_id, updated_at desc);

create index if not exists term_dictionary_entries_dictionary_order_idx
  on public.term_dictionary_entries (
    dictionary_id,
    is_enabled,
    sort_order,
    priority,
    term
  );

create index if not exists transcription_jobs_term_dictionary_id_idx
  on public.transcription_jobs (term_dictionary_id)
  where term_dictionary_id is not null;

drop trigger if exists set_term_dictionaries_updated_at
on public.term_dictionaries;

create trigger set_term_dictionaries_updated_at
before update on public.term_dictionaries
for each row
execute function public.set_updated_at();

drop trigger if exists set_term_dictionary_entries_updated_at
on public.term_dictionary_entries;

create trigger set_term_dictionary_entries_updated_at
before update on public.term_dictionary_entries
for each row
execute function public.set_updated_at();

alter table public.term_dictionaries enable row level security;
alter table public.term_dictionary_entries enable row level security;

drop policy if exists "Users can select own term dictionaries"
on public.term_dictionaries;

create policy "Users can select own term dictionaries"
on public.term_dictionaries
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can insert own term dictionaries"
on public.term_dictionaries;

create policy "Users can insert own term dictionaries"
on public.term_dictionaries
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update own term dictionaries"
on public.term_dictionaries;

create policy "Users can update own term dictionaries"
on public.term_dictionaries
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can delete own term dictionaries"
on public.term_dictionaries;

create policy "Users can delete own term dictionaries"
on public.term_dictionaries
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can select own term dictionary entries"
on public.term_dictionary_entries;

create policy "Users can select own term dictionary entries"
on public.term_dictionary_entries
for select
to authenticated
using (
  exists (
    select 1
    from public.term_dictionaries d
    where d.id = dictionary_id
      and d.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert own term dictionary entries"
on public.term_dictionary_entries;

create policy "Users can insert own term dictionary entries"
on public.term_dictionary_entries
for insert
to authenticated
with check (
  exists (
    select 1
    from public.term_dictionaries d
    where d.id = dictionary_id
      and d.user_id = auth.uid()
  )
);

drop policy if exists "Users can update own term dictionary entries"
on public.term_dictionary_entries;

create policy "Users can update own term dictionary entries"
on public.term_dictionary_entries
for update
to authenticated
using (
  exists (
    select 1
    from public.term_dictionaries d
    where d.id = dictionary_id
      and d.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.term_dictionaries d
    where d.id = dictionary_id
      and d.user_id = auth.uid()
  )
);

drop policy if exists "Users can delete own term dictionary entries"
on public.term_dictionary_entries;

create policy "Users can delete own term dictionary entries"
on public.term_dictionary_entries
for delete
to authenticated
using (
  exists (
    select 1
    from public.term_dictionaries d
    where d.id = dictionary_id
      and d.user_id = auth.uid()
  )
);

comment on table public.term_dictionaries is
  'User-owned dictionaries of frequent terms used as transcription prompt hints.';

comment on table public.term_dictionary_entries is
  'Terms, readings, aliases, and priority metadata for transcription prompt hints.';

comment on column public.transcription_jobs.term_dictionary_id is
  'Optional user-owned term dictionary selected when the transcription job was created.';
