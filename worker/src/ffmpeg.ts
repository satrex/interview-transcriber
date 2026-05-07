import { execFile } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AudioChunk = {
  chunkIndex: number;
  path: string;
  bytes: number;
};

export async function splitAudioIntoChunks(options: {
  ffmpegPath: string;
  inputPath: string;
  outputDir: string;
  jobId: string;
  chunkSeconds: number;
}) {
  await mkdir(options.outputDir, { recursive: true });

  const outputPattern = join(
    options.outputDir,
    `${options.jobId}_chunk_%03d.wav`,
  );

  await execFileAsync(options.ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    options.inputPath,
    "-vn",
    "-map",
    "0:a:0",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    "-f",
    "segment",
    "-segment_time",
    String(options.chunkSeconds),
    "-segment_start_number",
    "0",
    "-reset_timestamps",
    "1",
    outputPattern,
  ]);

  const files = await readdir(options.outputDir);
  const chunks = await Promise.all(
    files
      .map((filename) => parseChunkFilename(options.jobId, filename))
      .filter((chunk): chunk is { filename: string; chunkIndex: number } =>
        Boolean(chunk),
      )
      .map(async ({ filename, chunkIndex }) => {
        const path = join(options.outputDir, filename);
        const fileStat = await stat(path);

        return {
          chunkIndex,
          path,
          bytes: fileStat.size,
        } satisfies AudioChunk;
      }),
  );

  return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
}

function parseChunkFilename(jobId: string, filename: string) {
  const match = filename.match(
    new RegExp(`^${escapeRegExp(jobId)}_chunk_(\\d{3})\\.wav$`),
  );

  if (!match) {
    return null;
  }

  return {
    filename,
    chunkIndex: Number.parseInt(match[1], 10),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
