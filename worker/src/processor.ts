import { rm } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";
import { splitAudioIntoChunks } from "./ffmpeg.js";
import { probeAudio } from "./ffprobe.js";
import {
  assertJobClaimActive,
  markJobCompleted,
  touchJobLock,
  updateJobProgress,
} from "./jobs.js";
import { clearJobSegments, saveSegments } from "./segments.js";
import { downloadJobAudio } from "./storage.js";
import type { TranscriptionJob } from "./supabase.js";
import { createOpenAIClient, transcribeChunk } from "./transcribe.js";

export class PermanentJobFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobFailure";
  }
}

export async function processJob(
  supabase: SupabaseClient,
  config: WorkerConfig,
  job: TranscriptionJob,
) {
  let jobTmpDir: string | null = null;
  const heartbeat = startHeartbeat(supabase, job, config.lockTimeoutMinutes);

  try {
    console.log(`[worker] downloading job ${job.id}: ${job.storage_path}`);
    const downloaded = await downloadJobAudio(supabase, job, config.tmpDir);
    jobTmpDir = downloaded.jobTmpDir;

    console.log(
      `[worker] downloaded ${downloaded.bytes} bytes to ${downloaded.localPath}`,
    );

    const audioInfo = await probeAudio(config.ffprobePath, downloaded.localPath);

    console.log("[worker] ffprobe audio info:");
    console.log(JSON.stringify(audioInfo, null, 2));

    console.log(
      `[worker] splitting audio into ${config.audioChunkSeconds}s chunks`,
    );

    const chunks = await splitAudioIntoChunks({
      ffmpegPath: config.ffmpegPath,
      inputPath: downloaded.localPath,
      outputDir: `${downloaded.jobTmpDir}/chunks`,
      jobId: job.id,
      chunkSeconds: config.audioChunkSeconds,
    });

    if (chunks.length === 0) {
      throw new Error("ffmpeg did not create any audio chunks.");
    }

    console.log(`[worker] created ${chunks.length} chunk file(s):`);

    for (const chunk of chunks) {
      console.log(
        `[worker] chunk ${chunk.chunkIndex}: ${chunk.path} (${chunk.bytes} bytes)`,
      );
    }

    const openai = createOpenAIClient(config.openaiApiKey);
    await assertJobClaimActive(supabase, job);
    await clearJobSegments(supabase, job.id);
    await updateJobProgress(supabase, job, job.progress, 0);

    let totalSavedSegmentsCount = 0;
    let totalSkippedSegmentsCount = 0;

    for (const chunk of chunks) {
      const chunkStartSec = chunk.chunkIndex * config.audioChunkSeconds;

      console.log(
        `[worker] transcribing chunk ${chunk.chunkIndex} starting at ${chunkStartSec}s`,
      );

      await touchJobLock(supabase, job);

      const transcribed = await transcribeChunk({
        openai,
        model: config.openaiTranscriptionModel,
        chunk,
        chunkStartSec,
      });
      const { segments } = transcribed;
      totalSavedSegmentsCount += segments.length;
      totalSkippedSegmentsCount += transcribed.skippedSegmentsCount;

      if (transcribed.skippedSegmentsCount > 0) {
        console.warn(
          `[worker] skipped ${transcribed.skippedSegmentsCount} empty segment(s) for chunk ${chunk.chunkIndex}`,
        );
      }

      if (segments.length === 0) {
        console.warn(
          `[worker] chunk ${chunk.chunkIndex} produced 0 usable segment(s) from ${transcribed.sourceSegmentsCount} source segment(s); continuing`,
        );
      }

      await assertJobClaimActive(supabase, job);
      await saveSegments(supabase, job.id, job.user_id, segments);

      const progress = calculateProgress(chunk.chunkIndex + 1, chunks.length);
      await updateJobProgress(
        supabase,
        job,
        progress,
        totalSkippedSegmentsCount,
      );

      console.log(
        `[worker] saved ${segments.length} segment(s) for chunk ${chunk.chunkIndex}; skipped ${transcribed.skippedSegmentsCount}; progress ${progress}%`,
      );
    }

    if (totalSavedSegmentsCount === 0) {
      throw new PermanentJobFailure(
        `OpenAI transcription produced 0 usable segments across ${chunks.length} chunk(s); skipped ${totalSkippedSegmentsCount} empty segment(s).`,
      );
    }

    await markJobCompleted(supabase, job);
    console.log(
      `[worker] completed job ${job.id}; saved ${totalSavedSegmentsCount} segment(s), skipped ${totalSkippedSegmentsCount} empty segment(s)`,
    );
  } finally {
    clearInterval(heartbeat);

    if (jobTmpDir) {
      await rm(jobTmpDir, { recursive: true, force: true });
      console.log(`[worker] cleaned temporary directory ${jobTmpDir}`);
    }
  }
}

function startHeartbeat(
  supabase: SupabaseClient,
  job: TranscriptionJob,
  lockTimeoutMinutes: number,
) {
  const intervalMs = Math.max(
    30_000,
    Math.min(60_000, (lockTimeoutMinutes * 60_000) / 2),
  );

  return setInterval(() => {
    touchJobLock(supabase, job).catch((error) => {
      console.error(
        `[worker] failed to refresh lock for job ${job.id}:`,
        error instanceof Error ? error.message : error,
      );
    });
  }, intervalMs);
}

function calculateProgress(completedChunks: number, totalChunks: number) {
  const transcriptionRangeStart = 10;
  const transcriptionRangeEnd = 99;
  const progress =
    transcriptionRangeStart +
    ((transcriptionRangeEnd - transcriptionRangeStart) * completedChunks) /
      totalChunks;

  return Math.min(99, Math.max(10, Math.round(progress)));
}
