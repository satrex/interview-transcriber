import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptionJob } from "./supabase.js";

export async function claimQueuedJob(
  supabase: SupabaseClient,
  workerId: string,
  options: {
    lockTimeoutMinutes: number;
    maxAttempts: number;
  },
) {
  const { data, error } = await supabase.rpc("claim_next_transcription_job", {
    p_worker_id: workerId,
    p_lock_timeout_minutes: options.lockTimeoutMinutes,
    p_max_attempts: options.maxAttempts,
  });

  if (error) {
    throw new Error(`Failed to claim transcription job: ${error.message}`);
  }

  const claimedJobs = data as TranscriptionJob[] | null;
  return claimedJobs?.[0] || null;
}

export async function markJobAttemptFailed(
  supabase: SupabaseClient,
  job: TranscriptionJob,
  message: string,
  maxAttempts: number,
) {
  const attemptsExhausted = job.attempt_count >= maxAttempts;

  const { data, error } = await supabase
    .from("transcription_jobs")
    .update({
      status: attemptsExhausted ? "failed" : "queued",
      progress: attemptsExhausted ? job.progress : 0,
      worker_id: attemptsExhausted ? job.worker_id : null,
      locked_at: attemptsExhausted ? job.locked_at : null,
      error_message: message,
      failed_at: attemptsExhausted ? new Date().toISOString() : null,
    })
    .eq("id", job.id)
    .eq("status", "processing")
    .eq("worker_id", job.worker_id)
    .eq("attempt_count", job.attempt_count)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`Failed to update failed attempt for job ${job.id}:`, error.message);
    return;
  }

  if (!data) {
    console.error(
      `Job ${job.id} failure update skipped because this worker no longer owns attempt ${job.attempt_count}.`,
    );
    return;
  }

  if (attemptsExhausted) {
    console.error(
      `Job ${job.id} failed after ${job.attempt_count}/${maxAttempts} attempts.`,
    );
  } else {
    console.error(
      `Job ${job.id} attempt ${job.attempt_count}/${maxAttempts} failed; requeued.`,
    );
  }
}

export async function updateJobProgress(
  supabase: SupabaseClient,
  job: TranscriptionJob,
  progress: number,
  skippedSegmentsCount?: number,
) {
  const updateValues: {
    locked_at: string;
    progress: number;
    skipped_segments_count?: number;
  } = {
    progress,
    locked_at: new Date().toISOString(),
  };

  if (typeof skippedSegmentsCount === "number") {
    updateValues.skipped_segments_count = skippedSegmentsCount;
  }

  const { data, error } = await supabase
    .from("transcription_jobs")
    .update(updateValues)
    .eq("id", job.id)
    .eq("status", "processing")
    .eq("worker_id", job.worker_id)
    .eq("attempt_count", job.attempt_count)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update job progress: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      `Lost ownership of job ${job.id} attempt ${job.attempt_count} while updating progress.`,
    );
  }
}

export async function touchJobLock(supabase: SupabaseClient, job: TranscriptionJob) {
  const { data, error } = await supabase
    .from("transcription_jobs")
    .update({
      locked_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "processing")
    .eq("worker_id", job.worker_id)
    .eq("attempt_count", job.attempt_count)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to refresh job lock: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      `Lost ownership of job ${job.id} attempt ${job.attempt_count} while refreshing lock.`,
    );
  }
}

export async function markJobCompleted(
  supabase: SupabaseClient,
  job: TranscriptionJob,
) {
  const { data, error } = await supabase
    .from("transcription_jobs")
    .update({
      status: "completed",
      progress: 100,
      completed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", job.id)
    .eq("status", "processing")
    .eq("worker_id", job.worker_id)
    .eq("attempt_count", job.attempt_count)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to mark job ${job.id} as completed: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      `Lost ownership of job ${job.id} attempt ${job.attempt_count} while marking completed.`,
    );
  }
}

export async function assertJobClaimActive(
  supabase: SupabaseClient,
  job: TranscriptionJob,
) {
  const { data, error } = await supabase
    .from("transcription_jobs")
    .select("id")
    .eq("id", job.id)
    .eq("status", "processing")
    .eq("worker_id", job.worker_id)
    .eq("attempt_count", job.attempt_count)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to verify job ownership: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      `Lost ownership of job ${job.id} attempt ${job.attempt_count}.`,
    );
  }
}
