type LoginFormProps = {
  authError?: string | null;
  nextPath?: string;
};

export function LoginForm({ authError = null, nextPath = "/" }: LoginFormProps) {
  const googleLoginHref =
    nextPath && nextPath !== "/"
      ? `/auth/google?next=${encodeURIComponent(nextPath)}`
      : "/auth/google";
  const errorMessage = authError ? getAuthErrorMessage(authError) : null;

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

      <a
        href={googleLoginHref}
        className="relative z-10 inline-flex min-h-11 w-full touch-manipulation items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2"
      >
        Googleでログイン
      </a>
    </div>
  );
}

function getAuthErrorMessage(error: string) {
  if (error === "auth_callback_failed") {
    return "Googleログインの完了に失敗しました。もう一度お試しください。";
  }

  return "ログインに失敗しました。もう一度お試しください。";
}
