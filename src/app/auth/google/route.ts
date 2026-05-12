import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = normalizeNextPath(requestUrl.searchParams.get("next"));
  const redirectUrl = new URL("/auth/callback", requestUrl.origin);

  if (next !== "/") {
    redirectUrl.searchParams.set("next", next);
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUrl.toString(),
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    console.error("[auth google] failed to create OAuth URL", {
      error: error?.message ?? "missing OAuth URL",
    });

    return NextResponse.redirect(
      new URL("/login?error=auth_callback_failed", requestUrl.origin),
    );
  }

  return NextResponse.redirect(data.url);
}

function normalizeNextPath(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }

  return next;
}
