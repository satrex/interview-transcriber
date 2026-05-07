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

  const { error } = await supabase
    .from("transcription_jobs")
    .update({
      status: attemptsExhausted ? "failed" : "queued",
      progress: attemptsExhausted ? job.progress : 0,
      worker_id: attemptsExhausted ? job.worker_id : null,
      locked_at: attemptsExhausted ? job.locked_at : null,
      error_message: message,
      failed_at: attemptsExhausted ? new Date().toISOString() : null,
    })
    .eq("id", job.id);

  if (error) {
    console.error(`Failed to update failed attempt for job ${job.id}:`, error.message);
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
  jobId: string,
  progress: number,
) {
  const { error } = await supabase
    .from("transcription_jobs")
    .update({
      progress,
      locked_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to update job progress: ${error.message}`);
  }
}

export async function touchJobLock(supabase: SupabaseClient, jobId: string) {
  const { error } = await supabase
    .from("transcription_jobs")
    .update({
      locked_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "processing");

  if (error) {
    throw new Error(`Failed to refresh job lock: ${error.message}`);
  }
}

export async function markJobCompleted(
  supabase: SupabaseClient,
  jobId: string,
) {
  const { error } = await supabase
    .from("transcription_jobs")
    .update({
      status: "completed",
      progress: 100,
      completed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to mark job ${jobId} as completed: ${error.message}`);
  }
}
