import { createReadStream } from "node:fs";
import OpenAI from "openai";
import type { TranscriptionCreateParamsNonStreaming } from "openai/resources/audio/transcriptions";
import type { AudioChunk } from "./ffmpeg.js";
import { formatErrorMessage } from "./retry.js";

export const TRANSCRIPTION_LANGUAGE = "ja";
export const TRANSCRIPTION_PROMPT = [
  "これは日本語のインタビュー音声です。",
  "翻訳せず、日本語のまま文字起こししてください。",
  "口語、相槌、固有名詞、音楽用語を含みます。",
].join("\n");
export const TRANSCRIPTION_TEMPERATURE = 0;

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

export type OpenAITranscriptionErrorCode =
  | "quota_exceeded"
  | "rate_limited"
  | "unsupported_prompt_for_diarization"
  | "openai_error";

export class OpenAITranscriptionError extends Error {
  readonly errorCode: OpenAITranscriptionErrorCode;

  constructor(
    message: string,
    options: {
      cause: unknown;
      errorCode: OpenAITranscriptionErrorCode;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "OpenAITranscriptionError";
    this.errorCode = options.errorCode;
  }
}

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
  promptSuffix?: string | null;
}): Promise<TranscribedChunk> {
  const transcription = await createTranscriptionWithRetry(options);

  if (!Array.isArray(transcription.segments)) {
    const error = new Error("OpenAI transcription response did not include segments.");
    throw new OpenAITranscriptionError(error.message, {
      cause: error,
      errorCode: "openai_error",
    });
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

async function createTranscriptionWithRetry(options: {
  openai: OpenAI;
  model: string;
  chunk: AudioChunk;
  promptSuffix?: string | null;
}) {
  let attempt = 1;
  const useDiarization = true;

  while (true) {
    try {
      const request: TranscriptionCreateParamsNonStreaming = {
        file: createReadStream(options.chunk.path),
        model: options.model,
        language: TRANSCRIPTION_LANGUAGE,
        response_format: useDiarization ? "diarized_json" : "verbose_json",
        temperature: TRANSCRIPTION_TEMPERATURE,
        chunking_strategy: "auto",
      };
      const promptText = buildTranscriptionPrompt(options.promptSuffix);

      if (!useDiarization && promptText) {
        request.prompt = promptText;
      }

      return (await options.openai.audio.transcriptions.create(
        request,
      )) as DiarizedTranscriptionResponse;
    } catch (error) {
      const classification = classifyOpenAITranscriptionError(error);

      if (!classification.retryable || attempt >= classification.maxAttempts) {
        throw new OpenAITranscriptionError(formatErrorMessage(error), {
          cause: error,
          errorCode: classification.errorCode,
        });
      }

      const delayMs = classification.delayMs(attempt);
      console.warn(
        `[worker] OpenAI transcription ${classification.errorCode} for chunk ${options.chunk.chunkIndex}; retrying attempt ${attempt + 1}/${classification.maxAttempts} in ${delayMs}ms: ${formatErrorMessage(error)}`,
      );
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

function buildTranscriptionPrompt(promptSuffix?: string | null) {
  return [TRANSCRIPTION_PROMPT, promptSuffix?.trim()].filter(Boolean).join("\n\n");
}

function classifyOpenAITranscriptionError(error: unknown): {
  delayMs: (attempt: number) => number;
  errorCode: OpenAITranscriptionErrorCode;
  maxAttempts: number;
  retryable: boolean;
} {
  const message = formatErrorMessage(error).toLowerCase();
  const apiCode = extractOpenAIErrorCode(error).toLowerCase();
  const status = extractOpenAIStatus(error);
  const isQuotaFailure =
    apiCode === "insufficient_quota" ||
    message.includes("exceeded your current quota") ||
    message.includes("check your plan and billing");
  const isUnsupportedPromptForDiarization =
    status === 400 &&
    message.includes("prompt is not supported") &&
    message.includes("diarization");

  if (isQuotaFailure) {
    return {
      delayMs: () => 0,
      errorCode: "quota_exceeded",
      maxAttempts: 1,
      retryable: false,
    };
  }

  if (isUnsupportedPromptForDiarization) {
    return {
      delayMs: () => 0,
      errorCode: "unsupported_prompt_for_diarization",
      maxAttempts: 1,
      retryable: false,
    };
  }

  if (
    status === 429 ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  ) {
    return {
      delayMs: (attempt) => attempt * 30_000,
      errorCode: "rate_limited",
      maxAttempts: 3,
      retryable: true,
    };
  }

  return {
    delayMs: (attempt) => {
      const baseDelayMs = 2_000 * 2 ** (attempt - 1);
      const jitterMs = Math.floor(Math.random() * 1_000);
      return Math.min(10_000, baseDelayMs) + jitterMs;
    },
    errorCode: "openai_error",
    maxAttempts: 4,
    retryable: true,
  };
}

function extractOpenAIErrorCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return "";
  }

  const directCode = "code" in error ? error.code : null;

  if (typeof directCode === "string") {
    return directCode;
  }

  const nestedError = "error" in error ? error.error : null;

  if (nestedError && typeof nestedError === "object" && "code" in nestedError) {
    const nestedCode = nestedError.code;
    return typeof nestedCode === "string" ? nestedCode : "";
  }

  return "";
}

function extractOpenAIStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return null;
  }

  return typeof error.status === "number" ? error.status : null;
}

function sleep(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
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
