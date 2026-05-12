import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptionJob } from "./supabase.js";

const MAX_PROMPT_TERMS = 50;
const MAX_DESCRIPTION_CHARS = 80;

type TermDictionaryEntryRow = {
  term: string;
  reading: string | null;
  category: string | null;
  description: string | null;
  aliases: string[] | null;
  priority: number;
  sort_order: number;
};

export async function loadTermDictionaryPrompt(
  supabase: SupabaseClient,
  job: TranscriptionJob,
) {
  if (!job.term_dictionary_id) {
    return null;
  }

  try {
    const { data: dictionary, error: dictionaryError } = await supabase
      .from("term_dictionaries")
      .select("id, name")
      .eq("id", job.term_dictionary_id)
      .eq("user_id", job.user_id)
      .maybeSingle();

    if (dictionaryError) {
      throw new Error(dictionaryError.message);
    }

    if (!dictionary) {
      console.warn(
        `[worker] term dictionary ${job.term_dictionary_id} for job ${job.id} was not found or does not belong to the job owner; continuing without dictionary hints`,
      );
      return null;
    }

    const { data: entries, error: entriesError } = await supabase
      .from("term_dictionary_entries")
      .select("term, reading, category, description, aliases, priority, sort_order")
      .eq("dictionary_id", job.term_dictionary_id)
      .eq("is_enabled", true)
      .order("sort_order", { ascending: true })
      .order("priority", { ascending: true })
      .order("term", { ascending: true })
      .limit(MAX_PROMPT_TERMS);

    if (entriesError) {
      throw new Error(entriesError.message);
    }

    const prompt = buildTermDictionaryPrompt((entries || []) as TermDictionaryEntryRow[]);

    if (!prompt) {
      return null;
    }

    console.log(
      `[worker] loaded ${(entries || []).length} term dictionary hint(s) for job ${job.id}`,
    );
    return prompt;
  } catch (error) {
    console.warn(
      `[worker] failed to load term dictionary ${job.term_dictionary_id} for job ${job.id}; continuing without dictionary hints. ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function buildTermDictionaryPrompt(entries: TermDictionaryEntryRow[]) {
  const lines = entries
    .map(formatPromptEntry)
    .filter((line): line is string => Boolean(line));

  if (lines.length === 0) {
    return null;
  }

  return [
    "以下の用語が頻出します。聞き取り時の参考にしてください。",
    ...lines,
  ].join("\n");
}

function formatPromptEntry(entry: TermDictionaryEntryRow) {
  const term = entry.term.trim();

  if (!term) {
    return null;
  }

  const notes = [
    entry.category?.trim(),
    entry.reading?.trim() ? `読み: ${entry.reading.trim()}` : "",
    entry.aliases && entry.aliases.length > 0
      ? `表記ゆれ: ${entry.aliases.map((alias) => alias.trim()).filter(Boolean).join(", ")}`
      : "",
    entry.description?.trim()
      ? truncateDescription(entry.description.trim())
      : "",
  ].filter(Boolean);

  return notes.length > 0 ? `- ${term}（${notes.join("、")}）` : `- ${term}`;
}

function truncateDescription(value: string) {
  if (value.length <= MAX_DESCRIPTION_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_DESCRIPTION_CHARS)}...`;
}
