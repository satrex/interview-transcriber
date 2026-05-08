import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedSegment } from "./transcribe.js";

export async function clearJobSegments(
  supabase: SupabaseClient,
  jobId: string,
) {
  const { error } = await supabase
    .from("transcription_segments")
    .delete()
    .eq("job_id", jobId);

  if (error) {
    throw new Error(`Failed to clear existing segments: ${error.message}`);
  }
}

export async function saveSegments(
  supabase: SupabaseClient,
  jobId: string,
  segments: NormalizedSegment[],
) {
  if (segments.length === 0) {
    return;
  }

  const { error } = await supabase.from("transcription_segments").upsert(
    segments.map((segment) => ({
      job_id: jobId,
      speaker_label: segment.speakerLabel,
      start_sec: segment.startSec,
      end_sec: segment.endSec,
      text: segment.text,
      chunk_index: segment.chunkIndex,
      segment_index: segment.segmentIndex,
    })),
    {
      onConflict: "job_id,chunk_index,segment_index",
    },
  );

  if (error) {
    throw new Error(`Failed to save transcription segments: ${error.message}`);
  }
}
