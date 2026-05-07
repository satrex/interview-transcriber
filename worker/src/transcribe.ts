import { createReadStream } from "node:fs";
import OpenAI from "openai";
import type { AudioChunk } from "./ffmpeg.js";

export type NormalizedSegment = {
  speakerLabel: string;
  startSec: number;
  endSec: number;
  text: string;
  chunkIndex: number;
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
}) {
  const transcription = (await options.openai.audio.transcriptions.create({
    file: createReadStream(options.chunk.path),
    model: options.model,
    response_format: "diarized_json",
    chunking_strategy: "auto",
  })) as DiarizedTranscriptionResponse;

  if (!Array.isArray(transcription.segments)) {
    throw new Error("OpenAI transcription response did not include segments.");
  }

  return transcription.segments.map((segment) =>
    normalizeSegment(segment, options.chunk.chunkIndex, options.chunkStartSec),
  );
}

function normalizeSegment(
  segment: NonNullable<DiarizedTranscriptionResponse["segments"]>[number],
  chunkIndex: number,
  chunkStartSec: number,
): NormalizedSegment {
  if (typeof segment.start !== "number" || typeof segment.end !== "number") {
    throw new Error(`OpenAI segment is missing timestamps for chunk ${chunkIndex}.`);
  }

  const text = segment.text?.trim();

  if (!text) {
    throw new Error(`OpenAI segment is missing text for chunk ${chunkIndex}.`);
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
