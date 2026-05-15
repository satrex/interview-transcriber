import Link from "next/link";
import { logout } from "@/app/actions";
import { JobAutoRefresh } from "@/components/job-auto-refresh";
import { JobListRow } from "@/components/job-list-row";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type JobListItem = {
  id: string;
  original_filename: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  audio_duration_sec: number | string | null;
  segment_count: number | string | null;
  segment_duration_sec: number | string | null;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number | null;
  created_at: string;
  updated_at: string;
};

export default async function JobsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-md border border-zinc-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-zinc-950">ログインが必要です</h1>
          <p className="mt-3 text-zinc-600">
            プロジェクト一覧を表示するには、Supabase Auth のセッションが必要です。
          </p>
          <Link className="mt-6 inline-block text-sm font-medium text-zinc-950" href="/">
            ログイン画面へ戻る
          </Link>
        </section>
      </main>
    );
  }

  const { data, error } = await supabase.rpc("get_transcription_job_list");

  if (error) {
    throw new Error(`Failed to load transcription jobs: ${error.message}`);
  }

  const jobs = (data || []) as JobListItem[];
  const hasActiveJobs = jobs.some(
    (job) => job.status === "queued" || job.status === "processing",
  );

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
            過去の文字起こし作業を再開し、処理中・完了・失敗したジョブを確認できます。
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

      {hasActiveJobs ? <JobAutoRefresh status="processing" /> : null}

      <section className="mt-8 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
        {jobs.length === 0 ? (
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-245 border-collapse text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">タイトル / 元ファイル名</th>
                  <th className="px-4 py-3 font-semibold">作成日時</th>
                  <th className="px-4 py-3 font-semibold">最終更新</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Progress</th>
                  <th className="px-4 py-3 font-semibold">音声長</th>
                  <th className="px-4 py-3 font-semibold">Segments</th>
                  <th className="px-4 py-3 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {jobs.map((job) => {
                  const durationSec =
                    toNumber(job.audio_duration_sec) ??
                    toNumber(job.segment_duration_sec);
                  const segmentCount = toNumber(job.segment_count) ?? 0;

                  return (
                    <JobListRow
                      key={job.id}
                      createdAt={formatDateTime(job.created_at)}
                      durationLabel={formatDuration(durationSec)}
                      errorCode={job.error_code}
                      id={job.id}
                      originalFilename={job.original_filename}
                      progress={job.progress}
                      segmentCountLabel={segmentCount.toLocaleString()}
                      status={job.status}
                      updatedAt={formatDateTime(job.updated_at)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDuration(value: number | null) {
  if (value === null) {
    return "未確定";
  }

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
