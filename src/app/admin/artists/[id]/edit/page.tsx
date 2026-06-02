import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArtistEditForm } from "@/components/artist-form";
import { assertCurrentUserIsAdmin } from "@/lib/tips";

type EditArtistPageProps = {
  params: Promise<{
    id: string;
  }>;
};

type ArtistEditRow = {
  display_name: string;
  id: string;
};

export default async function EditArtistPage({ params }: EditArtistPageProps) {
  const { id } = await params;
  const { isAdmin, supabase, user } = await assertCurrentUserIsAdmin();

  if (!user) {
    redirect("/");
  }

  if (!isAdmin) {
    notFound();
  }

  const { data, error } = await supabase
    .from("artists")
    .select("id, display_name")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`artist の取得に失敗しました: ${error.message}`);
  }

  if (!data) {
    notFound();
  }

  const artist = data as ArtistEditRow;

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6">
      <section className="mx-auto w-full max-w-2xl">
        <Link
          href="/admin/artists"
          className="text-sm font-medium text-zinc-500 hover:text-zinc-900"
        >
          ← アーティストマスタ
        </Link>
        <h1 className="mt-3 text-3xl font-semibold">アーティスト編集</h1>
        <p className="mt-2 text-sm text-zinc-600">
          id は変更せず、表示名だけを更新します。
        </p>

        <ArtistEditForm artist={artist} />
      </section>
    </main>
  );
}
