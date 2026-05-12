import { createClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";

export type TranscriptionJob = {
  id: string;
  user_id: string;
  original_filename: string;
  storage_bucket: string;
  storage_path: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  audio_duration_sec: number | null;
  audio_chunk_duration_sec: number | null;
  processed_audio_seconds: number | null;
  term_dictionary_id: string | null;
  skipped_segments_count: number;
  attempt_count: number;
  worker_id: string | null;
  locked_at: string | null;
};

export function createSupabaseClient(config: WorkerConfig) {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
