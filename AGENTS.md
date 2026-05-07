<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Project: Interview Transcriber

## Goal
Build a web app for magazine/interview transcription.

The app accepts long audio recordings, typically around 2 hours, and turns them into editable interview material with speaker diarization, timestamps, and magazine-editing friendly Markdown.

## Architecture
- Frontend: Next.js App Router + TypeScript
- Hosting: Vercel
- Database: Supabase Postgres
- Storage: Supabase Storage
- Background worker: Sakura VPS
- Worker runtime: Node.js or Python, selected for simplicity
- Audio processing: ffmpeg
- Transcription engine: OpenAI high-accuracy transcription with diarization
- The Vercel app must not perform long-running audio processing directly.

## Core constraints
- Treat transcription as an async job.
- Use a jobs table as the center of the system.
- Vercel creates jobs and displays progress.
- The VPS worker polls queued jobs from Supabase.
- Audio files are stored in Supabase Storage.
- Temporary audio files on the worker must be deleted after processing.
- Do not expose the worker as a public API unless explicitly requested.
- Start with concurrency = 1.
- Prefer simple, durable code over clever abstractions.

## MVP features
1. Upload audio file.
2. Create transcription job.
3. Show job list and status.
4. Worker picks queued job.
5. Worker downloads audio.
6. Worker splits audio with ffmpeg.
7. Worker sends chunks to OpenAI transcription API with diarization.
8. Worker saves segments to Supabase.
9. Web app displays transcript grouped by speaker.
10. Export Markdown.

## Database draft
Tables:
- transcription_jobs
- transcription_segments

Job statuses:
- queued
- processing
- completed
- failed

## Coding style
- TypeScript strict.
- Keep server-side Supabase logic in dedicated modules.
- Keep UI components small.
- Do not mix worker logic into Next.js route handlers.
- Do not add unnecessary real-time features yet.
- Do not add video support yet.
- Do not build a complex editor yet.

## Definition of done
For each task:
- Code builds.
- TypeScript passes.
- Important errors are handled.
- Environment variables are documented.
- No secrets are committed.

<!-- END:nextjs-agent-rules -->
