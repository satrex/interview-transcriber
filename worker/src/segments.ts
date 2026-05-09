import type { SupabaseClient } from "@supabase/supabase-js";
import { retryTransientOperation } from "./retry.js";
import type { NormalizedSegment } from "./transcribe.js";

export async function clearJobSegments(
  supabase: SupabaseClient,
  jobId: string,
) {
  const { error } = await retryTransientOperation(
    { operation: `clear segments for job ${jobId}` },
    () => supabase.from("transcription_segments").delete().eq("job_id", jobId),
  );

  if (error) {
    throw new Error(`Failed to clear existing segments: ${error.message}`);
  }
}

export async function saveSegments(
  supabase: SupabaseClient,
  jobId: string,
  userId: string,
  segments: NormalizedSegment[],
) {
  if (segments.length === 0) {
    return;
  }

  const { data: savedSegments, error } = await retryTransientOperation(
    { operation: `save segments for job ${jobId}` },
    () =>
      supabase
        .from("transcription_segments")
        .upsert(
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
        )
        .select("id, text"),
  );

  if (error) {
    throw new Error(`Failed to save transcription segments: ${error.message}`);
  }

  const initialSkipRows = (savedSegments || [])
    .filter((segment) => shouldInitiallySkipSegment(String(segment.text)))
    .map((segment) => ({
      job_id: jobId,
      segment_id: String(segment.id),
      user_id: userId,
      is_skipped: true,
    }));

  if (initialSkipRows.length === 0) {
    return;
  }

  const { error: editsError } = await retryTransientOperation(
    { operation: `save initial skipped segments for job ${jobId}` },
    () =>
      supabase
        .from("transcription_segment_edits")
        .upsert(initialSkipRows, {
          ignoreDuplicates: true,
          onConflict: "segment_id",
        }),
  );

  if (editsError) {
    throw new Error(`Failed to save initial skipped segments: ${editsError.message}`);
  }
}

const INITIAL_SKIP_TEXTS = new Set([
  "うん",
  "はい",
  "ええ",
  "ああ",
  "なるほど",
  "そうですね",
  "ですね",
  "はいはい",
  "うーん",
  "ふふ",
  "笑",
]);

function shouldInitiallySkipSegment(text: string) {
  return INITIAL_SKIP_TEXTS.has(normalizeInterjectionText(text));
}

function normalizeInterjectionText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[。、，,.!！?？…]+$/g, "")
    .trim();
}
