import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type OpenAI from "openai";
import type { WorkerConfig } from "./config.js";
import { splitAudioIntoChunks, type AudioChunk } from "./ffmpeg.js";
import { formatErrorMessage } from "./retry.js";
import type { TranscriptionJob } from "./supabase.js";
import {
  isDiarizeContentFailure,
  transcribeChunk,
  transcribeChunkWithWhisper,
  type NormalizedSegment,
  type TranscribedChunk,
} from "./transcribe.js";

/**
 * Recovers a chunk that the diarize model deterministically fails on (the
 * overlap-heavy content 500 / hang). Re-splits the chunk into smaller
 * sub-chunks and transcribes each with diarization; any sub-chunk that still
 * fails the same way falls back to whisper-1 (no speaker labels). Segments are
 * merged back under the original chunk index with a fresh 0-based segmentIndex
 * so the (job_id, chunk_index, segment_index) upsert key stays unique.
 *
 * Known speaker references are intentionally not sent on this path.
 */
export async function transcribeChunkWithDiarizeFallback(options: {
  openai: OpenAI;
  config: WorkerConfig;
  job: TranscriptionJob;
  chunk: AudioChunk;
  chunkStartSec: number;
  promptSuffix?: string | null;
  fallbackDir: string;
  assertHealthy: () => void;
}): Promise<TranscribedChunk> {
  const subchunkSeconds = options.config.diarizeFallbackSubchunkSeconds;
  const outputDir = join(options.fallbackDir, `chunk_${options.chunk.chunkIndex}`);
  await mkdir(outputDir, { recursive: true });

  const subChunks = await splitAudioIntoChunks({
    ffmpegPath: options.config.ffmpegPath,
    inputPath: options.chunk.path,
    outputDir,
    jobId: `${options.job.id}_fb${options.chunk.chunkIndex}`,
    chunkSeconds: subchunkSeconds,
    timeoutMs: options.config.ffmpegTimeoutSeconds * 1000,
  });

  console.log(
    `[worker] chunk ${options.chunk.chunkIndex} split into ${subChunks.length} fallback sub-chunk(s) of ${subchunkSeconds}s`,
  );

  const mergedSegments: NormalizedSegment[] = [];
  let skippedSegmentsCount = 0;
  let sourceSegmentsCount = 0;

  for (const subChunk of subChunks) {
    options.assertHealthy();

    const subChunkStartSec =
      options.chunkStartSec + subChunk.chunkIndex * subchunkSeconds;

    const transcribed = await transcribeSubChunk({
      openai: options.openai,
      config: options.config,
      chunk: subChunk,
      chunkStartSec: subChunkStartSec,
      promptSuffix: options.promptSuffix,
    });

    for (const segment of transcribed.segments) {
      mergedSegments.push(segment);
    }
    skippedSegmentsCount += transcribed.skippedSegmentsCount;
    sourceSegmentsCount += transcribed.sourceSegmentsCount;
  }

  mergedSegments.sort((a, b) => a.startSec - b.startSec);

  const segments = mergedSegments.map((segment, index) => ({
    ...segment,
    chunkIndex: options.chunk.chunkIndex,
    segmentIndex: index,
  }));

  return {
    segments,
    skippedSegmentsCount,
    sourceSegmentsCount,
  };
}

async function transcribeSubChunk(options: {
  openai: OpenAI;
  config: WorkerConfig;
  chunk: AudioChunk;
  chunkStartSec: number;
  promptSuffix?: string | null;
}): Promise<TranscribedChunk> {
  try {
    return await transcribeChunk({
      openai: options.openai,
      model: options.config.openaiTranscriptionModel,
      chunk: options.chunk,
      chunkStartSec: options.chunkStartSec,
      promptSuffix: options.promptSuffix,
      knownSpeakers: undefined,
    });
  } catch (error) {
    if (!isDiarizeContentFailure(error)) {
      throw error;
    }

    console.warn(
      `[worker] sub-chunk ${options.chunk.chunkIndex} fell back to whisper-1 (no diarization); speaker labels need manual review. ${formatErrorMessage(error)}`,
    );

    return transcribeChunkWithWhisper({
      openai: options.openai,
      chunk: options.chunk,
      chunkStartSec: options.chunkStartSec,
      promptSuffix: options.promptSuffix,
    });
  }
}
