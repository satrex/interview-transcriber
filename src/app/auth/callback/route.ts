import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = normalizeNextPath(requestUrl.searchParams.get("next"));

  // Supabase Google OAuth setup notes:
  // - Enable Google Provider in Supabase Dashboard and set its Client ID / Client Secret.
  // - Add Supabase's provider callback URL to Google Cloud Console Authorized redirect URIs.
  // - Add localhost and production app URLs to Supabase Auth Redirect URLs when using redirectTo.
  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, requestUrl.origin));
    }

    console.error("[auth callback] exchangeCodeForSession failed", {
      error: error.message,
    });
  }

  return NextResponse.redirect(
    new URL("/login?error=auth_callback_failed", requestUrl.origin),
  );
}

function normalizeNextPath(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }

  return next;
}
