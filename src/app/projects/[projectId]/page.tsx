import Link from "next/link";
import { notFound } from "next/navigation";
import { FailedProjectDeleteButton } from "@/components/failed-project-delete-button";
import { ProjectExportButton } from "@/components/project-export-button";
import ProjectStatusPanel from "@/components/project-status-panel";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ProjectDetailPageProps = {
  params: Promise<{
    projectId: string;
  }>;
};

type ProjectDetailRow = {
  id: string;
  title: string;
  original_filename: string | null;
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

type PartJobRow = {
  id: string;
  part_index: number;
  part_start_sec: number;
  part_end_sec: number;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  error_message: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { projectId } = await params;
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
            このプロジェクトを表示するには、Supabase Auth のセッションが必要です。
          </p>
          <Link className="mt-6 inline-block text-sm font-medium text-zinc-950" href="/">
            アップロード画面へ戻る
          </Link>
        </div>
      </main>
    );
  }

  const project = await loadProjectForCurrentUser({ projectId, supabase, userId: user.id });

  if (!project) {
    notFound();
  }

  const partJobs = await loadPartJobsForProject({ projectId, supabase, userId: user.id });

  const incompletePartCount =
    project.total_parts !== null
      ? Math.max(0, project.total_parts - project.completed_parts)
      : null;
  const canExport =
    project.status === "completed" &&
    project.total_parts !== null &&
    project.total_parts > 0 &&
    project.completed_parts === project.total_parts &&
    partJobs.length === project.total_parts &&
    partJobs.every((job) => job.status === "completed");
  const exportUnavailableReason = buildExportUnavailableReason({
    incompletePartCount,
    partJobsCount: partJobs.length,
    projectStatus: project.status,
    totalParts: project.total_parts,
  });

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatDuration = (seconds: number | null) => {
    if (seconds === null) return "不明";
    return formatTime(seconds);
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link className="text-sm font-medium text-zinc-600 hover:text-zinc-950" href="/projects">
            ← プロジェクト一覧へ戻る
          </Link>
          <p className="mt-8 text-sm font-medium uppercase text-zinc-500">
            Interview Transcriber
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-zinc-950">
            {project.title}
          </h1>
          <p className="mt-3 max-w-2xl text-zinc-600">
            全体: {formatDuration(project.total_duration_sec)} | 分割: {Math.floor(project.part_duration_sec / 60)}分ごと | 進捗: {project.completed_parts} / {project.total_parts || "?"} 完了
          </p>
          {project.status === "failed" && project.error_message && (
            <p className="mt-2 text-red-600">
              エラー: {project.error_message}
            </p>
          )}
        </div>
        {project.status === "failed" ? (
          <FailedProjectDeleteButton
            mode="detail"
            projectId={project.id}
            projectTitle={project.title}
          />
        ) : null}
      </div>

      <ProjectStatusPanel project={project} parts={partJobs} projectId={project.id} />

      {/* Export Section */}
      <section className="mt-8 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-950">エクスポート</h2>
        </div>
        <div className="p-6">
          <ProjectExportButton
            canExport={canExport}
            exportBaseName={project.title || project.original_filename || "transcript"}
            projectId={project.id}
            unavailableReason={exportUnavailableReason}
          />
        </div>
      </section>
    </main>
  );
}

function buildExportUnavailableReason({
  incompletePartCount,
  partJobsCount,
  projectStatus,
  totalParts,
}: {
  incompletePartCount: number | null;
  partJobsCount: number;
  projectStatus: ProjectDetailRow["status"];
  totalParts: number | null;
}) {
  if (projectStatus !== "completed") {
    return "プロジェクトが完了するとMarkdownをエクスポートできます。";
  }

  if (totalParts === null || totalParts < 1) {
    return "パート情報が未確定のため、まだエクスポートできません。";
  }

  if (partJobsCount !== totalParts) {
    return "パート情報が不足しているため、まだエクスポートできません。";
  }

  if (incompletePartCount !== null && incompletePartCount > 0) {
    return `すべてのパートが完了するまでエクスポートできません。完了していないパート: ${incompletePartCount}個`;
  }

  return "完了していないパートがあるため、まだエクスポートできません。";
}

async function loadProjectForCurrentUser({
  projectId,
  supabase,
  userId,
}: {
  projectId: string;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
}): Promise<ProjectDetailRow | null> {
  const { data, error } = await supabase
    .from("transcription_projects")
    .select("id, title, original_filename, status, total_duration_sec, part_duration_sec, total_parts, completed_parts, failed_parts, error_message, error_code, created_at, updated_at")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load project:", error);
    return null;
  }

  return data;
}

async function loadPartJobsForProject({
  projectId,
  supabase,
  userId,
}: {
  projectId: string;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
}): Promise<PartJobRow[]> {
  const { data, error } = await supabase
    .from("transcription_jobs")
    .select("id, part_index, part_start_sec, part_end_sec, status, progress, error_message, error_code, created_at, updated_at")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("is_project_part", true)
    .order("part_index");

  if (error) {
    console.error("Failed to load part jobs:", error);
    return [];
  }

  return data || [];
}
