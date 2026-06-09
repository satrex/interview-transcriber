create or replace function public.save_punctuated_segment_edits(p_edits jsonb)
returns table(segment_id uuid, edited_text text)
language sql
security invoker
set search_path = public
as $$
  insert into public.transcription_segment_edits (
    segment_id,
    job_id,
    user_id,
    edited_text
  )
  select
    input.segment_id,
    input.job_id,
    auth.uid(),
    input.edited_text
  from jsonb_to_recordset(p_edits) as input(
    segment_id uuid,
    job_id uuid,
    edited_text text
  )
  join public.transcription_segments as segment
    on segment.id = input.segment_id
    and segment.job_id = input.job_id
  join public.transcription_jobs as job
    on job.id = segment.job_id
    and job.user_id = auth.uid()
  where input.edited_text is not null
    and length(input.edited_text) > 0
  on conflict (segment_id) do update
  set edited_text = excluded.edited_text
  where transcription_segment_edits.edited_text is null
    and transcription_segment_edits.is_skipped = false
    and transcription_segment_edits.user_id = auth.uid()
  returning
    transcription_segment_edits.segment_id,
    transcription_segment_edits.edited_text;
$$;

revoke all on function public.save_punctuated_segment_edits(jsonb) from public;
grant execute on function public.save_punctuated_segment_edits(jsonb) to authenticated;

comment on function public.save_punctuated_segment_edits(jsonb) is
  'Atomically saves AI punctuation results without overwriting edited text or skipped segments.';
