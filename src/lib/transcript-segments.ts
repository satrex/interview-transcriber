import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  SegmentEditMap,
  TranscriptSegment,
} from "@/lib/transcript";

const DEFAULT_SEGMENT_PAGE_SIZE = 1000;

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

type SegmentRow = {
  chunk_index: unknown;
  end_sec: unknown;
  id: unknown;
  mix_suspect_boundary_sec?: unknown;
  mix_suspect_speaker_label?: unknown;
  segment_index: unknown;
  speaker_label: unknown;
  start_sec: unknown;
  text: unknown;
};

type SegmentEditRow = {
  edited_speaker_label?: unknown;
  edited_text: unknown;
  is_skipped: unknown;
  segment_id: unknown;
};

export async function fetchAllSegments(
  jobId: string,
  options: {
    pageSize?: number;
    supabase?: ServerSupabaseClient;
  } = {},
): Promise<TranscriptSegment[]> {
  const supabase = options.supabase ?? (await createServerSupabaseClient());
  const pageSize = normalizePageSize(options.pageSize);
  const rows: SegmentRow[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("transcription_segments")
      .select(
        "id, speaker_label, start_sec, end_sec, text, chunk_index, segment_index, mix_suspect_boundary_sec, mix_suspect_speaker_label",
      )
      .eq("job_id", jobId)
      .order("start_sec", { ascending: true })
      .order("end_sec", { ascending: true })
      .order("chunk_index", { ascending: true })
      .order("segment_index", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`Failed to load transcript segments: ${error.message}`);
    }

    const pageRows = ((data || []) as unknown) as SegmentRow[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rows.map((segment) => ({
    chunkIndex: Number(segment.chunk_index),
    endSec: Number(segment.end_sec),
    id: String(segment.id),
    mixSuspectBoundarySec:
      segment.mix_suspect_boundary_sec === null ||
      segment.mix_suspect_boundary_sec === undefined
        ? null
        : Number(segment.mix_suspect_boundary_sec),
    mixSuspectSpeakerLabel:
      segment.mix_suspect_speaker_label === null ||
      segment.mix_suspect_speaker_label === undefined
        ? null
        : String(segment.mix_suspect_speaker_label),
    segmentIndex: Number(segment.segment_index),
    speakerLabel: String(segment.speaker_label),
    startSec: Number(segment.start_sec),
    text: String(segment.text),
  }));
}

export async function fetchAllSegmentEdits(
  jobId: string,
  options: {
    pageSize?: number;
    supabase?: ServerSupabaseClient;
  } = {},
): Promise<SegmentEditMap> {
  const supabase = options.supabase ?? (await createServerSupabaseClient());
  const pageSize = normalizePageSize(options.pageSize);
  const rows = await fetchSegmentEditRows({
    includeSpeakerOverride: true,
    jobId,
    pageSize,
    supabase,
  });

  return buildSegmentEditMap(rows);
}

async function fetchSegmentEditRows({
  includeSpeakerOverride,
  jobId,
  pageSize,
  supabase,
}: {
  includeSpeakerOverride: boolean;
  jobId: string;
  pageSize: number;
  supabase: ServerSupabaseClient;
}) {
  const rows: SegmentEditRow[] = [];
  const selectColumns = includeSpeakerOverride
    ? "segment_id, edited_text, edited_speaker_label, is_skipped"
    : "segment_id, edited_text, is_skipped";

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("transcription_segment_edits")
      .select(selectColumns)
      .eq("job_id", jobId)
      .order("segment_id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (isMissingEditedSpeakerLabelColumn(error) && includeSpeakerOverride) {
      return fetchSegmentEditRows({
        includeSpeakerOverride: false,
        jobId,
        pageSize,
        supabase,
      });
    }

    if (error) {
      throw new Error(`Failed to load segment edits: ${error.message}`);
    }

    const pageRows = ((data || []) as unknown) as SegmentEditRow[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rows;
}

function buildSegmentEditMap(rows: SegmentEditRow[]) {
  const segmentEdits: SegmentEditMap = {};

  for (const row of rows) {
    segmentEdits[String(row.segment_id)] = {
      editedText:
        typeof row.edited_text === "string" && row.edited_text.trim()
          ? row.edited_text
          : null,
      isSkipped: Boolean(row.is_skipped),
      speakerOverride:
        "edited_speaker_label" in row &&
        typeof row.edited_speaker_label === "string" &&
        row.edited_speaker_label.trim()
          ? row.edited_speaker_label
          : null,
    };
  }

  return segmentEdits;
}

function normalizePageSize(pageSize = DEFAULT_SEGMENT_PAGE_SIZE) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return DEFAULT_SEGMENT_PAGE_SIZE;
  }

  return Math.min(pageSize, DEFAULT_SEGMENT_PAGE_SIZE);
}

function isMissingEditedSpeakerLabelColumn(error: { message?: string } | null) {
  return Boolean(
    error?.message?.includes("edited_speaker_label") &&
      error.message.includes("does not exist"),
  );
}
