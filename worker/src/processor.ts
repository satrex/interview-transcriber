import { rm } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";
import { splitAudioIntoChunks } from "./ffmpeg.js";
import { probeAudio } from "./ffprobe.js";
import {
  assertJobClaimActive,
  updateJobAudioChunkDuration,
  updateJobAudioDuration,
  markJobCompleted,
  touchJobLock,
  updateJobProgress,
} from "./jobs.js";
import { clearJobSegments, saveSegments } from "./segments.js";
import { downloadJobAudio, uploadJobAudioChunks } from "./storage.js";
import type { TranscriptionJob } from "./supabase.js";
import { loadTermDictionaryPrompt } from "./term-dictionaries.js";
import {
  createOpenAIClient,
  OpenAITranscriptionError,
  transcribeChunk,
} from "./transcribe.js";
import { formatErrorMessage } from "./retry.js";

export class PermanentJobFailure extends Error {
  readonly errorCode = "processing_error";
  readonly processedAudioSeconds: number | null;

  constructor(message: string, processedAudioSeconds: number | null = null) {
    super(message);
    this.name = "PermanentJobFailure";
    this.processedAudioSeconds = processedAudioSeconds;
  }
}

export class FinalJobFailure extends Error {
  readonly errorCode: string;
  readonly processedAudioSeconds: number | null;

  constructor(
    message: string,
    options: {
      cause?: unknown;
      errorCode: string;
      processedAudioSeconds: number | null;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "FinalJobFailure";
    this.errorCode = options.errorCode;
    this.processedAudioSeconds = options.processedAudioSeconds;
  }
}

export async function processJob(
  supabase: SupabaseClient,
  config: WorkerConfig,
  job: TranscriptionJob,
) {
  let jobTmpDir: string | null = null;
  let audioDurationSec: number | null = null;
  let processedAudioSeconds: number | null = null;
  const heartbeat = startHeartbeat(supabase, job, {
    lockTimeoutMinutes: config.lockTimeoutMinutes,
    maxFailures: config.maxLockRefreshFailures,
  });

  try {
    console.log(`[worker] downloading job ${job.id}: ${job.storage_path}`);
    const downloaded = await downloadJobAudio(supabase, job, config.tmpDir);
    jobTmpDir = downloaded.jobTmpDir;

    console.log(
      `[worker] downloaded ${downloaded.bytes} bytes to ${downloaded.localPath}`,
    );

    const audioInfo = await probeAudio(config.ffprobePath, downloaded.localPath);
    audioDurationSec = audioInfo.durationSec;

    console.log("[worker] ffprobe audio info:");
    console.log(JSON.stringify(audioInfo, null, 2));
    await updateJobAudioDuration(supabase, job, audioDurationSec);

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

    try {
      const uploadedChunks = await uploadJobAudioChunks(supabase, job, chunks);
      await updateJobAudioChunkDuration(supabase, job, config.audioChunkSeconds);
      console.log(
        `[worker] uploaded ${uploadedChunks.length} browser audio chunk(s) for job ${job.id}`,
      );
    } catch (error) {
      console.warn(
        `[worker] failed to upload browser audio chunks for job ${job.id}; continuing with transcription. Segment playback will fall back to source audio. ${formatErrorMessage(error)}`,
      );
    }

    const openai = createOpenAIClient(config.openaiApiKey);
    const termDictionaryPrompt = await loadTermDictionaryPrompt(supabase, job);
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
        promptSuffix: termDictionaryPrompt,
      }).catch((error) => {
        console.error(
          `[worker] transcription API failed for job ${job.id} chunk ${chunk.chunkIndex}: ${formatErrorMessage(error)}`,
        );
        throw error;
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

      heartbeat.assertHealthy();
      await assertJobClaimActive(supabase, job);
      await saveSegments(supabase, job.id, job.user_id, segments);

      const progress = calculateProgress(chunk.chunkIndex + 1, chunks.length);
      processedAudioSeconds = calculateProcessedAudioSeconds({
        audioDurationSec,
        completedChunks: chunk.chunkIndex + 1,
        chunkSeconds: config.audioChunkSeconds,
      });
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
        processedAudioSeconds,
      );
    }

    await markJobCompleted(supabase, job, audioDurationSec);
    console.log(
      `[worker] completed job ${job.id}; saved ${totalSavedSegmentsCount} segment(s), skipped ${totalSkippedSegmentsCount} empty segment(s)`,
    );
  } catch (error) {
    if (error instanceof OpenAITranscriptionError) {
      throw new FinalJobFailure(error.message, {
        cause: error,
        errorCode: error.errorCode,
        processedAudioSeconds,
      });
    }

    throw error;
  } finally {
    heartbeat.stop();

    if (jobTmpDir) {
      await rm(jobTmpDir, { recursive: true, force: true });
      console.log(`[worker] cleaned temporary directory ${jobTmpDir}`);
    }
  }
}

function calculateProcessedAudioSeconds(options: {
  audioDurationSec: number | null;
  chunkSeconds: number;
  completedChunks: number;
}) {
  const processedByChunks = options.completedChunks * options.chunkSeconds;

  if (options.audioDurationSec === null) {
    return processedByChunks;
  }

  return Math.min(options.audioDurationSec, processedByChunks);
}

function startHeartbeat(
  supabase: SupabaseClient,
  job: TranscriptionJob,
  options: {
    lockTimeoutMinutes: number;
    maxFailures: number;
  },
) {
  const intervalMs = Math.max(
    30_000,
    Math.min(60_000, (options.lockTimeoutMinutes * 60_000) / 2),
  );
  let consecutiveFailures = 0;
  let fatalError: Error | null = null;
  let isRefreshing = false;

  const interval = setInterval(() => {
    if (isRefreshing || fatalError) {
      return;
    }

    isRefreshing = true;
    touchJobLock(supabase, job)
      .then(() => {
        consecutiveFailures = 0;
      })
      .catch((error) => {
        consecutiveFailures += 1;
        console.error(
          `[worker] Supabase lock refresh failed for job ${job.id} (${consecutiveFailures}/${options.maxFailures} consecutive refresh operation failures): ${formatErrorMessage(error)}`,
        );

        if (consecutiveFailures >= options.maxFailures) {
          fatalError = new Error(
            `Supabase lock refresh failed ${consecutiveFailures} consecutive time(s): ${formatErrorMessage(error)}`,
          );
        }
      })
      .finally(() => {
        isRefreshing = false;
      });
  }, intervalMs);

  return {
    assertHealthy() {
      if (fatalError) {
        throw fatalError;
      }
    },
    stop() {
      clearInterval(interval);
    },
  };
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
