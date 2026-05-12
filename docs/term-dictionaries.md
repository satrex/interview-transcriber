# Term dictionaries

Term dictionaries are user-owned lists of frequent words, specialist terms, and
proper nouns. They are designed for Japanese interview transcription where names,
band titles, gear names, places, works, and technical vocabulary are often
misrecognized.

## Purpose

The dictionary is used before transcription as prompt context. It is not a
post-processing replacement system.

When a job is created, the user can select one dictionary. The worker loads that
dictionary and appends enabled entries to the OpenAI transcription prompt. The
model receives the terms as listening hints, while the original
`transcription_segments` rows remain source transcript records.

Do not use term dictionaries to automatically rewrite transcript text after the
fact. Corrections should stay in the human editing layer.

## Prompt limits

The worker includes only enabled entries and caps the prompt hint list at about
50 terms. This keeps the transcription request focused and avoids overly long
prompts that can dilute the strongest hints. Entries are ordered by:

- `sort_order asc`
- `priority asc`
- `term asc`

Use lower `priority` values for important terms. Keep descriptions short; long
descriptions may be truncated or omitted in prompt construction.

## YAML format

Minimal import/export format:

```yaml
name: 音楽インタビュー用語
description: ベース、バンド、機材、固有名詞
terms:
  - term: さとレックス
    reading: さとれっくす
    category: person
    aliases:
      - satrex
      - サトレックス
    priority: 10
    description: インタビュアー名

  - term: EBS MultiComp
    reading: いーびーえす まるちこんぷ
    category: gear
    aliases:
      - マルチコンプ
      - MultiComp
    priority: 10
```

Import creates a new dictionary. Empty `term` entries are ignored. `aliases` can
be a YAML list or a comma-separated string in the supported minimal parser.

Export downloads the current dictionary as YAML with the fields needed for a
future re-import.

## Recommended operation

- Create the dictionary before the interview.
- Prioritize people, band names, venue names, locations, product names, works,
  and music or equipment terms.
- Add common spelling variants and romanized forms as aliases.
- Keep each dictionary focused on the interview or subject area.
- Avoid very long dictionaries. If everything is important, the prompt becomes
  less useful.
- Disable stale terms instead of deleting them when they may be useful later.

## Non-goals

This feature does not add:

- AI automatic correction.
- Automatic translation detection and rewriting.
- Meaning-based reconstruction.
- Full-transcript LLM post-processing.
- Mutation of `transcription_segments` as a cleanup workflow.
