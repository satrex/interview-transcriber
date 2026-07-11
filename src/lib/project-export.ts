import "server-only";

import {
  buildTranscriptBlocks,
  buildTranscriptMarkdown,
  type SpeakerNameMap,
  type TranscriptSegment,
} from "@/lib/transcript";
import {
  classifyBackchannels,
  type BackchannelMode,
} from "@/lib/backchannel";
import {
  fetchAllSegmentEdits,
  fetchAllSegments,
} from "@/lib/transcript-segments";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

type ProjectExportRow = {
  completed_parts: number;
  id: string;
  original_filename: string | null;
  status: "queued" | "splitting" | "processing_parts" | "completed" | "failed";
  title: string;
  total_parts: number | null;
};

type ProjectPartRow = {
  id: string;
  part_end_sec: number | null;
  part_index: number | null;
  part_start_sec: number | null;
  status: "queued" | "processing" | "completed" | "failed";
};

export type ProjectMarkdownExport = {
  fileBaseName: string;
  markdown: string;
};

export class ProjectExportError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProjectExportError";
    this.status = status;
  }
}

export async function buildProjectMarkdownExport({
  backchannelMode = "hide",
  projectId,
  supabase,
  userId,
}: {
  backchannelMode?: BackchannelMode;
  projectId: string;
  supabase: ServerSupabaseClient;
  userId: string;
}): Promise<ProjectMarkdownExport> {
  const project = await loadProject({ projectId, supabase, userId });
  const partJobs = await loadProjectParts({ projectId, supabase, userId });

  assertProjectReady(project, partJobs);

  const partsMarkdown: string[] = [];
  let exportedSegmentCount = 0;

  for (const partJob of partJobs) {
    const partStartSec = Number(partJob.part_start_sec ?? 0);
    const { segmentEdits, segments } = await loadEffectiveSegments({
      jobId: partJob.id,
      partStartSec,
      supabase,
    });
    const speakerNames = await loadSpeakerNames({ jobId: partJob.id, supabase });
    exportedSegmentCount += segments.length;

    const backchannelIds = classifyBackchannels(segments, segmentEdits);
    const blocks = buildTranscriptBlocks(segments, speakerNames, {
      backchannelIds,
      backchannelMode,
    });
    const transcriptMarkdown = buildTranscriptMarkdown(blocks, {
      showTimestamps: true,
    });
    const startTime = formatClockTime(partStartSec);
    const endTime = formatClockTime(Number(partJob.part_end_sec ?? partStartSec));
    const partNumber = Number(partJob.part_index ?? 0) + 1;

    partsMarkdown.push(
      [`## Part ${partNumber}: ${startTime} - ${endTime}`, transcriptMarkdown]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  if (exportedSegmentCount === 0) {
    throw new ProjectExportError(
      "エクスポートできるセグメントがありません。すべて skip 済み、または文字起こし結果が0件です。",
      422,
    );
  }

  return {
    fileBaseName: project.title || project.original_filename || "transcript",
    markdown: [`# ${project.title}`, ...partsMarkdown].join("\n\n").trimEnd() + "\n",
  };
}

export function sanitizeMarkdownFileName(value: string) {
  const baseName = value.replace(/\.[^/.]+$/, "");
  const sanitized = baseName
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized || "transcript";
}

async function loadProject({
  projectId,
  supabase,
  userId,
}: {
  projectId: string;
  supabase: ServerSupabaseClient;
  userId: string;
}) {
  const { data, error } = await supabase
    .from("transcription_projects")
    .select("id, title, original_filename, status, total_parts, completed_parts")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new ProjectExportError(
      `プロジェクトの取得に失敗しました: ${error.message}`,
      500,
    );
  }

  if (!data) {
    throw new ProjectExportError(
      "プロジェクトが見つからないか、表示する権限がありません。",
      404,
    );
  }

  return data as ProjectExportRow;
}

async function loadProjectParts({
  projectId,
  supabase,
  userId,
}: {
  projectId: string;
  supabase: ServerSupabaseClient;
  userId: string;
}) {
  const { data, error } = await supabase
    .from("transcription_jobs")
    .select("id, part_index, part_start_sec, part_end_sec, status")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("is_project_part", true)
    .order("part_index", { ascending: true });

  if (error) {
    throw new ProjectExportError(
      `パートジョブの取得に失敗しました: ${error.message}`,
      500,
    );
  }

  return ((data || []) as ProjectPartRow[]).sort(
    (left, right) => Number(left.part_index ?? 0) - Number(right.part_index ?? 0),
  );
}

function assertProjectReady(project: ProjectExportRow, partJobs: ProjectPartRow[]) {
  if (project.status !== "completed") {
    throw new ProjectExportError(
      "プロジェクトがまだ完了していないため、Markdownを生成できません。",
      409,
    );
  }

  if (project.total_parts === null || project.total_parts < 1) {
    throw new ProjectExportError(
      "パート情報が未確定のため、Markdownを生成できません。",
      409,
    );
  }

  if (project.completed_parts !== project.total_parts) {
    throw new ProjectExportError(
      `すべてのパートが完了していません。完了していないパート: ${
        project.total_parts - project.completed_parts
      }個`,
      409,
    );
  }

  if (partJobs.length !== project.total_parts) {
    throw new ProjectExportError(
      "パート情報が不足しているため、Markdownを生成できません。",
      409,
    );
  }

  const incompletePartCount = partJobs.filter(
    (partJob) => partJob.status !== "completed",
  ).length;

  if (incompletePartCount > 0) {
    throw new ProjectExportError(
      `完了していないパートが ${incompletePartCount} 個あります。`,
      409,
    );
  }
}

async function loadEffectiveSegments({
  jobId,
  partStartSec,
  supabase,
}: {
  jobId: string;
  partStartSec: number;
  supabase: ServerSupabaseClient;
}) {
  const [segments, segmentEdits] = await Promise.all([
    fetchAllSegments(jobId, { supabase }),
    fetchAllSegmentEdits(jobId, { supabase }),
  ]);

  return {
    segmentEdits,
    segments: segments
    .map((segment): TranscriptSegment | null => {
      const edit = segmentEdits[segment.id];

      if (edit?.isSkipped) {
        return null;
      }

      return {
        ...segment,
        endSec: segment.endSec + partStartSec,
        speakerLabel: edit?.speakerOverride || segment.speakerLabel,
        startSec: segment.startSec + partStartSec,
        text: edit?.editedText || segment.text,
      };
    })
    .filter((segment): segment is TranscriptSegment => segment !== null),
  };
}

async function loadSpeakerNames({
  jobId,
  supabase,
}: {
  jobId: string;
  supabase: ServerSupabaseClient;
}) {
  const { data, error } = await supabase
    .from("transcription_job_speaker_names")
    .select("speaker_label, display_name")
    .eq("job_id", jobId);

  if (error) {
    throw new ProjectExportError(
      `話者名の取得に失敗しました: ${error.message}`,
      500,
    );
  }

  const speakerNames: SpeakerNameMap = {};

  for (const row of data || []) {
    if (
      typeof row.speaker_label === "string" &&
      typeof row.display_name === "string" &&
      row.display_name.trim()
    ) {
      speakerNames[row.speaker_label] = row.display_name.trim();
    }
  }

  return speakerNames;
}

function formatClockTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
