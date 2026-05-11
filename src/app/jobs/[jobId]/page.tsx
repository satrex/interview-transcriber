import Link from "next/link";
import { notFound } from "next/navigation";
import { JobAutoRefresh } from "@/components/job-auto-refresh";
import {
  QualityNotesForm,
  type QualityNotesFormValues,
} from "@/components/quality-notes-form";
import {
  SpeakerAnalysisPanel,
  type SpeakerNameFormRow,
} from "@/components/speaker-analysis-panel";
import { TranscriptMarkdown } from "@/components/transcript-markdown";
import { analyzeSpeakers } from "@/lib/speaker-analysis";
import { getJobErrorDisplayMessage } from "@/lib/job-errors";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAudioSignedUrl, getAudioBucketName } from "@/lib/storage";
import {
  fetchAllSegmentEdits,
  fetchAllSegments,
} from "@/lib/transcript-segments";
import type {
  SpeakerNameMap,
} from "@/lib/transcript";

type JobDetailPageProps = {
  params: Promise<{
    jobId: string;
  }>;
};

type JobDetailRow = {
  audio_chunk_duration_sec?: number | string | null;
  audio_duration_sec: number | string | null;
  created_at: string;
  error_code: string | null;
  error_message: string | null;
  expected_speaker_count: number | string | null;
  id: string;
  original_filename: string;
  progress: number;
  skipped_segments_count: number | null;
  status: "queued" | "processing" | "completed" | "failed";
  storage_bucket: string;
  storage_path: string;
  updated_at: string;
};

const JOB_DETAIL_SELECT_WITH_CHUNKS =
  "id, original_filename, status, progress, audio_duration_sec, audio_chunk_duration_sec, skipped_segments_count, error_code, error_message, storage_bucket, storage_path, expected_speaker_count, created_at, updated_at";

const JOB_DETAIL_SELECT_BASE =
  "id, original_filename, status, progress, audio_duration_sec, skipped_segments_count, error_code, error_message, storage_bucket, storage_path, expected_speaker_count, created_at, updated_at";

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-12">
        <div className="rounded-md border border-zinc-200 bg-white p-8">
          <h1 className="text-2xl font-semibold text-zinc-950">ログインが必要です</h1>
          <p className="mt-3 text-zinc-600">
            このジョブを表示するには、Supabase Auth のセッションが必要です。
          </p>
          <Link className="mt-6 inline-block text-sm font-medium text-zinc-950" href="/">
            アップロード画面へ戻る
          </Link>
        </div>
      </main>
    );
  }

  console.debug("[job detail] loading job", {
    jobId,
    supabaseProject: getSupabaseProjectRef(),
    userId: user.id,
  });

  const job = await loadJobForCurrentUser({ jobId, supabase, userId: user.id });

  if (!job) {
    const visibility = await checkJobVisibilityForDiagnostics(jobId);

    if (!visibility.exists) {
      console.debug("[job detail] job not found", {
        jobId,
        supabaseProject: getSupabaseProjectRef(),
        userId: user.id,
      });
      notFound();
    }

    console.warn("[job detail] job exists but current user cannot read it", {
      jobId,
      jobOwnerId: visibility.userId,
      jobStatus: visibility.status,
      supabaseProject: getSupabaseProjectRef(),
      userId: user.id,
    });

    return (
      <JobAccessIssue
        jobId={jobId}
        message="このジョブはDBに存在しますが、現在ログイン中のユーザーからは表示できません。RLS、ログインユーザー、または参照しているSupabase環境を確認してください。"
      />
    );
  }

  const [segments, segmentEdits] = await Promise.all([
    fetchAllSegments(job.id, { supabase }),
    fetchAllSegmentEdits(job.id, { supabase }),
  ]);

  const { data: qualityNote, error: qualityNoteError } = await supabase
    .from("transcription_job_quality_notes")
    .select(
      "recording_environment, misrecognition_notes, speaker_misidentification_notes, timestamp_offset_notes, general_quality_notes",
    )
    .eq("job_id", job.id)
    .maybeSingle();

  if (qualityNoteError) {
    throw new Error(`Failed to load quality notes: ${qualityNoteError.message}`);
  }

  const qualityNoteValues: QualityNotesFormValues = {
    recordingEnvironment: qualityNote?.recording_environment || "",
    misrecognitionNotes: qualityNote?.misrecognition_notes || "",
    speakerMisidentificationNotes:
      qualityNote?.speaker_misidentification_notes || "",
    timestampOffsetNotes: qualityNote?.timestamp_offset_notes || "",
    generalQualityNotes: qualityNote?.general_quality_notes || "",
  };

  const { data: speakerNameRows, error: speakerNamesError } = await supabase
    .from("transcription_job_speaker_names")
    .select("speaker_label, display_name")
    .eq("job_id", job.id)
    .order("speaker_label", { ascending: true });

  if (speakerNamesError) {
    throw new Error(`Failed to load speaker names: ${speakerNamesError.message}`);
  }

  const speakerNames: SpeakerNameMap = {};
  const speakerLabels = new Set(segments.map((segment) => segment.speakerLabel));

  for (const edit of Object.values(segmentEdits)) {
    if (edit.speakerOverride) {
      speakerLabels.add(edit.speakerOverride);
    }
  }

  for (const row of speakerNameRows || []) {
    const speakerLabel = String(row.speaker_label);
    const displayName = String(row.display_name || "").trim();
    speakerLabels.add(speakerLabel);

    if (displayName) {
      speakerNames[speakerLabel] = displayName;
    }
  }

  const speakerFormRows: SpeakerNameFormRow[] = Array.from(speakerLabels)
    .sort((left, right) => left.localeCompare(right))
    .map((speakerLabel) => ({
      displayName: speakerNames[speakerLabel] || "",
      speakerLabel,
    }));
  const speakerAnalysis = analyzeSpeakers(
    segments,
    Number(job.expected_speaker_count || 2),
  );
  const audioChunkDurationSec = toNumber(job.audio_chunk_duration_sec ?? null);
  const adminSupabase = createAdminSupabaseClient();
  let audioSignedUrl: string | null = null;
  let audioLoadError: string | null = null;

  try {
    audioSignedUrl = await createAudioSignedUrl({
      bucket: getAudioBucketName(),
      path: job.storage_path,
      storage: adminSupabase.storage,
    });
  } catch (error) {
    audioLoadError =
      error instanceof Error
        ? error.message
        : "音声ファイルの署名付きURLを作成できませんでした。";
    console.error("[job detail] failed to create audio signed URL", {
      bucket: job.storage_bucket,
      error,
      jobId: job.id,
      path: job.storage_path,
    });
  }
  const shouldExpandSystemDetails =
    job.status === "processing" || job.status === "failed";

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12">
      <Link className="text-sm font-medium text-zinc-600 hover:text-zinc-950" href="/jobs">
        ← プロジェクト一覧へ戻る
      </Link>

      <section className="mt-8 rounded-md border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase text-zinc-500">Job</p>
            <h1 className="mt-2 wrap-break-word text-3xl font-semibold text-zinc-950">
              {job.original_filename}
            </h1>
          </div>
          <span className="w-fit rounded-md border border-zinc-200 px-3 py-1 text-sm font-medium text-zinc-700">
            {job.status}
          </span>
        </div>

        <details
          className="mt-6 rounded-md border border-zinc-200 bg-zinc-50 p-4"
          open={shouldExpandSystemDetails}
        >
          <summary className="cursor-pointer list-none text-sm text-zinc-700 marker:hidden">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-zinc-950">詳細を見る</span>
                <span>Status: {job.status}</span>
                <span>Progress: {job.progress}%</span>
                {job.error_message ? (
                  <span className="font-medium text-red-700">Errorあり</span>
                ) : null}
              </div>
              <span className="text-xs text-zinc-500">
                品質メモとシステム情報
              </span>
            </div>
          </summary>

          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-zinc-500">Status</dt>
              <dd className="mt-1 font-medium text-zinc-950">{job.status}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Progress</dt>
              <dd className="mt-1 font-medium text-zinc-950">{job.progress}%</dd>
              <JobAutoRefresh status={job.status} />
            </div>
            <div className="sm:col-span-2">
              <dt className="text-zinc-500">Error</dt>
              <dd className="mt-1 text-zinc-950">
                {job.status === "failed"
                  ? getJobErrorDisplayMessage(job.error_code || "unknown")
                  : "なし"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Error code</dt>
              <dd className="mt-1 font-mono text-xs text-zinc-700">
                {job.error_code || "なし"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Raw error message</dt>
              <dd className="mt-1 text-zinc-950">
                {job.error_message || "なし"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Storage path</dt>
              <dd className="mt-1 break-all font-mono text-xs text-zinc-700">
                {job.storage_path}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Audio duration</dt>
              <dd className="mt-1 font-medium text-zinc-950">
                {formatDuration(
                  toNumber(job.audio_duration_sec) ??
                    Math.max(0, ...segments.map((segment) => segment.endSec)),
                )}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Skipped empty segments</dt>
              <dd className="mt-1 font-medium text-zinc-950">
                {job.skipped_segments_count || 0}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Created</dt>
              <dd className="mt-1 font-medium text-zinc-950">
                {new Date(job.created_at).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Updated</dt>
              <dd className="mt-1 font-medium text-zinc-950">
                {new Date(job.updated_at).toLocaleString()}
              </dd>
            </div>
          </dl>

          {job.error_message ? (
            <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {getJobErrorDisplayMessage(job.error_code || "unknown")}
            </p>
          ) : null}

          <QualityNotesForm jobId={job.id} initialValues={qualityNoteValues} />
        </details>

        <SpeakerAnalysisPanel
          analysis={speakerAnalysis}
          jobId={job.id}
          speakers={speakerFormRows}
        />

        <TranscriptMarkdown
          audioChunkDurationSec={audioChunkDurationSec}
          audioUrl={audioSignedUrl}
          audioLoadError={audioChunkDurationSec ? null : audioLoadError}
          exportBaseName={job.original_filename}
          jobId={job.id}
          segmentEdits={segmentEdits}
          segments={segments}
          speakerNames={speakerNames}
        />
      </section>
    </main>
  );
}

async function loadJobForCurrentUser({
  jobId,
  supabase,
  userId,
}: {
  jobId: string;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
}) {
  const result = await supabase
    .from("transcription_jobs")
    .select(JOB_DETAIL_SELECT_WITH_CHUNKS)
    .eq("id", jobId)
    .maybeSingle();

  if (!result.error) {
    return result.data as JobDetailRow | null;
  }

  if (isMissingColumnError(result.error, "audio_chunk_duration_sec")) {
    console.warn(
      "[job detail] audio_chunk_duration_sec column is missing; falling back to source audio mode. Apply supabase/migrations/0012_audio_chunk_duration.sql to enable chunk playback metadata.",
      {
        error: result.error.message,
        jobId,
        supabaseProject: getSupabaseProjectRef(),
        userId,
      },
    );

    const fallbackResult = await supabase
      .from("transcription_jobs")
      .select(JOB_DETAIL_SELECT_BASE)
      .eq("id", jobId)
      .maybeSingle();

    if (!fallbackResult.error) {
      const fallbackJob = fallbackResult.data as JobDetailRow | null;
      return fallbackJob
        ? { ...fallbackJob, audio_chunk_duration_sec: null }
        : null;
    }

    console.error("[job detail] fallback job query failed", {
      error: fallbackResult.error,
      jobId,
      supabaseProject: getSupabaseProjectRef(),
      userId,
    });
    throw new Error(`Failed to load job detail: ${fallbackResult.error.message}`);
  }

  console.error("[job detail] job query failed", {
    error: result.error,
    jobId,
    supabaseProject: getSupabaseProjectRef(),
    userId,
  });
  throw new Error(`Failed to load job detail: ${result.error.message}`);
}

async function checkJobVisibilityForDiagnostics(jobId: string) {
  try {
    const adminSupabase = createAdminSupabaseClient();
    const { data, error } = await adminSupabase
      .from("transcription_jobs")
      .select("id, user_id, status")
      .eq("id", jobId)
      .maybeSingle();

    if (error) {
      console.error("[job detail] admin visibility check failed", {
        error,
        jobId,
        supabaseProject: getSupabaseProjectRef(),
      });
      throw new Error(`Failed to check job visibility: ${error.message}`);
    }

    if (!data) {
      return { exists: false as const };
    }

    return {
      exists: true as const,
      status: String(data.status),
      userId: String(data.user_id),
    };
  } catch (error) {
    console.error("[job detail] visibility diagnostic failed", {
      error,
      jobId,
      supabaseProject: getSupabaseProjectRef(),
    });
    throw error;
  }
}

function JobAccessIssue({
  jobId,
  message,
}: {
  jobId: string;
  message: string;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-12">
      <section className="rounded-md border border-amber-200 bg-amber-50 p-8">
        <h1 className="text-2xl font-semibold text-amber-950">
          ジョブを表示できません
        </h1>
        <p className="mt-3 text-sm leading-6 text-amber-900">{message}</p>
        <p className="mt-4 break-all font-mono text-xs text-amber-800">
          jobId: {jobId}
        </p>
        <Link
          className="mt-6 inline-block text-sm font-semibold text-amber-950"
          href="/jobs"
        >
          プロジェクト一覧へ戻る
        </Link>
      </section>
    </main>
  );
}

function isMissingColumnError(error: { code?: string; message?: string }, column: string) {
  return Boolean(
    error.code === "42703" ||
      (error.message?.includes(column) && error.message.includes("does not exist")),
  );
}

function getSupabaseProjectRef() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (!url) {
      return null;
    }

    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function formatDuration(value: number) {
  const totalSeconds = Math.max(0, Math.round(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function toNumber(value: number | string | null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
