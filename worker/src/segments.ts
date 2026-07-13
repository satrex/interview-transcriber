import type { SupabaseClient } from "@supabase/supabase-js";
import { retryTransientOperation } from "./retry.js";
import type { NormalizedSegment } from "./transcribe.js";

export type SavedJobSegment = {
  speakerLabel: string;
  startSec: number;
  endSec: number;
  text: string;
  chunkIndex: number;
  segmentIndex: number;
};

export async function loadJobSegments(
  supabase: SupabaseClient,
  jobId: string,
): Promise<SavedJobSegment[]> {
  const { data, error } = await retryTransientOperation(
    { operation: `load segments for job ${jobId}` },
    () =>
      supabase
        .from("transcription_segments")
        .select("speaker_label, start_sec, end_sec, text, chunk_index, segment_index")
        .eq("job_id", jobId)
        .order("chunk_index", { ascending: true })
        .order("segment_index", { ascending: true }),
  );

  if (error) {
    throw new Error(`Failed to load existing segments: ${error.message}`);
  }

  return (data ?? []).map((segment) => ({
    speakerLabel: String(segment.speaker_label),
    startSec: Number(segment.start_sec),
    endSec: Number(segment.end_sec),
    text: String(segment.text),
    chunkIndex: Number(segment.chunk_index),
    segmentIndex: Number(segment.segment_index),
  }));
}

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
            mix_suspect_boundary_sec: segment.mixSuspectBoundarySec ?? null,
            mix_suspect_speaker_label: segment.mixSuspectSpeakerLabel ?? null,
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
  "hi",
  "hmm",
  "mm",
  "mmhmm",
  "ohyeah",
  "okay",
  "うん",
  "うんうん",
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
    .toLowerCase()
    .replace(/[\s。、，,.!！?？…'"“”‘’\-–—]+/g, "")
    .trim();
}
