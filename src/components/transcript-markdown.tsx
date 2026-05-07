"use client";

import { useState } from "react";
import {
  buildTranscriptBlocks,
  buildTranscriptMarkdown,
  buildTranscriptText,
  formatTimestamp,
  type SpeakerNameMap,
  type TranscriptSegment,
} from "@/lib/transcript";

type TranscriptMarkdownProps = {
  exportBaseName?: string;
  segments: TranscriptSegment[];
  speakerNames?: SpeakerNameMap;
};

export function TranscriptMarkdown({
  exportBaseName = "transcript",
  segments,
  speakerNames = {},
}: TranscriptMarkdownProps) {
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const blocks = buildTranscriptBlocks(segments, speakerNames);
  const markdown = buildTranscriptMarkdown(blocks, { showTimestamps });
  const plainText = buildTranscriptText(blocks, { showTimestamps });
  const safeExportBaseName = buildSafeFileName(exportBaseName);

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  function downloadMarkdown() {
    downloadTextFile(`${safeExportBaseName}.md`, markdown, "text/markdown");
  }

  function downloadPlainText() {
    downloadTextFile(`${safeExportBaseName}.txt`, plainText, "text/plain");
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
            同一話者の連続発言を結合し、長い発言は段落分けしています。
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
          <button
            type="button"
            onClick={downloadMarkdown}
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
          >
            .md保存
          </button>
          <button
            type="button"
            onClick={downloadPlainText}
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
          >
            .txt保存
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
            <div className="text-sm leading-7 text-zinc-900">
              {showTimestamps ? (
                <span className="mr-2 font-mono text-xs text-zinc-500">
                  [{formatTimestamp(block.startSec)}]
                </span>
              ) : null}
              <span className="font-semibold">{block.speakerName}：</span>
              <div className="mt-2 space-y-3">
                {block.paragraphs.map((paragraph, index) => (
                  <p key={`${block.speakerLabel}-${block.startSec}-${index}`}>
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
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

function downloadTextFile(fileName: string, text: string, type: string) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function buildSafeFileName(fileName: string) {
  const baseName = fileName.replace(/\.[^/.]+$/, "");
  return baseName.replace(/[\\/:*?"<>|]+/g, "_").trim() || "transcript";
}
