import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { assertCurrentUserIsAdmin } from "@/lib/tips";

type AdminArtistsPageProps = {
  searchParams: Promise<{
    query?: string;
  }>;
};

type ArtistRow = {
  created_at: string;
  display_name: string;
  id: string;
  updated_at: string;
};

export default async function AdminArtistsPage({
  searchParams,
}: AdminArtistsPageProps) {
  const { query } = await searchParams;
  const searchQuery = query?.trim() || "";
  const { isAdmin, supabase, user } = await assertCurrentUserIsAdmin();

  if (!user) {
    redirect("/");
  }

  if (!isAdmin) {
    notFound();
  }

  const request = supabase
    .from("artists")
    .select("id, display_name, created_at, updated_at")
    .order("display_name", { ascending: true })
    .limit(100);

  const { data, error } = searchQuery
    ? await request.ilike("display_name", `%${searchQuery}%`)
    : await request;

  if (error) {
    throw new Error(`artists の取得に失敗しました: ${error.message}`);
  }

  const artists = (data || []) as ArtistRow[];

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6">
      <section className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="text-sm font-medium text-zinc-500 hover:text-zinc-900">
              ← ホーム
            </Link>
            <h1 className="mt-3 text-3xl font-semibold">アーティストマスタ</h1>
            <p className="mt-2 text-sm text-zinc-600">
              投げ銭の紐付けに使う public.artists を登録・編集します。
            </p>
          </div>
          <Link
            href="/admin/artists/new"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            新規登録
          </Link>
        </div>

        <div className="mt-6 flex flex-col gap-3 rounded-md border border-zinc-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <form className="flex flex-col gap-2 sm:flex-row sm:items-center" action="/admin/artists">
            <label className="text-sm font-medium text-zinc-700" htmlFor="query">
              display_name
            </label>
            <input
              id="query"
              name="query"
              defaultValue={searchQuery}
              className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
              placeholder="アーティスト名で検索"
            />
            <button className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold hover:bg-zinc-50">
              検索
            </button>
          </form>
          <Link
            href="/admin/tips"
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold hover:bg-zinc-50"
          >
            投げ銭管理へ
          </Link>
        </div>

        <div className="mt-6 overflow-x-auto rounded-md border border-zinc-200 bg-white">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">display_name</th>
                <th className="px-3 py-2 font-medium">id</th>
                <th className="px-3 py-2 font-medium">created_at</th>
                <th className="px-3 py-2 font-medium">updated_at</th>
                <th className="px-3 py-2 font-medium">編集</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {artists.map((artist) => (
                <tr key={artist.id}>
                  <td className="px-3 py-2 font-semibold">{artist.display_name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{artist.id}</td>
                  <td className="px-3 py-2 text-xs text-zinc-600">
                    {new Date(artist.created_at).toLocaleString("ja-JP")}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-600">
                    {new Date(artist.updated_at).toLocaleString("ja-JP")}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/artists/${encodeURIComponent(artist.id)}/edit`}
                      className="inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold hover:bg-zinc-50"
                    >
                      編集
                    </Link>
                  </td>
                </tr>
              ))}
              {artists.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-zinc-500" colSpan={5}>
                    アーティストが未登録です。新規登録から追加してください。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
