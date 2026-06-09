# Interview Transcriber Architecture

## Overview

This project is a web app for transcribing long-form interviews into editable, magazine-friendly material.

The system is split into two runtimes:

- `Next.js` on Vercel handles upload, job creation, status display, transcript viewing, and Markdown export.
- A private `worker` running on Sakura VPS polls queued jobs from Supabase and performs long-running audio processing.

This separation is intentional. Vercel should not run long transcription workloads.

## Phase Assumptions

### Phase 1

- User authentication is required
- Jobs are owned by `user_id`
- RLS is enabled from the beginning
- Upload limit: `1GB`
- Supported input formats: `mp3`, `m4a`, `wav`
- Worker concurrency: `1`

### Phase 2

- Add product-facing account and billing behavior
- Refine per-user job management
- Add user-scoped storage paths if needed

Phase 1 should be implemented in a way that does not block Phase 2.

## High-Level Architecture

```txt
Browser
  -> Next.js App Router on Vercel
  -> Supabase Storage (audio upload)
  -> Supabase Postgres (jobs, segments)

Sakura VPS Worker
  -> Poll queued jobs from Supabase
  -> Download audio from Supabase Storage
  -> Split audio with ffmpeg
  -> Send chunks to OpenAI transcription API
  -> Normalize diarization output
  -> Save segments and Markdown to Supabase
```

## Responsibilities

### Next.js App

- Accept audio file upload
- Validate file type and file size
- Create transcription jobs
- Show job list and job detail pages
- Render transcript grouped by speaker
- Export Markdown

The app should not:

- Process long audio files
- Call `ffmpeg`
- Wait synchronously for transcription completion
- Host a public worker API unless explicitly required later

### Worker

- Poll for queued jobs
- Claim one job at a time
- Download source audio to a temporary directory
- Split long audio into chunks
- Call OpenAI transcription with diarization support
- Normalize transcription output into a stable segment format
- Save segments and generated Markdown
- Update job status and progress
- Delete temporary files in all cases

## Proposed Directory Structure

This is the target structure for the MVP implementation.

```txt
.
├── docs/
│   └── architecture.md
├── supabase/
│   └── migrations/
│       └── 0001_initial_transcription_schema.sql
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── jobs/
│   │   │   ├── page.tsx
│   │   │   └── [jobId]/
│   │   │       └── page.tsx
│   │   └── api/
│   │       └── jobs/
│   │           └── route.ts
│   ├── components/
│   │   ├── upload-form.tsx
│   │   ├── job-list.tsx
│   │   ├── job-status-badge.tsx
│   │   ├── transcript-view.tsx
│   │   └── markdown-export-button.tsx
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── browser.ts
│   │   │   ├── server.ts
│   │   │   └── admin.ts
│   │   ├── jobs.ts
│   │   ├── transcripts.ts
│   │   ├── storage.ts
│   │   └── markdown.ts
│   └── types/
│       └── database.ts
├── worker/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── config.ts
│   │   ├── supabase.ts
│   │   ├── poller.ts
│   │   ├── processor.ts
│   │   ├── ffmpeg.ts
│   │   ├── transcribe.ts
│   │   ├── normalize.ts
│   │   └── cleanup.ts
│   └── README.md
└── .env.example
```

## Data Model

### Core Tables

#### `transcription_jobs`

Represents one uploaded audio file and its asynchronous transcription lifecycle.

Suggested columns:

- `id uuid primary key`
- `user_id uuid not null references auth.users(id)`
- `original_filename text not null`
- `storage_bucket text not null`
- `storage_path text not null`
- `status transcription_job_status not null`
- `language text null`
- `duration_seconds integer null`
- `progress integer not null default 0`
- `attempt_count integer not null default 0`
- `error_message text null`
- `markdown text null`
- `worker_id text null`
- `locked_at timestamptz null`
- `started_at timestamptz null`
- `completed_at timestamptz null`
- `failed_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

#### `transcription_segments`

Stores normalized speaker-attributed transcript segments for a job.

Suggested columns:

- `id uuid primary key`
- `job_id uuid not null references transcription_jobs(id) on delete cascade`
- `speaker_label text not null`
- `start_sec numeric not null`
- `end_sec numeric not null`
- `text text not null`
- `chunk_index integer not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### Job Status Enum

```sql
create type transcription_job_status as enum (
  'queued',
  'processing',
  'completed',
  'failed'
);
```

### Indexes

Recommended indexes:

- `transcription_jobs(status, created_at)`
- `transcription_segments(job_id, segment_index)`

## Storage Design

### Supabase Storage Bucket

- Bucket name: `audio`

### Phase 1 Path Convention

```txt
jobs/{job_id}/source/{safe_original_filename}
```

### Possible Future Path Convention

```txt
users/{user_id}/jobs/{job_id}/source/{safe_original_filename}
```

To keep the Phase 2 migration easy, storage path generation should live in a dedicated helper module instead of being scattered through route handlers.

## Environment Variables

### Next.js

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

SUPABASE_SERVICE_ROLE_KEY=

NEXT_PUBLIC_APP_URL=
MAX_UPLOAD_SIZE_MB=1024
OPENAI_API_KEY=
OPENAI_PUNCTUATION_MODEL=
```

### Worker

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

OPENAI_API_KEY=
OPENAI_TRANSCRIPTION_MODEL=

WORKER_ID=sakura-vps-1
WORKER_LOCK_TIMEOUT_MINUTES=30
WORKER_MAX_LOCK_REFRESH_FAILURES=3
WORKER_MAX_ATTEMPTS=3
WORKER_POLL_INTERVAL_MS=10000
WORKER_CONCURRENCY=1
WORKER_TMP_DIR=/tmp/interview-transcriber
FFMPEG_PATH=ffmpeg

AUDIO_CHUNK_SECONDS=600
```

## Upload and Job Creation Flow

1. The user uploads an audio file from the web app.
2. The Next.js app validates file size and type.
3. The app creates a new job ID.
4. The audio file is uploaded to Supabase Storage.
5. A row is inserted into `transcription_jobs` with status `queued`.
6. The jobs list and detail pages read status from Supabase.

This keeps the web request short and durable.

## Worker Processing Flow

1. The worker polls Supabase for the next `queued` job.
2. The worker claims the job atomically and marks it `processing`.
3. The worker downloads the source audio from Supabase Storage.
4. The worker writes the file into a temporary working directory.
5. The worker splits audio into chunks using `ffmpeg`.
6. The worker sends each chunk to the OpenAI transcription API.
7. The worker normalizes diarization output into a common segment schema.
8. The worker inserts rows into `transcription_segments`.
9. The worker generates magazine-friendly Markdown.
10. The worker updates the job row to `completed`.
11. The worker deletes all temporary files.

### Failure Handling

If processing fails:

- Set `status = 'failed'`
- Store a short message in `error_message`
- Set `failed_at`
- Delete temporary files in a `finally` block

## Job Claiming Strategy

Even with worker concurrency set to `1`, job claiming should be atomic from the beginning so the system can scale to multiple workers later.

Preferred approach:

- Create a Supabase RPC function such as `claim_next_transcription_job(worker_id text)`
- Use SQL with `for update skip locked`

Target behavior:

- Oldest queued job is claimed first
- Only one worker can claim a given job
- Claimed jobs record `worker_id`, `locked_at`, and `started_at`

## Transcript Normalization

OpenAI transcription output may evolve. The worker should normalize model output into the app's internal segment format before saving.

Normalized segment shape:

```ts
type NormalizedSegment = {
  segmentIndex: number;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
};
```

This keeps the database and UI stable even if the upstream API response changes.

## Markdown Output

The MVP output should optimize for editorial editing rather than rich document formatting.

Example:

```md
# Interview Transcript

Source: interview-2026-05-07.m4a

## Speaker 1

[00:00:12] Thank you for joining us today.

## Speaker 2

[00:00:18] Thank you for having me.
```

The initial version can store generated Markdown in `transcription_jobs.markdown`.

## UI Scope for MVP

### Home Page

- Upload form
- Recent jobs summary

### Jobs Page

- Job list
- Filename
- Status
- Created time
- Progress

### Job Detail Page

- Job metadata
- Current status
- Failure message if present
- Transcript grouped by speaker
- Timestamps
- Markdown export action

## Boundaries and Module Rules

To keep the codebase maintainable:

- Keep Supabase server-side access in dedicated modules under `src/lib/supabase`
- Do not mix worker logic into Next.js route handlers
- Do not call service-role logic from client components
- Keep UI components small and focused
- Keep storage-path generation in a helper
- Keep Markdown generation separate from rendering logic

## Validation Rules

Validation should happen in both the app and the worker.

### Web App Validation

- Allowed extensions: `mp3`, `m4a`, `wav`
- Max file size: `1GB`
- Reject empty uploads

### Worker Validation

- Re-check input format after download
- Fail safely if the file cannot be decoded by `ffmpeg`

## Security Notes

Phase 1 is intentionally simple, but a few rules still matter:

- Do not commit secrets
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only
- Keep the worker private
- Delete temporary audio files after processing
- Avoid exposing raw internal worker operations over public HTTP

## Phase 2 Migration Notes

The code should be prepared for authentication without implementing it yet.

Planned additions:

- Add `user_id` to `transcription_jobs`
- Add authentication in the web app
- Add RLS policies for jobs and segments
- Change storage paths to user-scoped paths
- Filter job lists by owner

To make this migration easier:

- Centralize job access in app-layer modules
- Centralize storage path generation
- Avoid hardcoding shared-global assumptions in UI code

## Initial Implementation Order

1. Add Supabase migration files for tables, enum, and indexes
2. Add `.env.example`
3. Add Supabase helper modules for browser, server, and admin usage
4. Implement upload and job creation flow
5. Implement jobs list and job detail pages
6. Add worker skeleton with polling and claim logic
7. Add audio download and `ffmpeg` chunking
8. Add OpenAI transcription integration and normalization
9. Add Markdown generation and export
10. Tighten failure handling and cleanup

## Open Decisions

These are intentionally deferred until implementation:

- Exact OpenAI transcription model name
- Exact diarization response mapping
- Whether job progress is chunk-based or stage-based
- Whether Markdown should also be exportable as a file download in Phase 1
