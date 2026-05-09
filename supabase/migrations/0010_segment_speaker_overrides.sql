alter table public.transcription_segment_edits
add column if not exists edited_speaker_label text
check (
  edited_speaker_label is null
  or length(btrim(edited_speaker_label)) > 0
);

create index if not exists transcription_segment_edits_job_speaker_override_idx
  on public.transcription_segment_edits (job_id, edited_speaker_label)
  where edited_speaker_label is not null;

comment on column public.transcription_segment_edits.edited_speaker_label is
  'Optional per-segment speaker override. The original transcription_segments.speaker_label remains immutable.';

comment on table public.transcription_segment_edits is
  'Stores user edits for segment text, skip state, and speaker overrides. Existing rows are not backfilled; initial skip rows are only created by the worker for newly transcribed short interjections.';
