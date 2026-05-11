import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { retryTransientOperation } from "./retry.js";
import type { TranscriptionJob } from "./supabase.js";
import type { AudioChunk } from "./ffmpeg.js";

const SOURCE_AUDIO_SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60;
const AUDIO_BUCKET = "audio";

export async function downloadJobAudio(
  supabase: SupabaseClient,
  job: TranscriptionJob,
  tmpDir: string,
) {
  const jobTmpDir = join(tmpDir, job.id);
  await mkdir(jobTmpDir, { recursive: true });

  const filename = basename(job.storage_path) || "source-audio";
  const localPath = join(jobTmpDir, filename);

  const signedUrl = await createSourceAudioSignedUrl(supabase, job);
  const response = await retryTransientOperation(
    { operation: `fetch source audio for job ${job.id}` },
    () => fetch(signedUrl),
  );

  if (!response.ok) {
    throw new Error(
      `Failed to download ${job.storage_path}: ${response.status} ${response.statusText}`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(localPath, buffer);

  return {
    jobTmpDir,
    localPath,
    bytes: buffer.byteLength,
  };
}

async function createSourceAudioSignedUrl(
  supabase: SupabaseClient,
  job: TranscriptionJob,
) {
  const { data, error } = await retryTransientOperation(
    { operation: `create signed source audio URL for job ${job.id}` },
    () =>
      supabase.storage
        .from(AUDIO_BUCKET)
        .createSignedUrl(
          job.storage_path,
          SOURCE_AUDIO_SIGNED_URL_EXPIRES_IN_SECONDS,
        ),
  );

  if (error || !data?.signedUrl) {
    throw new Error(
      `Failed to create signed URL for ${job.storage_path}: ${error?.message || "empty response"}`,
    );
  }

  return data.signedUrl;
}

export async function uploadJobAudioChunks(
  supabase: SupabaseClient,
  job: TranscriptionJob,
  chunks: AudioChunk[],
) {
  const uploadedChunks: Array<{ chunkIndex: number; path: string }> = [];

  for (const chunk of chunks) {
    const storagePath = buildJobAudioChunkStoragePath(job.id, chunk.chunkIndex);
    const file = await readFile(chunk.path);
    const { error } = await retryTransientOperation(
      { operation: `upload browser audio chunk ${chunk.chunkIndex} for job ${job.id}` },
      () =>
        supabase.storage.from(AUDIO_BUCKET).upload(storagePath, file, {
          contentType: "audio/wav",
          upsert: true,
        }),
    );

    if (error) {
      throw new Error(
        `Failed to upload chunk ${chunk.chunkIndex} to ${storagePath}: ${error.message}`,
      );
    }

    uploadedChunks.push({ chunkIndex: chunk.chunkIndex, path: storagePath });
  }

  return uploadedChunks;
}

export function buildJobAudioChunkStoragePath(
  jobId: string,
  chunkIndex: number,
) {
  return `jobs/${jobId}/chunks/chunk_${chunkIndex
    .toString()
    .padStart(3, "0")}.wav`;
}
