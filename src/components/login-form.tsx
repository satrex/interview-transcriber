"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type LoginFormProps = {
  authError?: string | null;
  nextPath?: string;
};

export function LoginForm({ authError = null, nextPath = "/" }: LoginFormProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(
    authError ? getAuthErrorMessage(authError) : null,
  );
  const [pending, setPending] = useState(false);

  async function signInWithGoogle() {
    setPending(true);
    setErrorMessage(null);

    try {
      const supabase = createBrowserSupabaseClient();
      const redirectUrl = new URL("/auth/callback", window.location.origin);

      if (nextPath && nextPath !== "/") {
        redirectUrl.searchParams.set("next", nextPath);
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUrl.toString(),
        },
      });

      if (error) {
        setErrorMessage(`Googleログインに失敗しました: ${error.message}`);
        setPending(false);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Googleログインの開始に失敗しました。",
      );
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Google OAuth requires provider setup in Supabase Dashboard and matching redirect URL allowlists in Supabase Auth and Google Cloud Console. */}
      {errorMessage ? (
        <p
          aria-live="polite"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errorMessage}
        </p>
      ) : null}

      <button
        type="button"
        disabled={pending}
        onClick={() => void signInWithGoogle()}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {pending ? "Googleへ移動中..." : "Googleでログイン"}
      </button>
    </div>
  );
}

function getAuthErrorMessage(error: string) {
  if (error === "auth_callback_failed") {
    return "Googleログインの完了に失敗しました。もう一度お試しください。";
  }

  return "ログインに失敗しました。もう一度お試しください。";
}
