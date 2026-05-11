# Usage and Billing Operations

OpenAI transcription cost should be tracked by audio minutes. The current schema records:

- `audio_duration_sec`: source audio duration from upload or ffprobe.
- `processed_audio_seconds`: audio seconds actually completed by the worker.
- `cost_estimate_usd`: reserved for a future pricing configuration.
- `error_code`: machine-readable failure reason for operations.

## Monthly Completed Usage

```sql
select
  date_trunc('month', completed_at) as month,
  round(sum(audio_duration_sec) / 60, 1) as completed_minutes,
  count(*) as completed_jobs
from transcription_jobs
where status = 'completed'
group by 1
order by 1 desc;
```

## Current Month by User

```sql
select
  user_id,
  round(sum(audio_duration_sec) / 60, 1) as completed_minutes,
  count(*) as completed_jobs
from transcription_jobs
where status = 'completed'
  and completed_at >= date_trunc('month', now())
group by user_id
order by completed_minutes desc;
```

## Quota Failures

```sql
select
  id,
  user_id,
  original_filename,
  status,
  error_code,
  error_message,
  created_at,
  started_at,
  failed_at
from transcription_jobs
where error_code = 'quota_exceeded'
order by failed_at desc;
```

## Re-run a Failed Job

Use this only after confirming the source audio still exists in Supabase Storage. If partial `transcription_segments` exist for the job, delete them before re-running or confirm the worker will clear and replace them at the start of transcription. Segment rows are source transcript records for the job; do not edit them manually as a correction workflow.

```sql
delete from transcription_segments
where job_id = '<job_id>';

update transcription_jobs
set
  status = 'queued',
  progress = 0,
  error_message = null,
  error_code = null,
  failed_at = null,
  started_at = null,
  completed_at = null,
  locked_at = null,
  worker_id = null,
  attempt_count = 0,
  processed_audio_seconds = null,
  updated_at = now()
where id = '<job_id>';
```
