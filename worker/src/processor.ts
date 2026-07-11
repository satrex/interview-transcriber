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
import { updateProjectProgress } from "./projects.js";
import {
  computeSegmentPan,
  extractPanEnvelope,
  relabelSegmentsByPan,
  type PanEnvelope,
} from "./pan.js";
import {
  buildSpeakerReferenceDataUrl,
  selectReferenceCandidates,
  type KnownSpeaker,
} from "./speaker-references.js";
import {
  createOpenAIClient,
  NEW_SPEAKER_LABEL_PREFIX,
  OpenAITranscriptionError,
  type NormalizedSegment,
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

export class RetryableJobFailure extends Error {
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
    this.name = "RetryableJobFailure";
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
    const downloaded = await downloadJobAudio(
      supabase,
      job,
      config.tmpDir,
      config.downloadTimeoutSeconds,
    );
    jobTmpDir = downloaded.jobTmpDir;

    console.log(
      `[worker] downloaded ${downloaded.bytes} bytes to ${downloaded.localPath}`,
    );

    const audioInfo = await probeAudio(
      config.ffprobePath,
      downloaded.localPath,
      config.ffmpegTimeoutSeconds * 1000,
    );
    audioDurationSec = audioInfo.durationSec;

    console.log("[worker] ffprobe audio info:");
    console.log(JSON.stringify(audioInfo, null, 2));
    await updateJobAudioDuration(supabase, job, audioDurationSec);

    const firstAudioStream = audioInfo.streams.find(
      (stream) => stream.codecType === "audio",
    );
    let panEnvelope: PanEnvelope | null = null;

    if (config.panRelabelEnabled && firstAudioStream?.channels === 2) {
      try {
        console.log(`[worker] extracting stereo pan envelope for job ${job.id}`);
        panEnvelope = await extractPanEnvelope({
          ffmpegPath: config.ffmpegPath,
          inputPath: downloaded.localPath,
          timeoutMs: config.ffmpegTimeoutSeconds * 1000,
        });
        console.log(
          `[worker] extracted pan envelope for job ${job.id}: ${panEnvelope.left.length} window(s)`,
        );
      } catch (error) {
        console.warn(
          `[worker] failed to extract pan envelope for job ${job.id}; continuing without pan relabel. ${formatErrorMessage(error)}`,
        );
        panEnvelope = null;
      }
    } else if (config.panRelabelEnabled) {
      console.log(
        `[worker] pan relabel skipped for job ${job.id}: first audio stream has ${firstAudioStream?.channels ?? "unknown"} channel(s)`,
      );
    }

    console.log(
      `[worker] splitting audio into ${config.audioChunkSeconds}s chunks`,
    );

    const chunks = await splitAudioIntoChunks({
      ffmpegPath: config.ffmpegPath,
      inputPath: downloaded.localPath,
      outputDir: `${downloaded.jobTmpDir}/chunks`,
      jobId: job.id,
      chunkSeconds: config.audioChunkSeconds,
      timeoutMs: config.ffmpegTimeoutSeconds * 1000,
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

    const openai = createOpenAIClient(
      config.openaiApiKey,
      config.openaiTranscriptionTimeoutSeconds,
    );
    const termDictionaryPrompt = await loadTermDictionaryPrompt(supabase, job);
    if (termDictionaryPrompt) {
      console.warn(
        "[worker] term dictionary prompt generated but omitted because prompt is not supported for diarization models",
      );
    }
    await assertJobClaimActive(supabase, job);
    await clearJobSegments(supabase, job.id);
    await updateJobProgress(supabase, job, job.progress, 0);

    let totalSavedSegmentsCount = 0;
    let totalSkippedSegmentsCount = 0;
    const allSegments: NormalizedSegment[] = [];
    const knownSpeakers: KnownSpeaker[] = [];
    const apiNewLabelToDisplayLabel = new Map<string, string>();
    let speakerReferencesEnabled = config.speakerReferencesEnabled;

    for (const chunk of chunks) {
      const chunkStartSec = chunk.chunkIndex * config.audioChunkSeconds;

      console.log(
        `[worker] transcribing chunk ${chunk.chunkIndex} starting at ${chunkStartSec}s`,
      );

      await touchJobLock(supabase, job);

      const transcribed = await transcribeChunkWithOptionalReferences({
        openai,
        model: config.openaiTranscriptionModel,
        chunk,
        chunkStartSec,
        promptSuffix: termDictionaryPrompt,
        knownSpeakers:
          speakerReferencesEnabled && knownSpeakers.length > 0
            ? knownSpeakers
            : undefined,
        disableReferences() {
          speakerReferencesEnabled = false;
        },
      }).catch((error) => {
        console.error(
          `[worker] transcription API failed for job ${job.id} chunk ${chunk.chunkIndex}: ${formatErrorMessage(error)}`,
        );
        throw error;
      });
      const segments = assignDisplayLabels(transcribed.segments, {
        knownSpeakers,
        apiNewLabelToDisplayLabel,
        expectedSpeakerCount: job.expected_speaker_count,
      });
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
      allSegments.push(...segments);

      if (speakerReferencesEnabled && knownSpeakers.length < 4) {
        await addSpeakerReferencesFromChunk({
          config,
          chunkPath: chunk.path,
          chunkStartSec,
          outDir: `${downloaded.jobTmpDir}/speaker-references`,
          knownSpeakers,
          segments,
          panEnvelope,
          expectedSpeakerCount: job.expected_speaker_count,
        });
      }

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

    if (panEnvelope) {
      try {
        const relabeled = relabelSegmentsByPan({
          segments: allSegments,
          envelope: panEnvelope,
          expectedSpeakerCount: job.expected_speaker_count,
        });
        console.log(`[worker] ${relabeled.summary}`);

        if (relabeled.applied) {
          const changedSegments = relabeled.segments.filter((segment, index) => {
            return segment.speakerLabel !== allSegments[index]?.speakerLabel;
          });

          for (const chunkSegments of groupSegmentsByChunk(changedSegments)) {
            await saveSegments(supabase, job.id, job.user_id, chunkSegments);
          }

          console.log(
            `[worker] pan relabel resaved ${changedSegments.length} changed segment(s) for job ${job.id}`,
          );
        }
      } catch (error) {
        console.warn(
          `[worker] pan relabel failed for job ${job.id}; keeping API speaker labels. ${formatErrorMessage(error)}`,
        );
      }
    }

    await markJobCompleted(supabase, job, audioDurationSec);
    console.log(
      `[worker] completed job ${job.id}; saved ${totalSavedSegmentsCount} segment(s), skipped ${totalSkippedSegmentsCount} empty segment(s)`,
    );

    // Update project progress if this is a project part
    if (job.project_id && job.is_project_part) {
      await updateProjectProgress(supabase, job.project_id);
    }
  } catch (error) {
    if (error instanceof OpenAITranscriptionError) {
      const FailureClass =
        error.errorCode === "quota_exceeded" ||
        error.errorCode === "unsupported_prompt_for_diarization"
          ? FinalJobFailure
          : RetryableJobFailure;

      throw new FailureClass(error.message, {
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

async function transcribeChunkWithOptionalReferences(
  options: Parameters<typeof transcribeChunk>[0] & {
    disableReferences: () => void;
  },
) {
  try {
    return await transcribeChunk(options);
  } catch (error) {
    if (
      error instanceof OpenAITranscriptionError &&
      error.errorCode === "invalid_speaker_reference" &&
      options.knownSpeakers &&
      options.knownSpeakers.length > 0
    ) {
      console.warn(
        `[worker] OpenAI rejected known speaker references for chunk ${options.chunk.chunkIndex}; retrying this chunk without references and disabling references for the rest of the job. ${formatErrorMessage(error)}`,
      );
      options.disableReferences();
      return transcribeChunk({
        ...options,
        knownSpeakers: undefined,
      });
    }

    throw error;
  }
}

function assignDisplayLabels(
  segments: NormalizedSegment[],
  options: {
    knownSpeakers: KnownSpeaker[];
    apiNewLabelToDisplayLabel: Map<string, string>;
    expectedSpeakerCount: number | null;
  },
) {
  const usedLabels = new Set(options.knownSpeakers.map((speaker) => speaker.displayLabel));
  for (const label of options.apiNewLabelToDisplayLabel.values()) {
    usedLabels.add(label);
  }

  return segments.map((segment) => {
    if (!segment.speakerLabel.startsWith(NEW_SPEAKER_LABEL_PREFIX)) {
      usedLabels.add(segment.speakerLabel);
      return segment;
    }

    const apiLabel = segment.speakerLabel.slice(NEW_SPEAKER_LABEL_PREFIX.length);
    const key = apiLabel;
    let displayLabel = options.apiNewLabelToDisplayLabel.get(key);

    if (!displayLabel) {
      displayLabel = nextDisplayLabel(usedLabels, options.expectedSpeakerCount);
      options.apiNewLabelToDisplayLabel.set(key, displayLabel);
      usedLabels.add(displayLabel);
    }

    return { ...segment, speakerLabel: displayLabel };
  });
}

async function addSpeakerReferencesFromChunk(options: {
  config: WorkerConfig;
  chunkPath: string;
  chunkStartSec: number;
  outDir: string;
  knownSpeakers: KnownSpeaker[];
  segments: NormalizedSegment[];
  panEnvelope: PanEnvelope | null;
  expectedSpeakerCount: number | null;
}) {
  const softCap = clamp(options.expectedSpeakerCount ?? 4, 1, 4);
  const knownDisplayLabels = new Set(
    options.knownSpeakers.map((speaker) => speaker.displayLabel),
  );

  if (options.knownSpeakers.length >= softCap) {
    return;
  }

  const segmentPans = options.panEnvelope
    ? new Map(
        options.segments.map((segment) => [
          segment.segmentIndex,
          computeSegmentPan(options.panEnvelope!, segment.startSec, segment.endSec),
        ]),
      )
    : undefined;
  const candidates = selectReferenceCandidates(
    options.segments,
    knownDisplayLabels,
    segmentPans,
    options.chunkStartSec,
  );

  for (const candidate of candidates) {
    if (options.knownSpeakers.length >= softCap || options.knownSpeakers.length >= 4) {
      return;
    }

    if (knownDisplayLabels.has(candidate.apiLabel)) {
      continue;
    }

    try {
      const dataUrl = await buildSpeakerReferenceDataUrl({
        ffmpegPath: options.config.ffmpegPath,
        chunkPath: options.chunkPath,
        startSec: candidate.startInChunkSec,
        durationSec: candidate.endInChunkSec - candidate.startInChunkSec,
        timeoutMs: options.config.ffmpegTimeoutSeconds * 1000,
        outDir: options.outDir,
      });
      const speaker: KnownSpeaker = {
        name: `S${options.knownSpeakers.length + 1}`,
        displayLabel: candidate.apiLabel,
        dataUrl,
      };
      options.knownSpeakers.push(speaker);
      knownDisplayLabels.add(speaker.displayLabel);
      console.log(
        `[worker] added known speaker reference ${speaker.name}->${speaker.displayLabel} from ${candidate.startInChunkSec}s-${candidate.endInChunkSec}s`,
      );
    } catch (error) {
      console.warn(
        `[worker] failed to build speaker reference for label ${candidate.apiLabel}; will retry from a later chunk if possible. ${formatErrorMessage(error)}`,
      );
    }
  }
}

function groupSegmentsByChunk(segments: NormalizedSegment[]) {
  const groups = new Map<number, NormalizedSegment[]>();

  for (const segment of segments) {
    const group = groups.get(segment.chunkIndex) ?? [];
    group.push(segment);
    groups.set(segment.chunkIndex, group);
  }

  return [...groups.values()];
}

function nextDisplayLabel(usedLabels: Set<string>, expectedSpeakerCount: number | null) {
  const maxLabels = clamp(expectedSpeakerCount ?? 4, 1, 4);

  for (let i = 0; i < maxLabels; i++) {
    const label = String.fromCharCode("A".charCodeAt(0) + i);
    if (!usedLabels.has(label)) {
      return label;
    }
  }

  for (let i = 0; i < 4; i++) {
    const label = String.fromCharCode("A".charCodeAt(0) + i);
    if (!usedLabels.has(label)) {
      return label;
    }
  }

  return "D";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
