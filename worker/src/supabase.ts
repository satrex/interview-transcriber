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
  expected_speaker_count: number | null;
  term_dictionary_id: string | null;
  skipped_segments_count: number;
  attempt_count: number;
  worker_id: string | null;
  locked_at: string | null;
  project_id: string | null;
  part_index: number | null;
  part_start_sec: number | null;
  part_end_sec: number | null;
  is_project_part: boolean;
};

export type TranscriptionProject = {
  id: string;
  user_id: string;
  title: string;
  original_filename: string | null;
  storage_bucket: string;
  storage_path: string;
  status: "queued" | "splitting" | "processing_parts" | "completed" | "failed";
  total_duration_sec: number | null;
  part_duration_sec: number;
  total_parts: number | null;
  completed_parts: number;
  failed_parts: number;
  error_message: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

export function createSupabaseClient(config: WorkerConfig) {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
