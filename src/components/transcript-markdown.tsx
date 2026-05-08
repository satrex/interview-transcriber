"use client";

import { useActionState, useRef, useState } from "react";
import {
  saveSegmentEdit,
  type SegmentEditActionState,
} from "@/app/actions";
import {
  buildTranscriptBlocks,
  buildTranscriptMarkdown,
  buildTranscriptText,
  formatTimestamp,
  type SegmentEdit,
  type SegmentEditMap,
  type SpeakerNameMap,
  type TranscriptSegment,
} from "@/lib/transcript";

type TranscriptMarkdownProps = {
  audioUrl: string;
  exportBaseName?: string;
  jobId: string;
  segmentEdits?: SegmentEditMap;
  segments: TranscriptSegment[];
  speakerNames?: SpeakerNameMap;
};

export function TranscriptMarkdown({
  audioUrl,
  exportBaseName = "transcript",
  jobId,
  segmentEdits = {},
  segments,
  speakerNames = {},
}: TranscriptMarkdownProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeSegmentRef = useRef<TranscriptSegment | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const effectiveSegments = buildEffectiveSegments(segments, segmentEdits);
  const blocks = buildTranscriptBlocks(effectiveSegments, speakerNames);
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

  async function playSegment(segment: TranscriptSegment) {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (activeSegmentId === segment.id && !audio.paused) {
      audio.pause();
      clearActiveSegment();
      return;
    }

    activeSegmentRef.current = segment;
    setActiveSegmentId(segment.id);
    audio.currentTime = Math.max(0, segment.startSec);

    try {
      await audio.play();
    } catch {
      clearActiveSegment();
    }
  }

  function stopAtSegmentEnd() {
    const audio = audioRef.current;
    const activeSegment = activeSegmentRef.current;

    if (!audio || !activeSegment) {
      return;
    }

    if (audio.currentTime >= activeSegment.endSec) {
      audio.pause();
      audio.currentTime = activeSegment.endSec;
      clearActiveSegment();
    }
  }

  function clearActiveSegment() {
    activeSegmentRef.current = null;
    setActiveSegmentId(null);
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
            transcript編集
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            segment単位で編集できます。原文の transcription_segments は変更しません。
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

      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onTimeUpdate={stopAtSegmentEnd}
        onEnded={clearActiveSegment}
        onPause={clearActiveSegment}
      />

      <div className="mt-6 space-y-3">
        {segments.map((segment) => {
          const edit = segmentEdits[segment.id];

          return (
            <SegmentEditForm
              key={segment.id}
              edit={edit}
              isActive={activeSegmentId === segment.id}
              jobId={jobId}
              onPlay={() => void playSegment(segment)}
              segment={segment}
              speakerName={
                speakerNames[segment.speakerLabel] || segment.speakerLabel
              }
            />
          );
        })}
      </div>

      <div className="mt-8 border-t border-zinc-200 pt-8">
        <h3 className="text-lg font-semibold text-zinc-950">Markdown preview</h3>
        <p className="mt-1 text-sm text-zinc-500">
          skipされたsegmentは出力から省略し、編集済みsegmentはedited_textを使います。
        </p>
      </div>

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

const initialSegmentEditState: SegmentEditActionState = {
  error: null,
  success: false,
};

type SegmentEditFormProps = {
  edit?: SegmentEdit;
  isActive: boolean;
  jobId: string;
  onPlay: () => void;
  segment: TranscriptSegment;
  speakerName: string;
};

function SegmentEditForm({
  edit,
  isActive,
  jobId,
  onPlay,
  segment,
  speakerName,
}: SegmentEditFormProps) {
  const [state, formAction, pending] = useActionState(
    saveSegmentEdit,
    initialSegmentEditState,
  );
  const editedText = edit?.editedText ?? null;
  const isEdited = editedText !== null;
  const isSkipped = edit?.isSkipped || false;
  const effectiveText = editedText ?? segment.text;

  return (
    <form
      action={formAction}
      className={`rounded-md border p-4 transition ${
        isActive
          ? "border-emerald-300 bg-emerald-50"
          : isSkipped
          ? "border-zinc-200 bg-zinc-50 opacity-55"
          : isEdited
            ? "border-sky-200 bg-sky-50"
            : "border-zinc-200 bg-white"
      } ${isActive && isSkipped ? "opacity-60" : ""}`}
    >
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="segmentId" value={segment.id} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <button
              type="button"
              onClick={onPlay}
              className={`inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold transition ${
                isActive
                  ? "bg-emerald-700 text-white hover:bg-emerald-800"
                  : "bg-zinc-950 text-white hover:bg-zinc-800"
              }`}
            >
              {isActive ? "停止" : "再生"}
            </button>
            <span className="font-mono text-xs text-zinc-500">
              [{formatTimestamp(segment.startSec)} - {formatTimestamp(segment.endSec)}]
            </span>
            <span className="font-semibold text-zinc-950">{speakerName}</span>
            {isEdited ? (
              <span className="rounded-md bg-sky-100 px-2 py-1 text-xs font-medium text-sky-800">
                編集済み
              </span>
            ) : null}
            {isSkipped ? (
              <span className="rounded-md bg-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700">
                skip
              </span>
            ) : null}
          </div>
          <p className="mt-1 break-all font-mono text-xs text-zinc-500">
            {segment.speakerLabel}
          </p>
        </div>

        <label className="inline-flex w-fit items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700">
          <input
            type="checkbox"
            key={`skip-${isSkipped ? "on" : "off"}`}
            name="isSkipped"
            defaultChecked={isSkipped}
            className="peer sr-only"
          />
          <span className="relative h-5 w-9 rounded-full bg-zinc-300 transition peer-checked:bg-zinc-950 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
          このセグメントをスキップする
        </label>
      </div>

      <textarea
        name="editedText"
        key={effectiveText}
        defaultValue={effectiveText}
        rows={Math.min(10, Math.max(4, Math.ceil(effectiveText.length / 90)))}
        className="mt-4 w-full rounded-md border border-zinc-300 bg-white p-3 text-sm leading-6 text-zinc-900 shadow-inner outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
      />

      {isEdited ? (
        <details className="mt-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
          <summary className="cursor-pointer font-medium text-zinc-800">
            元の解析テキストを表示
          </summary>
          <p className="mt-2 whitespace-pre-wrap leading-6">{segment.text}</p>
        </details>
      ) : null}

      {state.error ? (
        <p className="mt-3 text-sm text-red-700" aria-live="polite">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="mt-3 text-sm text-emerald-700" aria-live="polite">
          segment編集を保存しました。
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
          className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {pending ? "保存中..." : "保存"}
        </button>
        <button
          type="submit"
          name="intent"
          value="reset"
          disabled={pending || !isEdited}
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400"
        >
          元に戻す
        </button>
      </div>
    </form>
  );
}

function buildEffectiveSegments(
  segments: TranscriptSegment[],
  segmentEdits: SegmentEditMap,
) {
  return segments.flatMap((segment) => {
    const edit = segmentEdits[segment.id];

    if (edit?.isSkipped) {
      return [];
    }

    return [
      {
        ...segment,
        text: edit?.editedText ?? segment.text,
      },
    ];
  });
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
