import Link from "next/link";
import { createTermDictionary, importTermDictionaryYaml } from "@/app/actions";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { TermDictionarySummary } from "@/lib/term-dictionaries";

export default async function DictionariesPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const params = await searchParams;

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-md border border-zinc-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-zinc-950">ログインが必要です</h1>
          <Link className="mt-6 inline-block text-sm font-medium text-zinc-950" href="/">
            ログイン画面へ戻る
          </Link>
        </section>
      </main>
    );
  }

  const { data, error } = await supabase
    .from("term_dictionaries")
    .select("id, name, description, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load term dictionaries: ${error.message}`);
  }

  const dictionaries = (data || []) as TermDictionarySummary[];

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12">
      <Link className="text-sm font-medium text-zinc-600 hover:text-zinc-950" href="/">
        ← アップロード画面へ戻る
      </Link>

      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase text-zinc-500">
            Interview Transcriber
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-zinc-950">
            用語辞書
          </h1>
          <p className="mt-3 max-w-2xl text-zinc-600">
            固有名詞、専門用語、頻出単語を登録し、文字起こし前のpromptヒントとして使います。
          </p>
        </div>
        <Link
          href="/jobs"
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
        >
          プロジェクト一覧
        </Link>
      </div>

      {params?.error ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {decodeURIComponent(params.error)}
        </p>
      ) : null}

      <section className="mt-8 rounded-md border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-950">新規作成</h2>
        <form action={createTermDictionary} className="mt-4 grid gap-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <label className="block text-sm font-medium text-zinc-800">
            辞書名
            <input
              name="name"
              required
              className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
            />
          </label>
          <label className="block text-sm font-medium text-zinc-800">
            説明
            <input
              name="description"
              className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
          >
            作成
          </button>
        </form>
      </section>

      <section className="mt-8 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-950">辞書一覧</h2>
        </div>
        {dictionaries.length === 0 ? (
          <p className="p-6 text-sm text-zinc-600">
            まだ辞書がありません。取材前によく出る人名、作品名、機材名から登録してください。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">辞書名</th>
                  <th className="px-4 py-3 font-semibold">説明</th>
                  <th className="px-4 py-3 font-semibold">更新日時</th>
                  <th className="px-4 py-3 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {dictionaries.map((dictionary) => (
                  <tr key={dictionary.id}>
                    <td className="px-4 py-3 font-medium text-zinc-950">
                      {dictionary.name}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {dictionary.description || "なし"}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {formatDateTime(dictionary.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/settings/dictionaries/${dictionary.id}`}
                        className="inline-flex min-h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-900 hover:bg-zinc-50"
                      >
                        編集
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8 rounded-md border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-950">YAML import</h2>
        <form action={importTermDictionaryYaml} className="mt-4 space-y-4">
          <input
            name="yamlFile"
            type="file"
            accept=".yaml,.yml,text/yaml,text/plain"
            className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
          />
          <textarea
            name="yaml"
            rows={10}
            placeholder={"name: 音楽インタビュー用語\nterms:\n  - term: さとレックス\n    reading: さとれっくす\n    aliases:\n      - satrex\n    priority: 10"}
            className="block w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm text-zinc-900"
          />
          <button
            type="submit"
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
          >
            新規辞書として取り込む
          </button>
        </form>
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
