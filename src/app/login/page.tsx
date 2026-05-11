import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, next } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(normalizeNextPath(next));
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-12">
      <section className="rounded-md border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium uppercase text-zinc-500">
          Interview Transcriber
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-zinc-950">
          インタビュー文字起こしツール
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-600">
          Googleアカウントでログインしてください。
        </p>

        <div className="mt-8">
          <LoginForm authError={error ?? null} nextPath={normalizeNextPath(next)} />
        </div>

        <Link
          href="/"
          className="mt-6 inline-block text-sm font-medium text-zinc-600 hover:text-zinc-950"
        >
          トップへ戻る
        </Link>
      </section>
    </main>
  );
}

function normalizeNextPath(next: string | null | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }

  return next;
}
