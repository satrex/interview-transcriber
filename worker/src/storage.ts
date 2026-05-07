import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptionJob } from "./supabase.js";

export async function downloadJobAudio(
  supabase: SupabaseClient,
  job: TranscriptionJob,
  tmpDir: string,
) {
  const jobTmpDir = join(tmpDir, job.id);
  await mkdir(jobTmpDir, { recursive: true });

  const filename = basename(job.storage_path) || "source-audio";
  const localPath = join(jobTmpDir, filename);

  const { data, error } = await supabase.storage
    .from(job.storage_bucket)
    .download(job.storage_path);

  if (error || !data) {
    throw new Error(
      `Failed to download ${job.storage_path}: ${error?.message || "empty response"}`,
    );
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  await writeFile(localPath, buffer);

  return {
    jobTmpDir,
    localPath,
    bytes: buffer.byteLength,
  };
}
