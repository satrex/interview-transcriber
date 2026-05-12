import Link from "next/link";
import {
  deleteTermDictionary,
  deleteTermDictionaryEntry,
  moveTermDictionaryEntry,
} from "@/app/actions";
import {
  TermDictionaryEntryCreateForm,
  TermDictionaryEntryEditForm,
  TermDictionaryMetadataForm,
} from "@/components/term-dictionary-forms";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  TermDictionaryEntry,
  TermDictionarySummary,
} from "@/lib/term-dictionaries";

export default async function DictionaryDetailPage({
  params,
}: {
  params: Promise<{ dictionaryId: string }>;
}) {
  const { dictionaryId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  const { data: dictionary, error: dictionaryError } = await supabase
    .from("term_dictionaries")
    .select("id, name, description, created_at, updated_at")
    .eq("id", dictionaryId)
    .eq("user_id", user.id)
    .single();

  if (dictionaryError || !dictionary) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12">
        <Link className="text-sm font-medium text-zinc-600 hover:text-zinc-950" href="/settings/dictionaries">
          ← 用語辞書へ戻る
        </Link>
        <section className="mt-8 rounded-md border border-zinc-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-zinc-950">
            辞書が見つかりません
          </h1>
        </section>
      </main>
    );
  }

  const { data: entries, error: entriesError } = await supabase
    .from("term_dictionary_entries")
    .select(
      "id, dictionary_id, term, reading, category, description, aliases, priority, sort_order, is_enabled, created_at, updated_at",
    )
    .eq("dictionary_id", dictionaryId)
    .order("sort_order", { ascending: true })
    .order("priority", { ascending: true })
    .order("term", { ascending: true });

  if (entriesError) {
    throw new Error(`Failed to load term dictionary entries: ${entriesError.message}`);
  }

  const typedDictionary = dictionary as TermDictionarySummary;
  const typedEntries = (entries || []) as TermDictionaryEntry[];

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-6 py-12">
      <Link className="text-sm font-medium text-zinc-600 hover:text-zinc-950" href="/settings/dictionaries">
        ← 用語辞書へ戻る
      </Link>

      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase text-zinc-500">
            Term dictionary
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-zinc-950">
            {typedDictionary.name}
          </h1>
          <p className="mt-3 max-w-2xl text-zinc-600">
            有効な上位用語だけがworkerのtranscription promptへヒントとして入ります。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/settings/dictionaries/${typedDictionary.id}/export`}
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
          >
            YAML export
          </a>
          <form action={deleteTermDictionary}>
            <input type="hidden" name="dictionaryId" value={typedDictionary.id} />
            <button
              type="submit"
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50"
            >
              削除
            </button>
          </form>
        </div>
      </div>

      <section className="mt-8 rounded-md border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-950">辞書情報</h2>
        <div className="mt-4">
          <TermDictionaryMetadataForm dictionary={typedDictionary} />
        </div>
      </section>

      <section className="mt-8 rounded-md border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-950">用語を追加</h2>
        <div className="mt-4">
          <TermDictionaryEntryCreateForm dictionaryId={typedDictionary.id} />
        </div>
      </section>

      <section className="mt-8 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-950">用語一覧</h2>
          <p className="mt-1 text-sm text-zinc-600">
            表示順は上下ボタンまたは sort_order で保存できます。priority は小さいほどprompt内で優先されます。
          </p>
        </div>
        {typedEntries.length === 0 ? (
          <p className="p-6 text-sm text-zinc-600">まだ用語がありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-3 font-semibold">☰</th>
                  <th className="px-3 py-3 font-semibold">用語</th>
                  <th className="px-3 py-3 font-semibold">読み</th>
                  <th className="px-3 py-3 font-semibold">種別</th>
                  <th className="px-3 py-3 font-semibold">表記ゆれ / 説明</th>
                  <th className="px-3 py-3 font-semibold">優先度 / 順序</th>
                  <th className="px-3 py-3 font-semibold">有効</th>
                  <th className="px-3 py-3 font-semibold">操作</th>
                  <th className="px-3 py-3 font-semibold">並び</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {typedEntries.map((entry, index) => (
                  <RowWithActions
                    key={entry.id}
                    entry={entry}
                    isFirst={index === 0}
                    isLast={index === typedEntries.length - 1}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function RowWithActions({
  entry,
  isFirst,
  isLast,
}: {
  entry: TermDictionaryEntry;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <>
      <TermDictionaryEntryEditForm entry={entry} />
      <tr className="border-t border-zinc-100 bg-zinc-50/60">
        <td colSpan={8} className="px-3 py-2 text-xs text-zinc-500">
          ID: <span className="font-mono">{entry.id}</span>
        </td>
        <td className="px-3 py-2">
          <div className="flex gap-2">
            <form action={moveTermDictionaryEntry}>
              <input type="hidden" name="dictionaryId" value={entry.dictionary_id} />
              <input type="hidden" name="entryId" value={entry.id} />
              <input type="hidden" name="direction" value="up" />
              <button
                type="submit"
                disabled={isFirst}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
              >
                ↑
              </button>
            </form>
            <form action={moveTermDictionaryEntry}>
              <input type="hidden" name="dictionaryId" value={entry.dictionary_id} />
              <input type="hidden" name="entryId" value={entry.id} />
              <input type="hidden" name="direction" value="down" />
              <button
                type="submit"
                disabled={isLast}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
              >
                ↓
              </button>
            </form>
            <form action={deleteTermDictionaryEntry}>
              <input type="hidden" name="dictionaryId" value={entry.dictionary_id} />
              <input type="hidden" name="entryId" value={entry.id} />
              <button
                type="submit"
                className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                削除
              </button>
            </form>
          </div>
        </td>
      </tr>
    </>
  );
}
