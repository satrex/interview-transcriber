drop table if exists public.event_artists;

drop table if exists public.events;

alter table public.tips
drop column if exists event_id;
