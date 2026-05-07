# Test Plan

This document describes how to verify the current Interview Transcriber implementation in a local or development environment.

The current worker processes one claimable job and exits. Claimable means either `queued`, or stale `processing` with `locked_at` older than `WORKER_LOCK_TIMEOUT_MINUTES` and `attempt_count < WORKER_MAX_ATTEMPTS`. Active workers refresh `locked_at` periodically while processing.

## Prerequisites

- Supabase migration has been applied.
- Supabase Auth has at least one user that can log in to the web app.
- Root `.env.local` is configured for the Next.js app.
- `worker/.env` is configured for the worker.
- `ffmpeg` and `ffprobe` are installed and available.
- OpenAI API key is available for transcription tests.
- Test audio files are available locally. Do not commit test audio files.

Root `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_AUDIO_BUCKET=audio-uploads
MAX_UPLOAD_SIZE_MB=500
```

Worker `worker/.env`:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_AUDIO_BUCKET=audio-uploads

WORKER_ID=local-worker
WORKER_LOCK_TIMEOUT_MINUTES=30
WORKER_MAX_ATTEMPTS=3
WORKER_TMP_DIR=/tmp/interview-transcriber
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
AUDIO_CHUNK_SECONDS=600

OPENAI_API_KEY=
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize
```

Install dependencies:

```bash
npm install
cd worker
npm install
cd ..
```

Check local audio tools:

```bash
ffmpeg -version
ffprobe -version
```

## Common Test Flow

1. Start the Next.js app.

```bash
npm run dev
```

2. Open the local app in a browser.

```txt
http://localhost:3000
```

3. Log in with a Supabase Auth user.
4. Upload an audio file from `/`.
5. After upload succeeds, copy the `job_id` from the job detail URL.

```txt
/jobs/{job_id}
```

6. Confirm the source file exists in Supabase Storage.
7. Run the worker once.

```bash
cd worker
npm run dev
```

8. Check worker logs, database records, Storage, and the job detail page.

## Database Checks

Use the Supabase SQL Editor.

Check the job:

```sql
select
  id,
  user_id,
  original_filename,
  storage_bucket,
  storage_path,
  status,
  progress,
  attempt_count,
  worker_id,
  locked_at,
  started_at,
  completed_at,
  failed_at,
  error_message,
  created_at,
  updated_at
from transcription_jobs
where id = '<job-id>';
```

Expected successful job state:

- `status = 'completed'`
- `progress = 100`
- `attempt_count` is between `1` and `3`
- `worker_id` is set
- `locked_at` is set
- `started_at` is set
- `completed_at` is set
- `failed_at` is null
- `error_message` is null
- `storage_path` starts with `jobs/{job_id}/source/`

Check segments:

```sql
select
  job_id,
  speaker_label,
  start_sec,
  end_sec,
  text,
  chunk_index,
  created_at,
  updated_at
from transcription_segments
where job_id = '<job-id>'
order by chunk_index asc, start_sec asc;
```

Expected segment state:

- Each row has the uploaded `job_id`.
- `speaker_label` is populated.
- `start_sec` and `end_sec` are non-negative.
- `end_sec >= start_sec`.
- `text` is not empty.
- `chunk_index` starts at `0`.
- For multi-chunk files, later chunks have larger global `start_sec` values.

Useful aggregate check:

```sql
select
  chunk_index,
  count(*) as segment_count,
  min(start_sec) as first_start_sec,
  max(end_sec) as last_end_sec
from transcription_segments
where job_id = '<job-id>'
group by chunk_index
order by chunk_index asc;
```

## Storage Checks

Check Supabase Storage bucket:

```txt
audio-uploads
```

Expected source path:

```txt
jobs/{job_id}/source/{safe_original_filename}
```

Only the uploaded source file should persist in Supabase Storage. Worker chunk files are temporary local files under `WORKER_TMP_DIR` and should be deleted after processing.

## Worker Log Checks

Look for these log lines in order:

```txt
[worker] starting ...
[worker] looking for one claimable transcription job
[worker] claimed job {job_id} attempt X/3
[worker] downloading job {job_id}: jobs/{job_id}/source/...
[worker] downloaded ... bytes to ...
[worker] ffprobe audio info:
[worker] splitting audio into 600s chunks
[worker] created N chunk file(s):
[worker] chunk 0: .../{job_id}_chunk_000.wav (... bytes)
[worker] transcribing chunk 0 starting at 0s
[worker] saved N segment(s) for chunk 0; progress P%
[worker] completed job {job_id}
[worker] cleaned temporary directory /tmp/interview-transcriber/{job_id}
```

For multi-chunk files, confirm each chunk appears:

```txt
{job_id}_chunk_000.wav
{job_id}_chunk_001.wav
```

For a 2 hour file, expect about 12 chunks when `AUDIO_CHUNK_SECONDS=600`.

## Test Cases

### 1. 30 Second Minimal Test

Purpose:

- Verify the shortest useful end-to-end path.
- Confirm upload, queued job creation, worker completion, segment saving, and Markdown display.

Input:

- One `mp3`, `m4a`, or `wav` file around 30 seconds.
- One or two speakers is acceptable.

Expected DB:

- `transcription_jobs.status = 'completed'`.
- `progress = 100`.
- `transcription_segments` has at least one row.
- All segment rows have `chunk_index = 0`.
- `start_sec` begins near `0`.

Expected Storage:

- One source file under `audio-uploads/jobs/{job_id}/source/`.
- No chunk files in Supabase Storage.

Expected worker log:

- `created 1 chunk file(s)`.
- One `transcribing chunk 0 starting at 0s` line.
- `completed job`.
- `cleaned temporary directory`.

Expected UI:

- Job detail shows `completed` and `100%`.
- Transcript area shows `話者A：本文`.
- Timestamp toggle hides and shows timestamps.
- `Markdownをコピー` copies Markdown with the current timestamp setting.

### 2. 3 To 5 Minute Multi-Speaker Test

Purpose:

- Verify diarization quality and editorial Markdown display.
- Confirm consecutive segments from the same speaker are merged in the UI.

Input:

- One 3 to 5 minute interview-style audio file.
- At least two clearly different speakers.

Expected DB:

- `transcription_jobs.status = 'completed'`.
- `progress = 100`.
- `transcription_segments` has rows for more than one `speaker_label`, unless the API fails to distinguish speakers.
- All segment rows should normally have `chunk_index = 0`.

Speaker count check:

```sql
select speaker_label, count(*) as segment_count
from transcription_segments
where job_id = '<job-id>'
group by speaker_label
order by speaker_label asc;
```

Expected Storage:

- One source file under `audio-uploads/jobs/{job_id}/source/`.
- No persistent chunk files.

Expected worker log:

- `created 1 chunk file(s)`.
- `saved N segment(s) for chunk 0`.
- `completed job`.

Expected UI:

- Multiple speakers appear as `話者A`, `話者B`, and so on.
- Consecutive same-speaker segments are displayed as one block where possible.
- Markdown copy includes `話者A：本文` style lines.
- Timestamp ON/OFF both produce readable Markdown.

### 3. 15 Minute Split And Merge Test

Purpose:

- Verify 10 minute chunk splitting.
- Confirm global timestamp correction across chunks.
- Confirm Markdown display remains continuous after chunk boundaries.

Input:

- One audio file around 15 minutes.
- Preferably with speech before and after the 10 minute mark.

Expected DB:

- `transcription_jobs.status = 'completed'`.
- `progress = 100`.
- `transcription_segments` includes `chunk_index = 0` and `chunk_index = 1`.
- Rows in `chunk_index = 1` have `start_sec` around or above `600`, depending on where speech begins in the second chunk.

Chunk timing check:

```sql
select
  chunk_index,
  min(start_sec) as first_start_sec,
  max(end_sec) as last_end_sec,
  count(*) as segment_count
from transcription_segments
where job_id = '<job-id>'
group by chunk_index
order by chunk_index asc;
```

Expected Storage:

- One source file under `audio-uploads/jobs/{job_id}/source/`.
- Chunk files are not present in Supabase Storage.

Expected worker log:

- `splitting audio into 600s chunks`.
- `created 2 chunk file(s)`.
- `{job_id}_chunk_000.wav`.
- `{job_id}_chunk_001.wav`.
- `transcribing chunk 0 starting at 0s`.
- `transcribing chunk 1 starting at 600s`.
- Progress updates after each chunk.
- `completed job`.
- `cleaned temporary directory`.

Expected UI:

- Transcript appears on the job detail page.
- Timestamps after the 10 minute boundary continue from the full audio timeline.
- Markdown copy does not restart timestamps at `00:00` for the second chunk.

### 4. 2 Hour Production-Style Test

Purpose:

- Verify realistic long interview behavior.
- Observe runtime, OpenAI API stability, chunk progress, and cleanup.

Input:

- One 2 hour audio file.
- File size should be below `500MB`.
- Use `mp3`, `m4a`, or `wav`.

Expected DB:

- `transcription_jobs.status = 'completed'`.
- `progress = 100`.
- `completed_at` is set.
- `failed_at` is null.
- `error_message` is null.
- `transcription_segments` has rows for all chunks that contain speech.
- About 12 chunk indexes are expected with `AUDIO_CHUNK_SECONDS=600`.

Chunk count check:

```sql
select
  count(distinct chunk_index) as chunk_count,
  min(chunk_index) as min_chunk_index,
  max(chunk_index) as max_chunk_index,
  count(*) as segment_count,
  min(start_sec) as first_start_sec,
  max(end_sec) as last_end_sec
from transcription_segments
where job_id = '<job-id>';
```

Expected Storage:

- One source file persists under `audio-uploads/jobs/{job_id}/source/`.
- No chunk files persist in Supabase Storage.

Expected worker log:

- `downloaded ... bytes`.
- `created 12 chunk file(s)` approximately.
- Chunk logs from `chunk 0` through the final chunk.
- Progress increases after every chunk and reaches `100` only after completion.
- `completed job`.
- `cleaned temporary directory`.

Expected UI:

- Job detail remains usable with a large transcript.
- Markdown preview renders.
- Timestamp toggle works.
- Markdown copy works, though clipboard/browser limits may vary for very large transcripts.

Notes:

- Run the 2 hour test only after the 30 second, 3 to 5 minute, and 15 minute tests pass.
- Expect higher OpenAI cost and longer runtime.
- Record approximate processing time and segment count for future capacity planning.

## Resetting A Job For Retest

Reset a job to queued:

```sql
update transcription_jobs
set status = 'queued',
    progress = 0,
    attempt_count = 0,
    worker_id = null,
    locked_at = null,
    started_at = null,
    completed_at = null,
    failed_at = null,
    error_message = null,
    updated_at = now()
where id = '<job-id>';
```

Delete existing segments:

```sql
delete from transcription_segments
where job_id = '<job-id>';
```

Delete the source file only when you want to retest upload behavior from scratch:

```txt
audio-uploads/jobs/{job_id}/source/{safe_original_filename}
```

## Troubleshooting

| Symptom | Likely cause | How to isolate |
| --- | --- | --- |
| Upload shows `ログインが必要です。` | Browser has no Supabase Auth session | Confirm login flow/session, then retry upload. |
| Upload fails with Supabase env error | `.env.local` is missing or incorrect | Check `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Restart `npm run dev`. |
| Upload fails with Storage error | Bucket missing, MIME blocked, or file too large | Confirm `audio-uploads` exists, source file is `mp3/m4a/wav`, and size is under `500MB`. |
| Job row exists but worker logs `no claimable jobs found` | Job is not `queued`, stale timeout has not elapsed, max attempts are exhausted, or worker points to another Supabase project | Query `transcription_jobs.status`, `locked_at`, and `attempt_count`; verify `worker/.env`; reset the job if needed. |
| Worker cannot download audio | `storage_bucket` or `storage_path` is wrong, or service role key is invalid | Compare job `storage_path` with Storage UI and confirm `SUPABASE_SERVICE_ROLE_KEY`. |
| Stale `processing` job is not retried | `locked_at` is not older than `WORKER_LOCK_TIMEOUT_MINUTES`, or `attempt_count >= WORKER_MAX_ATTEMPTS` | Query `locked_at` and `attempt_count`; wait for timeout or reset the job for manual retest. |
| `ffprobe` or `ffmpeg` command fails | Tool is not installed or path is wrong | Run `ffmpeg -version` and `ffprobe -version`; set `FFMPEG_PATH` or `FFPROBE_PATH` to absolute paths. |
| `created 0 chunk file(s)` or no chunks | Input has no decodable audio stream | Run local `ffprobe` on the source file and confirm an audio stream exists. |
| OpenAI transcription fails | Missing API key, wrong model, quota/rate limit, or unsupported response format | Check `OPENAI_API_KEY`, `OPENAI_TRANSCRIPTION_MODEL`, OpenAI dashboard usage, and worker error message. |
| Job becomes `failed` | Worker threw an error | Read `transcription_jobs.error_message` and the worker log around the failure. |
| Segments are not saved | OpenAI returned no `segments` or DB insert failed | Check worker log for `saved N segment(s)` and query `transcription_segments`. |
| Markdown area says no segments | Job has no segment rows or page is showing another job | Query `transcription_segments` by `job_id`; confirm the browser URL job id. |
| 15 minute test has one chunk | Audio is shorter than 600 seconds after decode or ffmpeg could not split as expected | Check `ffprobe` duration in worker log and source file duration. |
| 2 hour test has chunk count far from 12 | `AUDIO_CHUNK_SECONDS` is not `600`, file duration differs, or ffmpeg ended early | Check worker env, `ffprobe` duration, and chunk log list. |
| Temporary files remain | Worker crashed before cleanup or `WORKER_TMP_DIR` points elsewhere | Inspect `/tmp/interview-transcriber/{job_id}` and worker logs for `cleaned temporary directory`. |

## Acceptance Criteria

- 30 second, 3 to 5 minute, and 15 minute tests complete with `status = 'completed'`.
- 2 hour production-style test completes or produces a clear `failed` state with actionable `error_message`.
- `transcription_segments` rows exist and are ordered by `chunk_index, start_sec`.
- Supabase Storage contains the uploaded source file and no persistent chunk files.
- Worker logs show download, ffprobe, split, transcription, segment save, completion, and cleanup.
- Job detail page displays `話者A：本文` style transcript blocks.
- Timestamp ON/OFF changes both the visible transcript and copied Markdown.
