import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export async function resetFailedJob(
  adminSupabase: SupabaseClient,
  options: { jobId: string; userId: string },
) {
  // Keep existing segments so the worker can resume successful chunks.
  return adminSupabase
    .from("transcription_jobs")
    .update({
      status: "queued",
      progress: 0,
      error_code: null,
      error_message: null,
      failed_at: null,
      started_at: null,
      completed_at: null,
      locked_at: null,
      worker_id: null,
      attempt_count: 0,
      processed_audio_seconds: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", options.jobId)
    .eq("user_id", options.userId);
}
