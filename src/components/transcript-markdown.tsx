"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveSegmentEdit,
  saveSegmentSkip,
  type SegmentEditActionState,
  type SegmentSkipActionState,
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
import { useSegmentAudioPlayback } from "./use-segment-audio-playback";

type TranscriptMarkdownProps = {
  audioChunkDurationSec?: number | null;
  audioLoadError?: string | null;
  audioUrl: string | null;
  exportBaseName?: string;
  jobId: string;
  segmentEdits?: SegmentEditMap;
  segments: TranscriptSegment[];
  speakerNames?: SpeakerNameMap;
};

export function TranscriptMarkdown({
  audioChunkDurationSec = null,
  audioLoadError = null,
  audioUrl,
  exportBaseName = "transcript",
  jobId,
  segmentEdits = {},
  segments,
  speakerNames = {},
}: TranscriptMarkdownProps) {
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUnsavedJumpIndexRef = useRef(-1);
  const {
    audioErrorMessage,
    audioRef,
    clearActiveSegment,
    handleAudioError,
    handleAudioPause,
    playSegment,
    playbackState,
    setAudioErrorMessage,
    stopAtSegmentEnd,
  } = useSegmentAudioPlayback(audioUrl, {
    chunkDurationSec: audioChunkDurationSec,
    initialAudioError: audioLoadError,
    jobId,
  });
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
  const [effectiveSegmentEditMap, setEffectiveSegmentEditMap] =
    useState<SegmentEditMap>(segmentEdits);

  const effectiveSegments = useMemo(
    () => buildEffectiveSegments(segments, effectiveSegmentEditMap),
    [effectiveSegmentEditMap, segments],
  );
  const blocks = useMemo(
    () => buildTranscriptBlocks(effectiveSegments, speakerNames),
    [effectiveSegments, speakerNames],
  );
  const previewBlocks = useMemo(
    () => buildPreviewBlocks(effectiveSegments, speakerNames),
    [effectiveSegments, speakerNames],
  );
  const markdown = useMemo(
    () => buildTranscriptMarkdown(blocks, { showTimestamps }),
    [blocks, showTimestamps],
  );
  const plainText = useMemo(
    () => buildTranscriptText(blocks, { showTimestamps }),
    [blocks, showTimestamps],
  );
  const safeExportBaseName = buildSafeFileName(exportBaseName);
  const unsavedSegmentIds = useMemo(
    () =>
      Object.keys(unsavedSegments).filter(
        (segmentId) => unsavedSegments[segmentId],
      ),
    [unsavedSegments],
  );
  const unsavedSegmentCount = unsavedSegmentIds.length;
  const speakerLabels = useMemo(
    () =>
      buildSpeakerLabelOptions(segments, speakerNames, effectiveSegmentEditMap),
    [effectiveSegmentEditMap, segments, speakerNames],
  );

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

  function updateLocalSegmentEdit(
    segmentId: string,
    updater: (current: SegmentEdit | undefined) => SegmentEdit,
  ) {
    setEffectiveSegmentEditMap((current) => ({
      ...current,
      [segmentId]: updater(current[segmentId]),
    }));
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

  function jumpToUnsavedSegment(segmentId?: string) {
    const targetSegmentId = segmentId || unsavedSegmentIds[0];

    if (targetSegmentId) {
      lastUnsavedJumpIndexRef.current =
        unsavedSegmentIds.indexOf(targetSegmentId);
      jumpToSegment(targetSegmentId, "edit");
    }
  }

  function jumpToNextUnsavedSegment() {
    if (unsavedSegmentIds.length === 0) {
      return;
    }

    const currentIndex = lastUnsavedJumpIndexRef.current;
    const nextIndex = (currentIndex + 1) % unsavedSegmentIds.length;

    jumpToUnsavedSegment(unsavedSegmentIds[nextIndex]);
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
        <div className="sticky top-0 z-20 mt-4 rounded-md border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-950 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => jumpToUnsavedSegment()}
              className="text-left font-semibold underline decoration-orange-300 underline-offset-4 transition hover:decoration-orange-700"
            >
              未保存の編集が{unsavedSegmentCount}件あります
            </button>
            <button
              type="button"
              onClick={jumpToNextUnsavedSegment}
              className="inline-flex min-h-9 w-fit items-center justify-center rounded-md border border-orange-300 bg-white px-3 text-sm font-semibold text-orange-950 transition hover:bg-orange-100"
            >
              次の未保存へ
            </button>
          </div>
        </div>
      ) : null}

      <audio
        ref={audioRef}
        preload="none"
        onError={handleAudioError}
        onLoadedMetadata={() => setAudioErrorMessage(null)}
        onTimeUpdate={stopAtSegmentEnd}
        onEnded={clearActiveSegment}
        onPause={handleAudioPause}
      />

      {audioErrorMessage ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {audioErrorMessage}
        </p>
      ) : null}

      <div className="mt-6 space-y-3">
        {segments.map((segment) => {
          const edit = effectiveSegmentEditMap[segment.id];

          return (
            <SegmentEditForm
              key={segment.id}
              edit={edit}
              playbackStatus={
                playbackState?.segmentId === segment.id
                  ? playbackState.status
                  : null
              }
              isHighlighted={highlightedEditSegmentId === segment.id}
              jobId={jobId}
              onJumpToPreview={() => jumpToSegment(segment.id, "preview")}
              onLocalEditChange={(updater) =>
                updateLocalSegmentEdit(segment.id, updater)
              }
              onPlay={() => void playSegment(segment)}
              onUnsavedChange={updateSegmentUnsaved}
              segment={segment}
              speakerLabels={speakerLabels}
              speakerNames={speakerNames}
            />
          );
        })}
      </div>

      <div
        id="transcript-overall-preview"
        className="mt-8 scroll-mt-6 border-t border-zinc-200 pt-8"
      >
        <h3 className="text-lg font-semibold text-zinc-950">Markdown preview</h3>
        <p className="mt-1 text-sm text-zinc-500">
          skipされたsegmentは出力から省略し、編集済みsegmentはedited_textを使います。
        </p>
      </div>

      <div
        className="mt-6 min-h-64 rounded-md border border-zinc-200 bg-white p-4 text-sm leading-7 text-zinc-900"
        aria-label="Markdown preview"
      >
        {previewBlocks.map((block) => (
          <div key={`${block.speakerLabel}-${block.startSec}`} className="mb-5">
            <p className="font-semibold text-zinc-950">
              {showTimestamps ? (
                <span className="mr-2 font-mono text-xs font-normal text-zinc-500">
                  [{formatTimestamp(block.startSec)}]
                </span>
              ) : null}
              {block.speakerName}：
            </p>
            <p className="mt-1">
              {block.segments.map((segment) => {
                const isHighlighted =
                  highlightedPreviewSegmentId === segment.id;

                return (
                  <span
                    key={segment.id}
                    id={getSegmentPreviewDomId(segment.id)}
                    className={`scroll-mt-6 rounded-sm transition ${
                      isHighlighted ? "bg-amber-100 ring-2 ring-amber-300" : ""
                    }`}
                  >
                    {splitPreviewSentences(segment.text).map(
                      (sentence, index) => (
                        <a
                          key={`${segment.id}-${index}`}
                          href={`#${getSegmentEditDomId(segment.id)}`}
                          onClick={(event) => {
                            event.preventDefault();
                            jumpToSegment(segment.id, "edit");
                          }}
                          className="rounded-sm underline decoration-zinc-300 decoration-1 underline-offset-2 transition hover:bg-amber-50 hover:decoration-amber-500 focus:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-300"
                          title={`${formatTimestamp(segment.startSec)} の編集へ移動`}
                        >
                          {sentence}
                          {" "}
                        </a>
                      ),
                    )}
                  </span>
                );
              })}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

const initialSegmentEditState: SegmentEditActionState = {
  error: null,
  success: false,
};

type SegmentEditFormProps = {
  edit?: SegmentEdit;
  isHighlighted: boolean;
  jobId: string;
  onJumpToPreview: () => void;
  onLocalEditChange: (
    updater: (current: SegmentEdit | undefined) => SegmentEdit,
  ) => void;
  onPlay: () => void;
  onUnsavedChange: (segmentId: string, isUnsaved: boolean) => void;
  playbackStatus: "preparing" | "playing" | null;
  segment: TranscriptSegment;
  speakerLabels: string[];
  speakerNames: SpeakerNameMap;
};

function SegmentEditForm({
  edit,
  isHighlighted,
  jobId,
  onJumpToPreview,
  onLocalEditChange,
  onPlay,
  onUnsavedChange,
  playbackStatus,
  segment,
  speakerLabels,
  speakerNames,
}: SegmentEditFormProps) {
  const router = useRouter();
  const editedText = edit?.editedText ?? null;
  const speakerOverride = edit?.speakerOverride ?? null;
  const isSkipped = edit?.isSkipped || false;
  const effectiveText = editedText ?? segment.text;
  const effectiveSpeakerLabel = speakerOverride ?? segment.speakerLabel;
  const speakerName =
    speakerNames[effectiveSpeakerLabel] || effectiveSpeakerLabel;
  const [actionState, setActionState] = useState(initialSegmentEditState);
  const [skipActionState, setSkipActionState] =
    useState<SegmentSkipActionState>({
      error: null,
      success: false,
    });
  const [pending, setPending] = useState(false);
  const [skipPending, setSkipPending] = useState(false);
  const [savedEditedText, setSavedEditedText] = useState<string | null>(
    editedText,
  );
  const [savedSpeakerOverride, setSavedSpeakerOverride] = useState<string | null>(
    speakerOverride,
  );
  const [textValue, setTextValue] = useState(effectiveText);
  const [speakerValue, setSpeakerValue] = useState(effectiveSpeakerLabel);
  const [skippedValue, setSkippedValue] = useState(isSkipped);
  const hasSavedEdit = savedEditedText !== null || savedSpeakerOverride !== null;
  const savedText = savedEditedText ?? segment.text;
  const savedSpeakerLabel = savedSpeakerOverride ?? segment.speakerLabel;
  const hasUnsavedChanges =
    textValue !== savedText || speakerValue !== savedSpeakerLabel;
  const isPlayingOrPreparing = playbackStatus !== null;
  const isPreparing = playbackStatus === "preparing";

  function updateTextValue(nextText: string) {
    setTextValue(nextText);
    onUnsavedChange(
      segment.id,
      nextText !== savedText || speakerValue !== savedSpeakerLabel,
    );
  }

  function updateSpeakerValue(nextSpeakerLabel: string) {
    setSpeakerValue(nextSpeakerLabel);
    onUnsavedChange(
      segment.id,
      textValue !== savedText || nextSpeakerLabel !== savedSpeakerLabel,
    );
  }

  async function updateSkippedValue(nextSkipped: boolean) {
    const previousSkipped = skippedValue;

    setSkippedValue(nextSkipped);
    setSkipPending(true);
    setSkipActionState({ error: null, success: false });
    onLocalEditChange((current) => ({
      editedText: current ? current.editedText : savedEditedText,
      speakerOverride: current ? current.speakerOverride : savedSpeakerOverride,
      isSkipped: nextSkipped,
    }));

    const formData = new FormData();
    formData.set("jobId", jobId);
    formData.set("segmentId", segment.id);
    formData.set("isSkipped", String(nextSkipped));

    const result = await saveSegmentSkip(
      { error: null, success: false },
      formData,
    );

    setSkipPending(false);
    setSkipActionState(result);

    if (!result.success) {
      setSkippedValue(previousSkipped);
      onLocalEditChange((current) => ({
        editedText: current ? current.editedText : savedEditedText,
        speakerOverride: current ? current.speakerOverride : savedSpeakerOverride,
        isSkipped: previousSkipped,
      }));
      return;
    }

    const nextSavedEditedText = result.savedEditedText ?? null;
    const nextSavedSpeakerOverride = result.savedSpeakerOverride ?? null;
    const nextSavedSkipped = result.savedIsSkipped ?? nextSkipped;

    setSavedEditedText(nextSavedEditedText);
    setSavedSpeakerOverride(nextSavedSpeakerOverride);
    setSkippedValue(nextSavedSkipped);
    onLocalEditChange(() => ({
      editedText: nextSavedEditedText,
      speakerOverride: nextSavedSpeakerOverride,
      isSkipped: nextSavedSkipped,
    }));
    router.refresh();
  }

  async function submitSegmentEdit(event: FormEvent<HTMLFormElement>) {
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
    const nextSavedSpeakerOverride = result.savedSpeakerOverride ?? null;
    const nextSavedSkipped = result.savedIsSkipped ?? skippedValue;
    const nextSavedText = nextSavedEditedText ?? segment.text;
    const nextSavedSpeakerLabel = nextSavedSpeakerOverride ?? segment.speakerLabel;

    setSavedEditedText(nextSavedEditedText);
    setSavedSpeakerOverride(nextSavedSpeakerOverride);
    setTextValue(nextSavedText);
    setSpeakerValue(nextSavedSpeakerLabel);
    setSkippedValue(nextSavedSkipped);
    onLocalEditChange(() => ({
      editedText: nextSavedEditedText,
      speakerOverride: nextSavedSpeakerOverride,
      isSkipped: nextSavedSkipped,
    }));
    onUnsavedChange(segment.id, false);
  }

  return (
    <form
      id={getSegmentEditDomId(segment.id)}
      onSubmit={(event) => void submitSegmentEdit(event)}
      className={`rounded-md border p-4 transition ${
        hasUnsavedChanges
          ? "border-orange-300 bg-orange-50"
          : isPlayingOrPreparing
          ? "border-emerald-300 bg-emerald-50"
          : isHighlighted
            ? "border-amber-300 bg-amber-50"
          : skippedValue
          ? "border-zinc-200 bg-zinc-50"
          : "border-zinc-200 bg-white"
      } ${skippedValue ? "opacity-60" : ""}`}
    >
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="segmentId" value={segment.id} />
      <input type="hidden" name="editedSpeakerLabel" value={speakerValue} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <button
              type="button"
              onClick={onPlay}
              disabled={isPreparing}
              className={`inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold transition ${
                isPlayingOrPreparing
                  ? "bg-emerald-700 text-white hover:bg-emerald-800"
                  : "bg-zinc-950 text-white hover:bg-zinc-800"
              } disabled:cursor-not-allowed disabled:bg-zinc-400`}
            >
              {isPreparing ? "準備中..." : isPlayingOrPreparing ? "停止" : "再生"}
            </button>
            {!skippedValue ? (
              <button
                type="button"
                onClick={onJumpToPreview}
                className="inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
              >
                全体プレビューへ
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
            original: {segment.speakerLabel}
            {speakerValue !== segment.speakerLabel
              ? ` / override: ${speakerValue}`
              : ""}
          </p>
        </div>

        <label className="inline-flex w-fit items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700">
          <input
            type="checkbox"
            name="isSkipped"
            checked={skippedValue}
            disabled={skipPending}
            onChange={(event) => void updateSkippedValue(event.target.checked)}
            className="peer sr-only"
          />
          <span className="relative h-5 w-9 rounded-full bg-zinc-300 transition peer-checked:bg-zinc-950 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
          このセグメントをスキップする
        </label>
      </div>

      <label className="mt-4 block text-sm font-medium text-zinc-700">
        話者
        <select
          value={speakerValue}
          onChange={(event) => updateSpeakerValue(event.target.value)}
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
        >
          {speakerLabels.map((speakerLabel) => (
            <option key={speakerLabel} value={speakerLabel}>
              {speakerNames[speakerLabel]
                ? `${speakerNames[speakerLabel]} (${speakerLabel})`
                : speakerLabel}
            </option>
          ))}
        </select>
      </label>

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
          本文編集を保存しました。
        </p>
      ) : null}
      {skipPending ? (
        <p className="mt-3 text-xs text-zinc-500" aria-live="polite">
          skip状態を保存中...
        </p>
      ) : null}
      {skipActionState.error ? (
        <p className="mt-3 text-sm text-red-700" aria-live="polite">
          {skipActionState.error}
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
          {pending ? "保存中..." : "本文の変更を保存"}
        </button>
        <button
          type="submit"
          name="intent"
          value="reset"
          disabled={pending || !hasSavedEdit}
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400"
        >
          本文・話者を元に戻す
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
        speakerLabel: edit?.speakerOverride ?? segment.speakerLabel,
        text: edit?.editedText ?? segment.text,
      },
    ];
  });
}

function buildSpeakerLabelOptions(
  segments: TranscriptSegment[],
  speakerNames: SpeakerNameMap,
  segmentEdits: SegmentEditMap,
) {
  const speakerLabels = new Set<string>();

  for (const segment of segments) {
    speakerLabels.add(segment.speakerLabel);
  }

  for (const speakerLabel of Object.keys(speakerNames)) {
    speakerLabels.add(speakerLabel);
  }

  for (const edit of Object.values(segmentEdits)) {
    if (edit.speakerOverride) {
      speakerLabels.add(edit.speakerOverride);
    }
  }

  return Array.from(speakerLabels).sort((left, right) =>
    left.localeCompare(right),
  );
}

function buildPreviewBlocks(
  segments: TranscriptSegment[],
  speakerNames: SpeakerNameMap,
) {
  const blocks: Array<{
    speakerLabel: string;
    speakerName: string;
    startSec: number;
    segments: TranscriptSegment[];
  }> = [];

  for (const segment of segments) {
    const previous = blocks.at(-1);

    if (previous && previous.speakerLabel === segment.speakerLabel) {
      previous.segments.push(segment);
      continue;
    }

    blocks.push({
      speakerLabel: segment.speakerLabel,
      speakerName: speakerNames[segment.speakerLabel] || segment.speakerLabel,
      startSec: segment.startSec,
      segments: [segment],
    });
  }

  return blocks;
}

function splitPreviewSentences(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  return normalized.match(/[^。！？!?]+[。！？!?」』）)]*|.+$/g) || [normalized];
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
