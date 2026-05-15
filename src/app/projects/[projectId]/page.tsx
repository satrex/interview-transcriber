import Link from "next/link";
import { notFound } from "next/navigation";
import { JobAutoRefresh } from "@/components/job-auto-refresh";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { exportProjectDirectly } from "@/app/actions";

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

  const hasActiveJobs = partJobs.some(
    (job) => job.status === "queued" || job.status === "processing",
  );

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
      </div>

      {hasActiveJobs ? <JobAutoRefresh status="processing" /> : null}

      <section className="mt-8 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-950">パート一覧</h2>
        </div>
        <div className="divide-y divide-zinc-200">
          {partJobs.length === 0 ? (
            <div className="p-8 text-center text-zinc-600">
              パートジョブがまだ作成されていません。
            </div>
          ) : (
            partJobs
              .sort((a, b) => a.part_index - b.part_index)
              .map((job) => (
                <div key={job.id} className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-medium text-zinc-950">
                        Part {job.part_index + 1}: {formatTime(job.part_start_sec)} - {formatTime(job.part_end_sec)}
                      </h3>
                      <p className="mt-1 text-sm text-zinc-600">
                        ステータス: {job.status} | 進捗: {job.progress}%
                      </p>
                      {job.status === "failed" && job.error_message && (
                        <p className="mt-1 text-sm text-red-600">
                          エラー: {job.error_message}
                        </p>
                      )}
                    </div>
                    <div>
                      {job.status === "completed" && (
                        <Link
                          href={`/jobs/${job.id}`}
                          className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
                        >
                          編集する
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))
          )}
        </div>
      </section>

      {/* Export Section */}
      <section className="mt-8 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-950">エクスポート</h2>
        </div>
        <div className="p-6">
          <form action={exportProjectDirectly}>
            <input type="hidden" name="projectId" value={project.id} />
            {project.total_parts !== null && project.completed_parts === project.total_parts ? (
              <button
                type="submit"
                className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
              >
                Markdownでエクスポート
              </button>
            ) : (
              <p className="text-sm text-zinc-600">
                すべてのパートが完了するまでエクスポートできません。完了していないパート: {project.total_parts !== null ? project.total_parts - project.completed_parts : "?"}
個
              </p>
            )}
          </form>
        </div>
      </section>
    </main>
  );
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