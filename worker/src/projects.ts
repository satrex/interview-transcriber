import { mkdir, rm, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";
import { probeAudio } from "./ffprobe.js";
import { downloadJobAudio } from "./storage.js";
import type { TranscriptionProject } from "./supabase.js";

export class ProjectFailure extends Error {
  readonly errorCode: "project_split_failed" | "project_split_invalid_part_file";

  constructor(message: string, errorCode: "project_split_failed" | "project_split_invalid_part_file") {
    super(message);
    this.name = "ProjectFailure";
    this.errorCode = errorCode;
  }
}

export async function claimQueuedProject(
  supabase: SupabaseClient,
  workerId: string,
  options: {
    lockTimeoutMinutes: number;
  },
): Promise<TranscriptionProject | null> {
  const lockTimeoutAt = new Date(Date.now() + options.lockTimeoutMinutes * 60 * 1000);

  const { data, error } = await supabase.rpc("claim_queued_project", {
    p_worker_id: workerId,
    p_lock_timeout_at: lockTimeoutAt.toISOString(),
  });

  if (error) {
    throw new Error(`Failed to claim queued project: ${error.message}`);
  }

  return data?.[0] || null;
}

export async function markProjectSplitting(
  supabase: SupabaseClient,
  project: TranscriptionProject,
): Promise<void> {
  const { error } = await supabase
    .from("transcription_projects")
    .update({
      status: "splitting",
      updated_at: new Date().toISOString(),
    })
    .eq("id", project.id);

  if (error) {
    throw new Error(`Failed to mark project splitting: ${error.message}`);
  }
}

export async function updateProjectWithParts(
  supabase: SupabaseClient,
  project: TranscriptionProject,
  totalDurationSec: number,
  totalParts: number,
): Promise<void> {
  const { error } = await supabase
    .from("transcription_projects")
    .update({
      status: "processing_parts",
      total_duration_sec: totalDurationSec,
      total_parts: totalParts,
      updated_at: new Date().toISOString(),
    })
    .eq("id", project.id);

  if (error) {
    throw new Error(`Failed to update project with parts: ${error.message}`);
  }
}

export async function markProjectCompleted(
  supabase: SupabaseClient,
  project: TranscriptionProject,
): Promise<void> {
  const { error } = await supabase
    .from("transcription_projects")
    .update({
      status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", project.id);

  if (error) {
    throw new Error(`Failed to mark project completed: ${error.message}`);
  }
}

export async function markProjectFailed(
  supabase: SupabaseClient,
  project: TranscriptionProject,
  errorMessage: string,
  errorCode?: string,
): Promise<void> {
  const { error } = await supabase
    .from("transcription_projects")
    .update({
      status: "failed",
      error_message: errorMessage,
      error_code: errorCode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", project.id);

  if (error) {
    throw new Error(`Failed to mark project failed: ${error.message}`);
  }
}

export async function updateProjectProgress(
  supabase: SupabaseClient,
  projectId: string,
): Promise<void> {
  // Count completed and failed parts
  const { data: counts, error } = await supabase
    .from("transcription_jobs")
    .select("status")
    .eq("project_id", projectId)
    .eq("is_project_part", true);

  if (error) {
    throw new Error(`Failed to count project parts: ${error.message}`);
  }

  const completedParts = counts.filter(job => job.status === "completed").length;
  const failedParts = counts.filter(job => job.status === "failed").length;
  const totalParts = counts.length;

  let newStatus: string;
  if (completedParts === totalParts && totalParts > 0) {
    newStatus = "completed";
  } else if (failedParts > 0) {
    newStatus = "failed";
  } else if (completedParts > 0 || counts.some(job => job.status === "processing")) {
    newStatus = "processing_parts";
  } else {
    newStatus = "processing_parts"; // Still processing
  }

  const { error: updateError } = await supabase
    .from("transcription_projects")
    .update({
      completed_parts: completedParts,
      failed_parts: failedParts,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);

  if (updateError) {
    throw new Error(`Failed to update project progress: ${updateError.message}`);
  }
}

export async function createPartJobs(
  supabase: SupabaseClient,
  project: TranscriptionProject,
  uploadedParts: Array<{
    index: number;
    startSec: number;
    endSec: number;
    storagePath: string;
    audioDurationSec: number;
    audioFileSizeBytes: number;
    audioContentType: string;
  }>,
): Promise<void> {
  const partJobs = uploadedParts.map((part) => ({
    id: randomUUID(),
    user_id: project.user_id,
    original_filename: project.original_filename,
    storage_bucket: project.storage_bucket,
    storage_path: part.storagePath,
    audio_duration_sec: part.audioDurationSec,
    audio_file_size_bytes: part.audioFileSizeBytes,
    audio_content_type: part.audioContentType,
    status: "queued",
    progress: 0,
    term_dictionary_id: null,
    skipped_segments_count: 0,
    attempt_count: 0,
    worker_id: null,
    locked_at: null,
    project_id: project.id,
    part_index: part.index,
    part_start_sec: part.startSec,
    part_end_sec: part.endSec,
    is_project_part: true,
  }));

  const { error } = await supabase.from("transcription_jobs").insert(partJobs);

  if (error) {
    throw new Error(`Failed to create project part jobs: ${error.message}`);
  }
}

export async function processProject(
  supabase: SupabaseClient,
  config: WorkerConfig,
  project: TranscriptionProject,
) {
  let projectTmpDir: string | null = null;
  const MIN_VALID_AUDIO_BYTES = 100 * 1024; // 100KB

  try {
    console.log(`[worker] processing project ${project.id}: ${project.title}`);

    await markProjectSplitting(supabase, project);

    console.log(`[worker] downloading project source ${project.id}: ${project.storage_path}`);
    const downloaded = await downloadJobAudio(supabase, project, config.tmpDir);
    projectTmpDir = downloaded.jobTmpDir;
    const partsDir = path.join(projectTmpDir, "parts");

    await mkdir(partsDir, { recursive: true });

    console.log(
      `[worker] downloaded ${downloaded.bytes} bytes to ${downloaded.localPath}`,
    );

    const audioInfo = await probeAudio(config.ffprobePath, downloaded.localPath);
    const totalDurationSec = audioInfo.durationSec;

    if (totalDurationSec === null) {
      throw new Error(`Could not determine duration for project ${project.id}`);
    }

    console.log("[worker] ffprobe audio info:");
    console.log(JSON.stringify(audioInfo, null, 2));

    const partDurationSec = project.part_duration_sec;
    const totalParts = Math.ceil(totalDurationSec / partDurationSec);

    console.log(`[worker] splitting into ${totalParts} parts of ${partDurationSec}s each`);

    const parts: Array<{
      index: number;
      startSec: number;
      endSec: number;
      localPath: string;
    }> = [];

    for (let i = 0; i < totalParts; i++) {
      const startSec = i * partDurationSec;
      const endSec = Math.min((i + 1) * partDurationSec, totalDurationSec);
      const duration = endSec - startSec;

      const partFilename = `part_${i.toString().padStart(3, "0")}.m4a`;
      const partLocalPath = path.join(partsDir, partFilename);

      await mkdir(partsDir, { recursive: true });

      console.log(`[worker] creating part ${i}: ${startSec}s - ${endSec}s (${duration}s)`);

      // Use ffmpeg to extract part (re-encode to avoid corrupted m4a)
      const { spawn } = await import("node:child_process");
      const ffmpegArgs = [
        "-y",
        "-ss",
        startSec.toString(),
        "-i",
        downloaded.localPath,
        "-t",
        duration.toString(),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        partLocalPath,
      ];

      const ffmpeg = spawn(config.ffmpegPath, ffmpegArgs, { stdio: ["ignore", "ignore", "pipe"] });

      let ffmpegStderr = "";
      ffmpeg.stderr?.on("data", (chunk) => {
        ffmpegStderr += String(chunk);
      });

      await new Promise<void>((resolve, reject) => {
        ffmpeg.on("close", (code, signal) => {
          if (code === 0) {
            resolve();
            return;
          }

          const errorMessage = `ffmpeg exited with code ${code}${signal ? ` signal ${signal}` : ""}`;
          console.error(
            `[worker] ffmpeg failed for project ${project.id}: partIndex=${i}, partStartSec=${startSec}, partDurationSec=${duration}, inputPath=${downloaded.localPath}, outputPath=${partLocalPath}, outputDir=${partsDir}, code=${code}, signal=${signal}`,
          );
          if (ffmpegStderr) {
            console.error(`[worker] ffmpeg stderr:\n${ffmpegStderr}`);
          }
          reject(new ProjectFailure(`${errorMessage}${ffmpegStderr ? `\nstderr:\n${ffmpegStderr}` : ""}`, "project_split_failed"));
        });

        ffmpeg.on("error", (spawnError) => {
          const errorMessage = `ffmpeg spawn error for project ${project.id}: partIndex=${i}, partStartSec=${startSec}, partDurationSec=${duration}, inputPath=${downloaded.localPath}, outputPath=${partLocalPath}, outputDir=${partsDir}`;
          console.error(errorMessage, spawnError);
          if (ffmpegStderr) {
            console.error(`[worker] ffmpeg stderr:\n${ffmpegStderr}`);
          }
          reject(new ProjectFailure(`${errorMessage}: ${spawnError instanceof Error ? spawnError.message : String(spawnError)}${ffmpegStderr ? `\nstderr:\n${ffmpegStderr}` : ""}`, "project_split_failed"));
        });
      });

      parts.push({
        index: i,
        startSec,
        endSec,
        localPath: partLocalPath,
      });
    }

    // Validate generated parts before uploading
    console.log(`[worker] validating ${parts.length} generated parts for project ${project.id}`);
    for (const part of parts) {
      try {
        const fileStats = await stat(part.localPath);
        if (!fileStats.isFile() || fileStats.size < MIN_VALID_AUDIO_BYTES) {
          throw new Error(`Generated part file is too small: ${part.localPath} (${fileStats.size} bytes)`);
        }

        const partInfo = await probeAudio(config.ffprobePath, part.localPath);
        if (partInfo.durationSec === null || partInfo.durationSec <= 0) {
          throw new Error(`ffprobe could not determine duration for part ${part.index}: ${part.localPath}`);
        }
        if (!partInfo.streams.some((s) => s.codecType === "audio")) {
          throw new Error(`No audio stream found for part ${part.index}: ${part.localPath}`);
        }

        console.log(
          `[worker] validated part ${part.index}: path=${part.localPath}, size=${fileStats.size} bytes, duration=${partInfo.durationSec}s`,
        );
      } catch (validationError) {
        const msg = validationError instanceof Error ? validationError.message : String(validationError);
        console.error(`[worker] project ${project.id} split validation failed: ${msg}`);
        throw new ProjectFailure(msg, "project_split_invalid_part_file");
      }
    }

    // Upload parts to storage
    const uploadedParts: Array<{
      index: number;
      startSec: number;
      endSec: number;
      storagePath: string;
      audioDurationSec: number;
      audioFileSizeBytes: number;
      audioContentType: string;
    }> = [];
    for (const part of parts) {
      const partInfo = await probeAudio(config.ffprobePath, part.localPath);
      const storagePath = `${project.user_id}/projects/${project.id}/parts/part_${part.index.toString().padStart(3, "0")}.m4a`;

      const fileStats = await stat(part.localPath);

      console.log(`[worker] uploading part ${part.index}: localPath=${part.localPath}, size=${fileStats.size} bytes -> storagePath=${storagePath}`);

      const fileBuffer = await readFile(part.localPath);
      const { data, error } = await supabase.storage
        .from(project.storage_bucket)
        .upload(storagePath, fileBuffer, {
          contentType: "audio/mp4",
          upsert: true,
        });

      if (error) {
        const msg = `Failed to upload part ${part.index}: ${error.message}`;
        console.error(`[worker] ${msg}`);
        throw new ProjectFailure(msg, "project_split_failed");
      }

      console.log(`[worker] uploaded part ${part.index}: storagePath=${storagePath}, uploadResponse=${JSON.stringify(data)}`);

      uploadedParts.push({
        index: part.index,
        startSec: part.startSec,
        endSec: part.endSec,
        storagePath,
        audioDurationSec: partInfo.durationSec!,
        audioFileSizeBytes: fileStats.size,
        audioContentType: "audio/mp4",
      });
    }

    await updateProjectWithParts(supabase, project, totalDurationSec, totalParts);
    await createPartJobs(supabase, project, uploadedParts);

    console.log(`[worker] project ${project.id} split into ${totalParts} parts`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const errorCode = error instanceof ProjectFailure ? error.errorCode : "project_split_failed";
    console.error(`[worker] project ${project.id} failed:`, message);
    await markProjectFailed(supabase, project, message, errorCode);
    throw error;
  } finally {
    if (projectTmpDir) {
      try {
        await rm(projectTmpDir, { recursive: true, force: true });
        console.log(`[worker] cleaned up project tmp dir: ${projectTmpDir}`);
      } catch (cleanupError) {
        console.warn(`[worker] failed to cleanup project tmp dir: ${projectTmpDir}`, cleanupError);
      }
    }
  }
}