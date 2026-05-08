import { createReadStream } from "node:fs";
import OpenAI from "openai";
import type { AudioChunk } from "./ffmpeg.js";

export type NormalizedSegment = {
  speakerLabel: string;
  startSec: number;
  endSec: number;
  text: string;
  chunkIndex: number;
  segmentIndex: number;
};

export type TranscribedChunk = {
  segments: NormalizedSegment[];
  skippedSegmentsCount: number;
  sourceSegmentsCount: number;
};

type DiarizedTranscriptionResponse = {
  segments?: Array<{
    speaker?: string;
    start?: number;
    end?: number;
    text?: string;
  }>;
};

export function createOpenAIClient(apiKey: string) {
  return new OpenAI({ apiKey });
}

export async function transcribeChunk(options: {
  openai: OpenAI;
  model: string;
  chunk: AudioChunk;
  chunkStartSec: number;
}): Promise<TranscribedChunk> {
  const transcription = (await options.openai.audio.transcriptions.create({
    file: createReadStream(options.chunk.path),
    model: options.model,
    response_format: "diarized_json",
    chunking_strategy: "auto",
  })) as DiarizedTranscriptionResponse;

  if (!Array.isArray(transcription.segments)) {
    throw new Error("OpenAI transcription response did not include segments.");
  }

  const segments: NormalizedSegment[] = [];
  let skippedSegmentsCount = 0;
  let segmentIndex = 0;

  for (const segment of transcription.segments) {
    const normalized = normalizeSegment(
      segment,
      options.chunk.chunkIndex,
      options.chunkStartSec,
    );

    if (!normalized) {
      skippedSegmentsCount += 1;
      continue;
    }

    segments.push({
      ...normalized,
      segmentIndex,
    });
    segmentIndex += 1;
  }

  return {
    segments,
    skippedSegmentsCount,
    sourceSegmentsCount: transcription.segments.length,
  };
}

function normalizeSegment(
  segment: NonNullable<DiarizedTranscriptionResponse["segments"]>[number],
  chunkIndex: number,
  chunkStartSec: number,
): Omit<NormalizedSegment, "segmentIndex"> | null {
  if (typeof segment.start !== "number" || typeof segment.end !== "number") {
    throw new Error(`OpenAI segment is missing timestamps for chunk ${chunkIndex}.`);
  }

  const text = segment.text?.trim();

  if (!text) {
    return null;
  }

  return {
    speakerLabel: segment.speaker || "unknown",
    startSec: roundSeconds(chunkStartSec + segment.start),
    endSec: roundSeconds(chunkStartSec + segment.end),
    text,
    chunkIndex,
  };
}

function roundSeconds(value: number) {
  return Math.round(value * 1000) / 1000;
}
