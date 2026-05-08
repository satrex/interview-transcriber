"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveSegmentEdit, type SegmentEditActionState } from "@/app/actions";
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
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [highlightedEditSegmentId, setHighlightedEditSegmentId] = useState<
    string | null
  >(null);
  const [highlightedPreviewSegmentId, setHighlightedPreviewSegmentId] = useState<
    string | null
  >(null);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [unsavedSegments, setUnsavedSegments] = useState<Record<string, boolean>>(
    {},
  );

  const effectiveSegments = buildEffectiveSegments(segments, segmentEdits);
  const blocks = buildTranscriptBlocks(effectiveSegments, speakerNames);
  const markdown = buildTranscriptMarkdown(blocks, { showTimestamps });
  const plainText = buildTranscriptText(blocks, { showTimestamps });
  const safeExportBaseName = buildSafeFileName(exportBaseName);
  const unsavedSegmentCount =
    Object.values(unsavedSegments).filter(Boolean).length;

  useEffect(() => {
    if (unsavedSegmentCount === 0) {
      return;
    }

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    function warnBeforeLinkNavigation(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      const href = target?.getAttribute("href") || "";

      if (!target || href.startsWith("#")) {
        return;
      }

      if (!window.confirm("未保存の変更があります。ページを移動しますか？")) {
        event.preventDefault();
      }
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", warnBeforeLinkNavigation, true);

    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", warnBeforeLinkNavigation, true);
    };
  }, [unsavedSegmentCount]);

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

  function updateSegmentUnsaved(segmentId: string, isUnsaved: boolean) {
    setUnsavedSegments((current) => {
      if (Boolean(current[segmentId]) === isUnsaved) {
        return current;
      }

      const next = { ...current };

      if (isUnsaved) {
        next[segmentId] = true;
      } else {
        delete next[segmentId];
      }

      return next;
    });
  }

  function jumpToSegment(segmentId: string, target: "edit" | "preview") {
    const element = document.getElementById(
      target === "edit"
        ? getSegmentEditDomId(segmentId)
        : getSegmentPreviewDomId(segmentId),
    );

    if (!element) {
      return;
    }

    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }

    setHighlightedEditSegmentId(target === "edit" ? segmentId : null);
    setHighlightedPreviewSegmentId(target === "preview" ? segmentId : null);
    element.scrollIntoView({ behavior: "smooth", block: "center" });

    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedEditSegmentId(null);
      setHighlightedPreviewSegmentId(null);
      highlightTimeoutRef.current = null;
    }, 3000);
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
      {unsavedSegmentCount > 0 ? (
        <div className="mt-4 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <span className="font-semibold">未保存の変更があります。</span>
          <span className="ml-2">
            {unsavedSegmentCount} segmentを保存してください。
          </span>
        </div>
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
              isHighlighted={highlightedEditSegmentId === segment.id}
              jobId={jobId}
              onJumpToPreview={() => jumpToSegment(segment.id, "preview")}
              onPlay={() => void playSegment(segment)}
              onUnsavedChange={updateSegmentUnsaved}
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
        {effectiveSegments.map((segment) => {
          const speakerName =
            speakerNames[segment.speakerLabel] || segment.speakerLabel;
          const isHighlighted = highlightedPreviewSegmentId === segment.id;

          return (
            <article
              key={segment.id}
              id={getSegmentPreviewDomId(segment.id)}
              className={`scroll-mt-6 rounded-md border p-4 transition ${
                isHighlighted
                  ? "border-amber-300 bg-amber-50"
                  : "border-zinc-200 bg-zinc-50"
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 text-sm leading-7 text-zinc-900">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {showTimestamps ? (
                      <span className="font-mono text-xs text-zinc-500">
                        [{formatTimestamp(segment.startSec)}]
                      </span>
                    ) : null}
                    <span className="font-semibold">{speakerName}：</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap">{segment.text}</p>
                </div>
                <button
                  type="button"
                  onClick={() => jumpToSegment(segment.id, "edit")}
                  className="inline-flex min-h-9 w-fit shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
                >
                  編集へ
                </button>
              </div>
            </article>
          );
        })}
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
  isHighlighted: boolean;
  jobId: string;
  onJumpToPreview: () => void;
  onPlay: () => void;
  onUnsavedChange: (segmentId: string, isUnsaved: boolean) => void;
  segment: TranscriptSegment;
  speakerName: string;
};

function SegmentEditForm({
  edit,
  isActive,
  isHighlighted,
  jobId,
  onJumpToPreview,
  onPlay,
  onUnsavedChange,
  segment,
  speakerName,
}: SegmentEditFormProps) {
  const router = useRouter();
  const editedText = edit?.editedText ?? null;
  const isSkipped = edit?.isSkipped || false;
  const effectiveText = editedText ?? segment.text;
  const [actionState, setActionState] = useState(initialSegmentEditState);
  const [pending, setPending] = useState(false);
  const [savedEditedText, setSavedEditedText] = useState<string | null>(
    editedText,
  );
  const [savedSkipped, setSavedSkipped] = useState(isSkipped);
  const [textValue, setTextValue] = useState(effectiveText);
  const [skippedValue, setSkippedValue] = useState(isSkipped);
  const hasSavedEdit = savedEditedText !== null;
  const savedText = savedEditedText ?? segment.text;
  const hasUnsavedChanges =
    textValue !== savedText || skippedValue !== savedSkipped;

  function updateTextValue(nextText: string) {
    setTextValue(nextText);
    onUnsavedChange(
      segment.id,
      nextText !== savedText || skippedValue !== savedSkipped,
    );
  }

  function updateSkippedValue(nextSkipped: boolean) {
    setSkippedValue(nextSkipped);
    onUnsavedChange(
      segment.id,
      textValue !== savedText || nextSkipped !== savedSkipped,
    );
  }

  async function submitSegmentEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nativeEvent = event.nativeEvent as SubmitEvent;
    const submitter = nativeEvent.submitter;
    const formData = new FormData(event.currentTarget);
    const intent =
      submitter instanceof HTMLButtonElement ? submitter.value : "save";

    formData.set("intent", intent);
    setPending(true);

    const result = await saveSegmentEdit(initialSegmentEditState, formData);

    setActionState(result);
    setPending(false);

    if (!result.success) {
      return;
    }

    router.refresh();

    const nextSavedEditedText = result.savedEditedText ?? null;
    const nextSavedSkipped = result.savedIsSkipped ?? skippedValue;
    const nextSavedText = nextSavedEditedText ?? segment.text;

    setSavedEditedText(nextSavedEditedText);
    setTextValue(nextSavedText);
    setSavedSkipped(nextSavedSkipped);
    setSkippedValue(nextSavedSkipped);
    onUnsavedChange(segment.id, false);
  }

  return (
    <form
      id={getSegmentEditDomId(segment.id)}
      onSubmit={(event) => void submitSegmentEdit(event)}
      className={`rounded-md border p-4 transition ${
        hasUnsavedChanges
          ? "border-orange-300 bg-orange-50"
          : isActive
          ? "border-emerald-300 bg-emerald-50"
          : isHighlighted
            ? "border-amber-300 bg-amber-50"
          : skippedValue
          ? "border-zinc-200 bg-zinc-50 opacity-55"
          : "border-zinc-200 bg-white"
      } ${isActive && skippedValue ? "opacity-60" : ""}`}
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
            {!skippedValue ? (
              <button
                type="button"
                onClick={onJumpToPreview}
                className="inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
              >
                プレビューへ
              </button>
            ) : null}
            <span className="font-mono text-xs text-zinc-500">
              [{formatTimestamp(segment.startSec)} - {formatTimestamp(segment.endSec)}]
            </span>
            <span className="font-semibold text-zinc-950">{speakerName}</span>
            {hasSavedEdit ? (
              <span className="rounded-md bg-sky-100 px-2 py-1 text-xs font-medium text-sky-800">
                編集済み
              </span>
            ) : null}
            {hasUnsavedChanges ? (
              <span className="rounded-md bg-orange-100 px-2 py-1 text-xs font-medium text-orange-800">
                未保存
              </span>
            ) : null}
            {skippedValue ? (
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
            name="isSkipped"
            checked={skippedValue}
            onChange={(event) => updateSkippedValue(event.target.checked)}
            className="peer sr-only"
          />
          <span className="relative h-5 w-9 rounded-full bg-zinc-300 transition peer-checked:bg-zinc-950 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
          このセグメントをスキップする
        </label>
      </div>

      <textarea
        name="editedText"
        value={textValue}
        onChange={(event) => updateTextValue(event.target.value)}
        rows={Math.min(10, Math.max(4, Math.ceil(textValue.length / 90)))}
        className="mt-4 w-full rounded-md border border-zinc-300 bg-white p-3 text-sm leading-6 text-zinc-900 shadow-inner outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
      />

      {hasSavedEdit ? (
        <details className="mt-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
          <summary className="cursor-pointer font-medium text-zinc-800">
            元の解析テキストを表示
          </summary>
          <p className="mt-2 whitespace-pre-wrap leading-6">{segment.text}</p>
        </details>
      ) : null}

      {actionState.error ? (
        <p className="mt-3 text-sm text-red-700" aria-live="polite">
          {actionState.error}
        </p>
      ) : null}
      {actionState.success ? (
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
          {pending ? "保存中..." : "変更を保存"}
        </button>
        <button
          type="submit"
          name="intent"
          value="reset"
          disabled={pending || !hasSavedEdit}
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

function getSegmentEditDomId(segmentId: string) {
  return `segment-edit-${segmentId}`;
}

function getSegmentPreviewDomId(segmentId: string) {
  return `segment-preview-${segmentId}`;
}
