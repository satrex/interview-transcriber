import { assertCurrentUserIsAdmin } from "@/lib/tips";

export async function GET(request: Request) {
  const { isAdmin, supabase, user } = await assertCurrentUserIsAdmin();

  if (!user || !isAdmin) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim() || "";
  const requestBuilder = supabase
    .from("artists")
    .select("id, display_name")
    .order("display_name", { ascending: true })
    .limit(20);
  const { data, error } = query
    ? await requestBuilder.ilike("display_name", `%${query}%`)
    : await requestBuilder;

  if (error) {
    return Response.json(
      { error: "artists_fetch_failed", message: error.message },
      { status: 500 },
    );
  }

  return Response.json({ artists: data || [] });
}
