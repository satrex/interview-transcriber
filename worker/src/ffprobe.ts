import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AudioInfo = {
  durationSec: number | null;
  formatName: string | null;
  bitRate: number | null;
  streams: Array<{
    codecType: string | null;
    codecName: string | null;
    sampleRate: number | null;
    channels: number | null;
  }>;
};

type FfprobeOutput = {
  format?: {
    duration?: string;
    format_name?: string;
    bit_rate?: string;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    sample_rate?: string;
    channels?: number;
  }>;
};

export async function probeAudio(ffprobePath: string, localPath: string) {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    localPath,
  ]);

  const parsed = JSON.parse(stdout) as FfprobeOutput;

  return {
    durationSec: parseNumber(parsed.format?.duration),
    formatName: parsed.format?.format_name || null,
    bitRate: parseInteger(parsed.format?.bit_rate),
    streams:
      parsed.streams?.map((stream) => ({
        codecType: stream.codec_type || null,
        codecName: stream.codec_name || null,
        sampleRate: parseInteger(stream.sample_rate),
        channels: stream.channels ?? null,
      })) || [],
  } satisfies AudioInfo;
}

function parseNumber(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
