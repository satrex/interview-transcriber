alter table public.transcription_segments
  add column mix_suspect_boundary_sec numeric(12, 3),
  add column mix_suspect_speaker_label text;
