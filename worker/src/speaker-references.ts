import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SegmentPan } from "./pan.js";
import type { NormalizedSegment } from "./transcribe.js";

const MIN_REFERENCE_SEC = 3;
// API accepts 1.2–10.0s; clamp below 10.0 because ffmpeg -t can overshoot the
// requested length slightly at frame boundaries and get the reference rejected.
const MAX_REFERENCE_SEC = 9.5;
const MAX_KNOWN_SPEAKERS = 4;

export type KnownSpeaker = {
  name: string;
  displayLabel: string;
  dataUrl: string;
};

export function selectReferenceCandidates(
  chunkSegments: NormalizedSegment[],
  knownDisplayLabels: Set<string>,
  segmentPans?: Map<number, SegmentPan>,
  chunkStartSec = inferChunkStartSec(chunkSegments),
): Array<{ apiLabel: string; startInChunkSec: number; endInChunkSec: number }> {
  const knownApiLabels = new Set<string>();
  const candidatesByLabel = new Map<
    string,
    Array<{
      segment: NormalizedSegment;
      startInChunkSec: number;
      endInChunkSec: number;
      scorePan: number;
      durationSec: number;
    }>
  >();

  for (const segment of chunkSegments) {
    if (knownDisplayLabels.has(segment.speakerLabel)) {
      knownApiLabels.add(segment.speakerLabel);
      continue;
    }

    if (knownApiLabels.size >= MAX_KNOWN_SPEAKERS) {
      break;
    }

    const durationSec = segment.endSec - segment.startSec;
    if (durationSec < MIN_REFERENCE_SEC) {
      continue;
    }

    if (overlapsOtherSpeaker(segment, chunkSegments)) {
      continue;
    }

    const startInChunkSec = Math.max(0, segment.startSec - chunkStartSec);
    const endInChunkSec = startInChunkSec + Math.min(durationSec, MAX_REFERENCE_SEC);
    const pan = segmentPans?.get(segment.segmentIndex);
    const bucket = candidatesByLabel.get(segment.speakerLabel) ?? [];
    bucket.push({
      segment,
      startInChunkSec,
      endInChunkSec,
      scorePan: pan ? Math.abs(pan.pan) : 0,
      durationSec: Math.min(durationSec, MAX_REFERENCE_SEC),
    });
    candidatesByLabel.set(segment.speakerLabel, bucket);
  }

  return [...candidatesByLabel.entries()]
    .map(([apiLabel, candidates]) => {
      const best = candidates.sort(
        (a, b) => b.scorePan - a.scorePan || b.durationSec - a.durationSec,
      )[0];

      return {
        apiLabel,
        startInChunkSec: roundSeconds(best.startInChunkSec),
        endInChunkSec: roundSeconds(best.endInChunkSec),
      };
    })
    .sort((a, b) => a.startInChunkSec - b.startInChunkSec);
}

export async function buildSpeakerReferenceDataUrl(options: {
  ffmpegPath: string;
  chunkPath: string;
  startSec: number;
  durationSec: number;
  timeoutMs: number;
  outDir: string;
}): Promise<string> {
  await mkdir(options.outDir, { recursive: true });

  const outputPath = join(
    options.outDir,
    `speaker_ref_${Date.now()}_${Math.random().toString(16).slice(2)}.wav`,
  );

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(
      options.ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(options.startSec),
        "-t",
        String(options.durationSec),
        "-i",
        options.chunkPath,
        "-c:a",
        "pcm_s16le",
        outputPath,
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
      reject(new Error(`ffmpeg speaker reference extraction timed out after ${options.timeoutMs}ms`));
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

    ffmpeg.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `ffmpeg exited with code ${code}${signal ? ` signal ${signal}` : ""}${
            stderr ? `\nstderr:\n${stderr}` : ""
          }`,
        ),
      );
    });
  });

  const buffer = await readFile(outputPath);
  return `data:audio/wav;base64,${buffer.toString("base64")}`;
}

function overlapsOtherSpeaker(
  segment: NormalizedSegment,
  segments: NormalizedSegment[],
) {
  return segments.some(
    (other) =>
      other.segmentIndex !== segment.segmentIndex &&
      other.speakerLabel !== segment.speakerLabel &&
      other.startSec < segment.endSec &&
      segment.startSec < other.endSec,
  );
}

function inferChunkStartSec(segments: NormalizedSegment[]) {
  return segments.reduce(
    (min, segment) => Math.min(min, segment.startSec),
    Number.POSITIVE_INFINITY,
  );
}

function roundSeconds(value: number) {
  return Math.round(value * 1000) / 1000;
}
