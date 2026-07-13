# Interview Transcriber Worker

This worker is intentionally separate from the Next.js app. It is meant to run on Sakura VPS and perform long-running audio work outside Vercel.

The worker:

- Runs as a long-lived worker process that polls Supabase for claimable jobs
- Claims one `queued` job at a time from Supabase
- Updates the job to `processing`
- Safely retries failed or stale jobs up to 3 attempts
- Downloads the source audio from Supabase Storage
- Runs `ffprobe` to read audio metadata
- Splits audio into 5-minute chunks with `ffmpeg`
- Sends each chunk to the OpenAI Transcription API
- Saves diarized segments into `transcription_segments`
- Updates job progress after each chunk
- Marks the job as `completed` after all chunks succeed
- Deletes temporary files

The transcription model is configured through `OPENAI_TRANSCRIPTION_MODEL` so it can be changed if model names, pricing, or availability change.

## Requirements

- Node.js 22+
- npm
- ffmpeg package installed on the VPS
- Supabase project with the repository migrations applied
- A `.env` file based on `.env.example`

## Environment

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

WORKER_ID=sakura-vps-1
MAX_CONCURRENT_JOBS=1
WORKER_LOCK_TIMEOUT_MINUTES=30
WORKER_MAX_LOCK_REFRESH_FAILURES=3
WORKER_MAX_ATTEMPTS=3
WORKER_POLL_INTERVAL_MS=10000
WORKER_TMP_DIR=/tmp/interview-transcriber
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
FFMPEG_TIMEOUT_SECONDS=1800
AUDIO_CHUNK_SECONDS=300
WORKER_DOWNLOAD_TIMEOUT_SECONDS=900

OPENAI_API_KEY=
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize
OPENAI_TRANSCRIPTION_TIMEOUT_SECONDS=1800
SPEAKER_PAN_RELABEL_ENABLED=true
SPEAKER_REFERENCES_ENABLED=true
SPEAKER_MIX_RESPLIT_ENABLED=false
```

Use the Supabase service role key only on the VPS. Do not expose it to the browser.

## Local Run

```bash
cd worker
npm install
cp .env.example .env
npm run dev
```

The worker stays running and polls for claimable jobs every `WORKER_POLL_INTERVAL_MS` milliseconds. If no queued or stale job exists, it logs `no claimable jobs found` at most once per minute and waits for the next poll.

Job claiming is handled by the Supabase RPC function `claim_next_transcription_job`. It uses row locking so multiple workers do not claim the same job at the same time. Keep `MAX_CONCURRENT_JOBS=1`; parallel job and parallel chunk processing are intentionally not enabled yet. A `processing` job whose `locked_at` is older than `WORKER_LOCK_TIMEOUT_MINUTES` can be claimed again until `WORKER_MAX_ATTEMPTS` is reached. While a worker is active, it refreshes `locked_at` periodically so a long-running job is not treated as stale. Transient Supabase communication failures are retried with exponential backoff; heartbeat refresh failures only stop the job after `WORKER_MAX_LOCK_REFRESH_FAILURES` consecutive failed refresh operations.

OpenAI transcription API failures are classified separately from job attempts. The OpenAI SDK's internal retries are disabled so the worker controls retry timing:

- `quota_exceeded`: billing/quota 429, including `insufficient_quota`, is not retried. The job is marked `failed`.
- `unsupported_prompt_for_diarization`: an incompatible prompt/model request is not retried. The job is marked `failed`.
- `openai_timeout`: a timed-out chunk is retried up to twice after 15 seconds and 30 seconds, then the job is requeued.
- `rate_limited`: non-quota 429 is retried inside the chunk call after 30 seconds and 60 seconds, then the job is requeued.
- HTTP 5xx errors (and the server-error response message) use a longer backoff: up to 5 attempts with 30, 60, 90, and 120 second waits, then the job is requeued.
- `openai_error`: other OpenAI API errors are retried inside the chunk call up to 3 times, then the job is requeued.

Requeued OpenAI failures are attempted up to `WORKER_MAX_ATTEMPTS`; the final failed job retains its specific `error_code`. `attempt_count` means the number of times a worker claimed the job. Chunk-level OpenAI retries do not increment it.

The recommended defaults are `AUDIO_CHUNK_SECONDS=300` and `OPENAI_TRANSCRIPTION_TIMEOUT_SECONDS=1800`. If transcription still exceeds the timeout on the target VPS, reduce `AUDIO_CHUNK_SECONDS` further so each request contains less audio.

## Speaker Identity

The worker keeps sending mono 16 kHz WAV chunks to the diarization model, then improves speaker identity across chunks as a best-effort post-processing step.

When `SPEAKER_PAN_RELABEL_ENABLED=true`, stereo source audio is analyzed once before chunk transcription. The worker extracts a 0.25 second L/R energy envelope from the original uploaded file, computes each segment's pan position, and clusters segment pans across the whole job. The relabel is applied only when the stereo separation gate passes: cluster centers must be far enough apart and every cluster must have enough speech duration. Mono, dual-mono, and center-mixed files keep the API labels unchanged.

When `SPEAKER_REFERENCES_ENABLED=true`, the worker also builds short reference clips for newly observed speakers and sends them as `known_speaker_references` on later chunks. If reference extraction fails for a candidate, that speaker is skipped and retried from a later chunk. If OpenAI rejects the references for a chunk, that chunk is retried once without references and reference use is disabled for the rest of the job.

Both features are enhancements only. Failures in pan extraction, pan relabeling, reference clip creation, or reference validation are logged and the job continues with the transcription labels already saved.

The pan pass also flags possible tail-overlap segments when a segment edge contains a sustained run of energy from another speaker cluster. The UI shows these as 語尾かぶり疑い so editors can jump directly to the suspect segment and correct it. When `SPEAKER_MIX_RESPLIT_ENABLED=true`, the worker re-transcribes only those suspect regions from the source L/R channels, replaces the main speaker text, and inserts the intruding speaker text as a new segment when non-empty. It defaults to `false`; keep it disabled until suspect detection has been checked on real recordings.

Chunk files are written under the job temporary directory with names like:

```txt
{job_id}_chunk_000.wav
{job_id}_chunk_001.wav
```

The temporary directory is deleted after processing, even if ffmpeg or transcription fails.

## Sakura VPS Setup With systemd

Install runtime dependencies:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg ffmpeg
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs
node -v
```

Create a dedicated user:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin interview-worker
```

Place the repository under `/opt/interview-transcriber`, then install and build the worker:

```bash
cd /opt/interview-transcriber/worker
npm install
npm run build
sudo chown -R interview-worker:interview-worker /opt/interview-transcriber
```

Create `/etc/interview-transcriber/worker.env` from `.env.example` and fill in real values:

```bash
sudo mkdir -p /etc/interview-transcriber
sudo install -o root -g interview-worker -m 0640 \
  /opt/interview-transcriber/worker/.env.example \
  /etc/interview-transcriber/worker.env
sudoedit /etc/interview-transcriber/worker.env
```

Install the service:

```bash
sudo cp /opt/interview-transcriber/worker/systemd/interview-transcriber-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable interview-transcriber-worker
sudo systemctl start interview-transcriber-worker
```

Check logs:

```bash
sudo systemctl status interview-transcriber-worker
sudo journalctl -u interview-transcriber-worker -f
```

The service uses Node.js 22 and starts with `/usr/bin/npm start` directly; it
does not use a login shell. The worker is a long-lived process, so systemd uses
`Restart=on-failure` and should normally show `Active: active (running)`.

For OS rebuilds, use the bootstrap script after placing the repository at
`/opt/interview-transcriber`:

```bash
sudo bash /opt/interview-transcriber/worker/scripts/bootstrap-sakura-vps.sh
sudoedit /etc/interview-transcriber/worker.env
sudo systemctl restart interview-transcriber-worker
```

## Docker Compose

```bash
cd worker
cp .env.example .env
docker compose up --build
```

The Docker image installs `ffmpeg` and runs the same long-lived polling worker.

## Resetting a Job

Normally use the retry button in the UI. It resets a failed job to `queued` while preserving saved transcription segments so the worker can resume after the last saved chunk. The project-part retry endpoint follows the same behavior.

Manual SQL is intended for development/debugging only:

```sql
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
where id = '<job-id>';

```

Do not delete `transcription_segments` for a normal retry. If saved segments exist and `audio_chunk_duration_sec` still matches `AUDIO_CHUNK_SECONDS`, the worker logs `resuming job ... from chunk N` and skips completed chunks. If the chunk duration changed, or no segments exist, it clears the job's segments and starts from chunk 0. To intentionally restart completely from the beginning, also run:

```sql
delete from transcription_segments
where job_id = '<job-id>';
```
