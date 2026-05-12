import Link from "next/link";
import { logout } from "@/app/actions";
import { LoginForm } from "@/components/login-form";
import { UploadForm } from "@/components/upload-form";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: dictionaries, error: dictionariesError } = user
    ? await supabase
        .from("term_dictionaries")
        .select("id, name")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
    : { data: [], error: null };

  if (dictionariesError) {
    throw new Error(`Failed to load term dictionaries: ${dictionariesError.message}`);
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-md border border-zinc-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-medium uppercase text-zinc-500">
            Interview Transcriber
          </p>

          {user ? (
            <>
              <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h1 className="text-3xl font-semibold text-zinc-950">
                    音声ファイルをアップロード
                  </h1>
                  <p className="mt-3 max-w-2xl text-zinc-600">
                    アップロード後、queued 状態の文字起こしジョブを作成します。
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

              <div className="mt-5 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                <span className="font-medium">ログイン中 user_id:</span>{" "}
                <span className="break-all font-mono text-xs">{user.id}</span>
              </div>

              <div className="mt-8">
                <UploadForm dictionaries={(dictionaries || []) as Array<{ id: string; name: string }>} />
              </div>

              <div className="mt-8 flex flex-wrap gap-3 border-t border-zinc-200 pt-6">
                <Link
                  href="/jobs"
                  className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
                >
                  プロジェクト一覧を開く
                </Link>
                <Link
                  href="/settings/dictionaries"
                  className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
                >
                  用語辞書を管理
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="mt-3 text-3xl font-semibold text-zinc-950">
                インタビュー文字起こしツール
              </h1>
              <p className="mt-3 max-w-2xl text-zinc-600">
                Googleアカウントでログインしてください。
              </p>

              <div className="mt-8">
                <LoginForm />
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
