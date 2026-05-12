export type TermDictionarySummary = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type TermDictionaryEntry = {
  id: string;
  dictionary_id: string;
  term: string;
  reading: string | null;
  category: string | null;
  description: string | null;
  aliases: string[];
  priority: number;
  sort_order: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type ParsedYamlDictionary = {
  name: string;
  description: string | null;
  terms: Array<{
    term: string;
    reading: string | null;
    category: string | null;
    aliases: string[];
    priority: number;
    description: string | null;
  }>;
};

export function parseAliases(value: string) {
  return value
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean);
}

export function normalizePriority(value: string, fallback = 100) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function serializeDictionaryToYaml(options: {
  name: string;
  description: string | null;
  entries: TermDictionaryEntry[];
}) {
  const lines = [
    `name: ${quoteYamlString(options.name)}`,
    `description: ${quoteYamlString(options.description || "")}`,
    "terms:",
  ];

  for (const entry of options.entries) {
    lines.push(`  - term: ${quoteYamlString(entry.term)}`);

    if (entry.reading) {
      lines.push(`    reading: ${quoteYamlString(entry.reading)}`);
    }

    if (entry.category) {
      lines.push(`    category: ${quoteYamlString(entry.category)}`);
    }

    if (entry.aliases.length > 0) {
      lines.push("    aliases:");
      for (const alias of entry.aliases) {
        lines.push(`      - ${quoteYamlString(alias)}`);
      }
    }

    lines.push(`    priority: ${entry.priority}`);

    if (entry.description) {
      lines.push(`    description: ${quoteYamlString(entry.description)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function parseDictionaryYaml(input: string): ParsedYamlDictionary {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  let name = "";
  let description: string | null = null;
  const terms: ParsedYamlDictionary["terms"] = [];
  let current: ParsedYamlDictionary["terms"][number] | null = null;
  let aliasMode = false;

  for (const rawLine of lines) {
    const line = stripYamlComment(rawLine);

    if (!line.trim()) {
      continue;
    }

    if (!line.startsWith(" ")) {
      aliasMode = false;
      const [key, rawValue] = splitYamlPair(line);

      if (key === "name") {
        name = parseYamlScalar(rawValue);
      } else if (key === "description") {
        description = parseNullableScalar(rawValue);
      }

      continue;
    }

    const trimmed = line.trim();

    if (trimmed.startsWith("- ")) {
      aliasMode = false;
      const remainder = trimmed.slice(2).trim();
      const [key, rawValue] = splitYamlPair(remainder);

      if (key !== "term") {
        continue;
      }

      current = {
        aliases: [],
        category: null,
        description: null,
        priority: 100,
        reading: null,
        term: parseYamlScalar(rawValue),
      };
      terms.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    if (aliasMode && trimmed.startsWith("- ")) {
      const alias = parseYamlScalar(trimmed.slice(2));

      if (alias) {
        current.aliases.push(alias);
      }

      continue;
    }

    const [key, rawValue] = splitYamlPair(trimmed);

    if (key === "reading") {
      current.reading = parseNullableScalar(rawValue);
    } else if (key === "category") {
      current.category = parseNullableScalar(rawValue);
    } else if (key === "description") {
      current.description = parseNullableScalar(rawValue);
    } else if (key === "priority") {
      current.priority = normalizePriority(parseYamlScalar(rawValue), 100);
    } else if (key === "aliases") {
      const value = parseYamlScalar(rawValue);
      aliasMode = value.length === 0;
      current.aliases = value ? parseAliases(value) : current.aliases;
    }
  }

  const validTerms = terms.filter((term) => term.term.trim().length > 0);

  if (!name.trim()) {
    throw new Error("YAMLの name が空です。");
  }

  if (validTerms.length === 0) {
    throw new Error("YAMLに有効な terms がありません。");
  }

  return {
    description,
    name: name.trim(),
    terms: validTerms.map((term) => ({
      ...term,
      aliases: [...new Set(term.aliases.map((alias) => alias.trim()).filter(Boolean))],
      term: term.term.trim(),
    })),
  };
}

function quoteYamlString(value: string) {
  return JSON.stringify(value);
}

function stripYamlComment(line: string) {
  const trimmedStart = line.trimStart();

  if (trimmedStart.startsWith("#")) {
    return "";
  }

  return line;
}

function splitYamlPair(line: string): [string, string] {
  const index = line.indexOf(":");

  if (index === -1) {
    return [line.trim(), ""];
  }

  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}

function parseNullableScalar(value: string) {
  const parsed = parseYamlScalar(value).trim();
  return parsed ? parsed : null;
}

function parseYamlScalar(value: string) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}
