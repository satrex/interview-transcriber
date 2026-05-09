# Interview Transcriber Worker

This worker is intentionally separate from the Next.js app. It is meant to run on Sakura VPS and perform long-running audio work outside Vercel.

The current implementation is a dry run:

- Claims one `queued` job from Supabase
- Updates the job to `processing`
- Safely retries failed or stale jobs up to 3 attempts
- Downloads the source audio from Supabase Storage
- Runs `ffprobe` to read audio metadata
- Splits audio into 10-minute chunks with `ffmpeg`
- Sends each chunk to the OpenAI Transcription API
- Saves diarized segments into `transcription_segments`
- Updates job progress after each chunk
- Marks the job as `completed` after all chunks succeed
- Deletes temporary files

The transcription model is configured through `OPENAI_TRANSCRIPTION_MODEL` so it can be changed if model names, pricing, or availability change.

## Requirements

- Node.js 20+
- npm
- ffmpeg package installed on the VPS
- Supabase project with the repository migrations applied
- A `.env` file based on `.env.example`

## Environment

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_AUDIO_BUCKET=audio-uploads

WORKER_ID=sakura-vps-1
WORKER_LOCK_TIMEOUT_MINUTES=30
WORKER_MAX_LOCK_REFRESH_FAILURES=3
WORKER_MAX_ATTEMPTS=3
WORKER_TMP_DIR=/tmp/interview-transcriber
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
AUDIO_CHUNK_SECONDS=600

OPENAI_API_KEY=
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize
```

Use the Supabase service role key only on the VPS. Do not expose it to the browser.

## Local Dry Run

```bash
cd worker
npm install
cp .env.example .env
npm run dev
```

The worker processes at most one claimable job and exits. If no queued or stale job exists, it logs `no claimable jobs found`.

Job claiming is handled by the Supabase RPC function `claim_next_transcription_job`. It uses row locking so multiple workers do not claim the same job at the same time. A `processing` job whose `locked_at` is older than `WORKER_LOCK_TIMEOUT_MINUTES` can be claimed again until `WORKER_MAX_ATTEMPTS` is reached. While a worker is active, it refreshes `locked_at` periodically so a long-running job is not treated as stale. Transient Supabase communication failures are retried with exponential backoff; heartbeat refresh failures only stop the job after `WORKER_MAX_LOCK_REFRESH_FAILURES` consecutive failed refresh operations.

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
sudo apt-get install -y nodejs npm ffmpeg
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

Create `/opt/interview-transcriber/worker/.env` from `.env.example` and fill in real values.

Install the service:

```bash
sudo cp /opt/interview-transcriber/worker/systemd/interview-transcriber-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable interview-transcriber-worker
sudo systemctl start interview-transcriber-worker
```

Check logs:

```bash
journalctl -u interview-transcriber-worker -f
```

The current service runs one job and exits. Because `Restart=on-failure`, it will not loop forever after a successful run. Continuous polling will be added later.

## Docker Compose

```bash
cd worker
cp .env.example .env
docker compose up --build
```

The Docker image installs `ffmpeg` and runs the same one-job dry run.

## Resetting a Job

To test the same job again, reset it manually in Supabase:

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
    error_message = null
where id = '<job-id>';

delete from transcription_segments
where job_id = '<job-id>';
```
