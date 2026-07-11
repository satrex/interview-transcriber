import { createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import type OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedSegment } from "./transcribe.js";
import { formatErrorMessage } from "./retry.js";
import { TRANSCRIPTION_LANGUAGE, TRANSCRIPTION_TEMPERATURE } from "./transcribe.js";

const MIX_RESPLIT_MAX_SEGMENTS = 100;
const MIX_RESPLIT_PADDING_SEC = 0.2;
const MIX_RESPLIT_MODEL = "gpt-4o-transcribe";

type SegmentRow = {
  id: string;
  chunk_index: number;
  segment_index: number;
};

export async function resplitMixSuspects(options: {
  supabase: SupabaseClient;
  openai: OpenAI;
  ffmpegPath: string;
  inputPath: string;
  timeoutMs: number;
  outDir: string;
  jobId: string;
  centers: number[];
  labelsByCluster: Map<number, string>;
  segments: NormalizedSegment[];
}) {
  const suspects = options.segments
    .filter(
      (segment) =>
        segment.mixSuspectBoundarySec !== null &&
        segment.mixSuspectBoundarySec !== undefined,
    )
    .slice(0, MIX_RESPLIT_MAX_SEGMENTS);

  if (suspects.length === 0) {
    return { insertedCount: 0, processedCount: 0 };
  }

  await mkdir(options.outDir, { recursive: true });

  let processedCount = 0;
  let insertedCount = 0;

  for (const segment of suspects) {
    try {
      const row = await fetchSegmentRow(options.supabase, options.jobId, segment);

      if (!row) {
        continue;
      }

      if (await hasSegmentEdit(options.supabase, row.id)) {
        console.warn(
          `[worker] mix resplit skipped edited segment ${row.id} for job ${options.jobId}`,
        );
        continue;
      }

      const ownClusterIndex = findClusterForLabel(
        options.labelsByCluster,
        segment.speakerLabel,
      );
      const intruderClusterIndex = findClusterForLabel(
        options.labelsByCluster,
        segment.mixSuspectSpeakerLabel ?? "",
      );

      if (ownClusterIndex === null || intruderClusterIndex === null) {
        continue;
      }

      const ownChannel = options.centers[ownClusterIndex] < 0 ? "FL" : "FR";
      const intruderChannel =
        options.centers[intruderClusterIndex] < 0 ? "FL" : "FR";
      const basePath = `${options.outDir}/${segment.chunkIndex}-${segment.segmentIndex}`;
      const mainPath = `${basePath}-main.wav`;
      const intruderPath = `${basePath}-intruder.wav`;

      await extractMonoRegion({
        channel: ownChannel,
        ffmpegPath: options.ffmpegPath,
        inputPath: options.inputPath,
        outputPath: mainPath,
        startSec: Math.max(0, segment.startSec - MIX_RESPLIT_PADDING_SEC),
        endSec: segment.endSec + MIX_RESPLIT_PADDING_SEC,
        timeoutMs: options.timeoutMs,
      });

      await extractMonoRegion({
        channel: intruderChannel,
        ffmpegPath: options.ffmpegPath,
        inputPath: options.inputPath,
        outputPath: intruderPath,
        startSec: Math.max(
          0,
          (segment.mixSuspectBoundarySec ?? segment.startSec) -
            MIX_RESPLIT_PADDING_SEC,
        ),
        endSec: segment.endSec + MIX_RESPLIT_PADDING_SEC,
        timeoutMs: options.timeoutMs,
      });

      const mainText = await transcribeMono(options.openai, mainPath);
      const intruderText = await transcribeMono(options.openai, intruderPath);

      if (mainText) {
        const { error } = await options.supabase
          .from("transcription_segments")
          .update({
            text: mainText,
            mix_suspect_boundary_sec: null,
            mix_suspect_speaker_label: null,
          })
          .eq("id", row.id);

        if (error) {
          throw new Error(`Failed to update resplit segment: ${error.message}`);
        }
      }

      if (intruderText) {
        const nextIndex = await nextSegmentIndex(
          options.supabase,
          options.jobId,
          segment.chunkIndex,
        );
        const { error } = await options.supabase
          .from("transcription_segments")
          .insert({
            job_id: options.jobId,
            speaker_label: segment.mixSuspectSpeakerLabel ?? segment.speakerLabel,
            start_sec: segment.mixSuspectBoundarySec ?? segment.startSec,
            end_sec: segment.endSec,
            text: intruderText,
            chunk_index: segment.chunkIndex,
            segment_index: nextIndex,
          });

        if (error) {
          throw new Error(`Failed to insert resplit segment: ${error.message}`);
        }

        insertedCount += 1;
      }

      await rm(mainPath, { force: true });
      await rm(intruderPath, { force: true });
      processedCount += 1;
    } catch (error) {
      console.warn(
        `[worker] mix resplit skipped job ${options.jobId} chunk ${segment.chunkIndex} segment ${segment.segmentIndex}: ${formatErrorMessage(error)}`,
      );
    }
  }

  return { insertedCount, processedCount };
}

async function fetchSegmentRow(
  supabase: SupabaseClient,
  jobId: string,
  segment: NormalizedSegment,
) {
  const { data, error } = await supabase
    .from("transcription_segments")
    .select("id, chunk_index, segment_index")
    .eq("job_id", jobId)
    .eq("chunk_index", segment.chunkIndex)
    .eq("segment_index", segment.segmentIndex)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load segment row: ${error.message}`);
  }

  return data as SegmentRow | null;
}

async function hasSegmentEdit(supabase: SupabaseClient, segmentId: string) {
  const { data, error } = await supabase
    .from("transcription_segment_edits")
    .select("segment_id")
    .eq("segment_id", segmentId)
    .limit(1);

  if (error) {
    throw new Error(`Failed to load segment edits: ${error.message}`);
  }

  return (data || []).length > 0;
}

async function nextSegmentIndex(
  supabase: SupabaseClient,
  jobId: string,
  chunkIndex: number,
) {
  const { data, error } = await supabase
    .from("transcription_segments")
    .select("segment_index")
    .eq("job_id", jobId)
    .eq("chunk_index", chunkIndex)
    .order("segment_index", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load max segment index: ${error.message}`);
  }

  const current = Number(data?.[0]?.segment_index ?? -1);

  return Number.isFinite(current) ? current + 1 : 0;
}

async function extractMonoRegion(options: {
  channel: "FL" | "FR";
  ffmpegPath: string;
  inputPath: string;
  outputPath: string;
  startSec: number;
  endSec: number;
  timeoutMs: number;
}) {
  await mkdir(dirname(options.outputPath), { recursive: true });

  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(
      options.ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        options.startSec.toFixed(3),
        "-t",
        Math.max(0.1, options.endSec - options.startSec).toFixed(3),
        "-i",
        options.inputPath,
        "-vn",
        "-map",
        "0:a:0",
        "-af",
        `pan=mono|c0=${options.channel}`,
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-y",
        options.outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      ffmpeg.kill("SIGKILL");
      reject(new Error(`ffmpeg mix resplit timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    ffmpeg.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    ffmpeg.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    ffmpeg.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }

      resolve();
    });
  });
}

async function transcribeMono(openai: OpenAI, path: string) {
  const response = await openai.audio.transcriptions.create({
    file: createReadStream(path),
    model: MIX_RESPLIT_MODEL,
    language: TRANSCRIPTION_LANGUAGE,
    response_format: "json",
    temperature: TRANSCRIPTION_TEMPERATURE,
  });
  const text = "text" in response ? String(response.text || "").trim() : "";

  return text;
}

function findClusterForLabel(labelsByCluster: Map<number, string>, label: string) {
  for (const [clusterIndex, clusterLabel] of labelsByCluster) {
    if (clusterLabel === label) {
      return clusterIndex;
    }
  }

  return null;
}
