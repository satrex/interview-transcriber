import Link from "next/link";
import { notFound } from "next/navigation";
import { TranscriptMarkdown } from "@/components/transcript-markdown";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { TranscriptSegment } from "@/lib/transcript";

type JobDetailPageProps = {
  params: Promise<{
    jobId: string;
  }>;
};

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

  const { data: job, error } = await supabase
    .from("transcription_jobs")
    .select(
      "id, original_filename, status, progress, error_message, storage_path, created_at, updated_at",
    )
    .eq("id", jobId)
    .single();

  if (error || !job) {
    notFound();
  }

  const { data: segmentRows, error: segmentsError } = await supabase
    .from("transcription_segments")
    .select("id, speaker_label, start_sec, end_sec, text, chunk_index")
    .eq("job_id", job.id)
    .order("chunk_index", { ascending: true })
    .order("start_sec", { ascending: true });

  if (segmentsError) {
    throw new Error(`Failed to load transcript segments: ${segmentsError.message}`);
  }

  const segments: TranscriptSegment[] =
    segmentRows?.map((segment) => ({
      id: String(segment.id),
      speakerLabel: String(segment.speaker_label),
      startSec: Number(segment.start_sec),
      endSec: Number(segment.end_sec),
      text: String(segment.text),
      chunkIndex: Number(segment.chunk_index),
    })) || [];

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12">
      <Link className="text-sm font-medium text-zinc-600 hover:text-zinc-950" href="/">
        ← アップロード画面へ戻る
      </Link>

      <section className="mt-8 rounded-md border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase text-zinc-500">Job</p>
            <h1 className="mt-2 break-words text-3xl font-semibold text-zinc-950">
              {job.original_filename}
            </h1>
          </div>
          <span className="w-fit rounded-md border border-zinc-200 px-3 py-1 text-sm font-medium text-zinc-700">
            {job.status}
          </span>
        </div>

        <dl className="mt-8 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Progress</dt>
            <dd className="mt-1 font-medium text-zinc-950">{job.progress}%</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Storage path</dt>
            <dd className="mt-1 break-all font-mono text-xs text-zinc-700">
              {job.storage_path}
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
            {job.error_message}
          </p>
        ) : null}

        <TranscriptMarkdown segments={segments} />
      </section>
    </main>
  );
}
