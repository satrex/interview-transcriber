import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serializeDictionaryToYaml } from "@/lib/term-dictionaries";
import type {
  TermDictionaryEntry,
  TermDictionarySummary,
} from "@/lib/term-dictionaries";

export async function GET(
  _request: Request,
  context: { params: Promise<{ dictionaryId: string }> },
) {
  const { dictionaryId } = await context.params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: dictionary, error: dictionaryError } = await supabase
    .from("term_dictionaries")
    .select("id, name, description, created_at, updated_at")
    .eq("id", dictionaryId)
    .eq("user_id", user.id)
    .single();

  if (dictionaryError || !dictionary) {
    return NextResponse.json({ error: "Dictionary not found." }, { status: 404 });
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
    return NextResponse.json(
      { error: `Failed to load entries: ${entriesError.message}` },
      { status: 500 },
    );
  }

  const yaml = serializeDictionaryToYaml({
    description: (dictionary as TermDictionarySummary).description,
    entries: (entries || []) as TermDictionaryEntry[],
    name: (dictionary as TermDictionarySummary).name,
  });
  const filename = `${sanitizeFilename((dictionary as TermDictionarySummary).name)}.yaml`;

  return new NextResponse(yaml, {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/yaml; charset=utf-8",
    },
  });
}

function sanitizeFilename(value: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "term-dictionary";
}
