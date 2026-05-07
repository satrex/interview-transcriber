import { UploadForm } from "@/components/upload-form";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-md border border-zinc-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-medium uppercase text-zinc-500">
            Interview Transcriber
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-zinc-950">
            音声ファイルをアップロード
          </h1>
          <p className="mt-3 max-w-2xl text-zinc-600">
            アップロード後、queued 状態の文字起こしジョブを作成します。OpenAI API と ffmpeg による処理は次のステップで worker 側に実装します。
          </p>

          <div className="mt-8">
            <UploadForm />
          </div>
        </section>
      </main>
    </div>
  );
}
