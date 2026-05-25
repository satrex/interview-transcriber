import Link from "next/link";
import { logout } from "@/app/actions";
import { FailedProjectDeleteButton } from "@/components/failed-project-delete-button";
import { JobAutoRefresh } from "@/components/job-auto-refresh";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ProjectListItem = {
  id: string;
  title: string;
  original_filename: string | null;
  status: "queued" | "splitting" | "processing_parts" | "completed" | "failed";
  total_duration_sec: number | null;
  part_duration_sec: number;
  total_parts: number | null;
  completed_parts: number;
  failed_parts: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export default async function ProjectsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-12">
        <div className="rounded-md border border-zinc-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-zinc-950">ログインが必要です</h1>
          <p className="mt-3 text-zinc-600">
            プロジェクト一覧を表示するには、Supabase Auth のセッションが必要です。
          </p>
          <Link className="mt-6 inline-block text-sm font-medium text-zinc-950" href="/">
            ログイン画面へ戻る
          </Link>
        </div>
      </main>
    );
  }

  const { data, error } = await supabase
    .from("transcription_projects")
    .select("id, title, original_filename, status, total_duration_sec, part_duration_sec, total_parts, completed_parts, failed_parts, error_code, error_message, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load transcription projects: ${error.message}`);
  }

  const projects = (data || []) as ProjectListItem[];
  const hasActiveProjects = projects.some(
    (project) => project.status === "queued" || project.status === "splitting" || project.status === "processing_parts",
  );

  const formatDuration = (seconds: number | null) => {
    if (seconds === null) return "不明";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}時間${minutes}分`;
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link className="text-sm font-medium text-zinc-600 hover:text-zinc-950" href="/">
            ← アップロード画面へ戻る
          </Link>
          <p className="mt-8 text-sm font-medium uppercase text-zinc-500">
            Interview Transcriber
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-zinc-950">
            プロジェクト一覧
          </h1>
          <p className="mt-3 max-w-2xl text-zinc-600">
            過去の文字起こしプロジェクトを再開し、処理中・完了・失敗したプロジェクトを確認できます。
          </p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
          >
            ログアウト
          </button>
        </form>
      </div>

      {hasActiveProjects ? <JobAutoRefresh status="processing" /> : null}

      <section className="mt-8 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
        {projects.length === 0 ? (
          <div className="p-8">
            <h2 className="text-xl font-semibold text-zinc-950">
              まだプロジェクトがありません
            </h2>
            <p className="mt-2 text-zinc-600">
              音声ファイルをアップロードすると、ここから作業を再開できます。
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
            >
              アップロードへ
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-zinc-200">
            {projects.map((project) => (
              <div key={project.id} className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <Link
                      href={`/projects/${project.id}`}
                      className="text-lg font-medium text-zinc-950 hover:text-zinc-700"
                    >
                      {project.title}
                    </Link>
                    <p className="mt-1 text-sm text-zinc-600">
                      {project.original_filename} | {formatDuration(project.total_duration_sec)} | 分割: {Math.floor(project.part_duration_sec / 60)}分ごと | 進捗: {project.completed_parts} / {project.total_parts || "?"} 完了
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      ステータス: {project.status} | 作成日: {new Date(project.created_at).toLocaleString("ja-JP")}
                    </p>
                    {project.status === "failed" && project.error_message && (
                      <p className="mt-1 text-sm text-red-600">
                        エラー: {project.error_message}
                      </p>
                    )}
                  </div>
                  <div className="ml-4 flex flex-col gap-2">
                    <Link
                      href={`/projects/${project.id}`}
                      className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
                    >
                      詳細を見る
                    </Link>
                    {project.status === "failed" ? (
                      <FailedProjectDeleteButton
                        mode="list"
                        projectId={project.id}
                        projectTitle={project.title}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
