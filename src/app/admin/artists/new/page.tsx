import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArtistCreateForm } from "@/components/artist-form";
import { assertCurrentUserIsAdmin } from "@/lib/tips";

export default async function NewArtistPage() {
  const { isAdmin, user } = await assertCurrentUserIsAdmin();

  if (!user) {
    redirect("/");
  }

  if (!isAdmin) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6">
      <section className="mx-auto w-full max-w-2xl">
        <Link
          href="/admin/artists"
          className="text-sm font-medium text-zinc-500 hover:text-zinc-900"
        >
          ← アーティストマスタ
        </Link>
        <h1 className="mt-3 text-3xl font-semibold">アーティスト新規登録</h1>
        <p className="mt-2 text-sm text-zinc-600">
          public.artists に、投げ銭紐付け用のアーティストを登録します。
        </p>

        <ArtistCreateForm />
      </section>
    </main>
  );
}
