# Transcription tuning

This project is tuned for long-form Japanese interviews that are edited by a
human after transcription. The goal is to reduce avoidable transcription drift,
especially accidental English translation, without rewriting or reconstructing
the source transcript after the fact.

## Current API tuning

The worker sets the OpenAI transcription request language explicitly:

```ts
language: "ja"
```

Japanese is the primary expected language for this app. Fixing the language
prevents chunk-level automatic language detection from drifting toward English,
which can otherwise happen when a chunk begins with silence, music, a short
utterance, or an ambiguous phrase.

When the selected transcription model supports prompts, the worker can use this
transcription prompt:

```txt
これは日本語のインタビュー音声です。
翻訳せず、日本語のまま文字起こししてください。
口語、相槌、固有名詞、音楽用語を含みます。
```

The important instruction is that the model should not translate and should keep
the output in Japanese. The extra context reflects the expected source material:
spoken interviews with backchannels, proper nouns, and music-related terms.

Important limitation: diarization transcription models do not support the
`prompt` parameter. For diarized jobs, the worker does not send `prompt` at all,
including term dictionary hints. It keeps supported request parameters such as
`language: "ja"` and `temperature: 0`.

Term dictionary prompt injection is therefore only effective for a future
non-diarized transcription path. For diarized transcription, dictionary support
needs a different design, such as a model-supported glossary mechanism if one
becomes available, or a human editing workflow after the source transcript is
created.

The worker sets:

```ts
temperature: 0
```

This keeps decoding as stable as the API allows and reduces unnecessary
interpretation. It does not guarantee perfect output, but it is a safer default
for editorial source transcripts.

## Chunk boundary risk

The worker currently splits long audio into independent 600 second chunks. This
is durable and simple, but chunk starts are more likely to lack context. A chunk
that starts mid-sentence, after silence, or during music can be more vulnerable
to language or content drift than the middle of a chunk.

A possible future improvement is a small overlap between chunks, such as adding
the previous 2 to 3 seconds of audio to the beginning of the next chunk. That
would give the transcription model a little more context at boundaries.

Do not add overlap without also designing duplicate handling. Overlap can create
duplicate segments near boundaries, and this project treats
`transcription_segments` as source transcript records. Any overlap design should:

- Keep canonical segment timestamps based on the original audio.
- Avoid inserting duplicated boundary segments.
- Preserve diarization labels returned for each accepted segment.
- Keep chunk progress and retry behavior simple.
- Avoid mutating existing `transcription_segments` as an automatic correction
  workflow.

For now, overlap is a design note only. The current implementation keeps the
existing chunk and segment structure unchanged.

## Recommended audio format

The worker normalizes chunks for transcription as mono 16 kHz PCM WAV before
sending them to OpenAI. For source uploads or browser-side compression, prefer:

- Mono audio.
- 16 kHz sample rate or higher.
- AAC/M4A at about 48 to 64 kbps when compressing speech before upload.
- Avoid very low bitrates for important interviews when storage and upload time
  allow.

The current browser compression path may produce 16 kHz / 32 kbps M4A. That is
small and practical for long recordings, but 48 to 64 kbps can preserve more
consonant detail and may reduce recognition and language-identification errors.

## What this does not do

This tuning cannot completely prevent mistakes. The model may still mistranscribe
proper nouns, code-switching, unclear speech, music, overlapping speakers, or
low-quality audio.

The app should remain an editorial tool, not an automatic rewrite system. Do not
add these as part of transcription tuning:

- AI automatic correction.
- Automatic translation detection and rewriting.
- Meaning-based transcript reconstruction.
- Post-processing LLM rewrites over the full transcript.
- Mutation of `transcription_segments` as a cleanup step.

The preferred workflow is to produce a better Japanese source transcript, keep
the original segment records intact, and let a human editor make final decisions.
