"use client";

import { useState } from "react";
import {
  buildTranscriptBlocks,
  buildTranscriptMarkdown,
  formatTimestamp,
  type SpeakerNameMap,
  type TranscriptSegment,
} from "@/lib/transcript";

type TranscriptMarkdownProps = {
  segments: TranscriptSegment[];
  speakerNames?: SpeakerNameMap;
};

export function TranscriptMarkdown({
  segments,
  speakerNames = {},
}: TranscriptMarkdownProps) {
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const blocks = buildTranscriptBlocks(segments, speakerNames);
  const markdown = buildTranscriptMarkdown(blocks, { showTimestamps });

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  if (segments.length === 0) {
    return (
      <div className="mt-8 rounded-md bg-zinc-50 p-4 text-sm text-zinc-600">
        文字起こし segment はまだ保存されていません。
      </div>
    );
  }

  return (
    <section className="mt-8 border-t border-zinc-200 pt-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-950">
            編集用 Markdown
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            連続する同一話者の発話は結合して表示しています。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={showTimestamps}
              onChange={(event) => setShowTimestamps(event.target.checked)}
              className="size-4 rounded border-zinc-300"
            />
            タイムスタンプ
          </label>
          <button
            type="button"
            onClick={copyMarkdown}
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
          >
            Markdownをコピー
          </button>
        </div>
      </div>

      {copyStatus === "copied" ? (
        <p className="mt-3 text-sm text-emerald-700" aria-live="polite">
          コピーしました。
        </p>
      ) : null}
      {copyStatus === "failed" ? (
        <p className="mt-3 text-sm text-red-700" aria-live="polite">
          コピーに失敗しました。
        </p>
      ) : null}

      <div className="mt-6 space-y-4">
        {blocks.map((block) => (
          <article
            key={`${block.speakerLabel}-${block.startSec}-${block.endSec}`}
            className="rounded-md border border-zinc-200 bg-zinc-50 p-4"
          >
            <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-900">
              {showTimestamps ? (
                <span className="mr-2 font-mono text-xs text-zinc-500">
                  [{formatTimestamp(block.startSec)}]
                </span>
              ) : null}
              <span className="font-semibold">{block.speakerName}：</span>
              {block.text}
            </p>
          </article>
        ))}
      </div>

      <textarea
        readOnly
        value={markdown}
        className="mt-6 min-h-64 w-full rounded-md border border-zinc-200 bg-white p-4 font-mono text-sm leading-6 text-zinc-800"
        aria-label="Markdown preview"
      />
    </section>
  );
}
