"use client";

import {
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  punctuateProjectSegments,
  saveSegmentEdit,
  saveSegmentSpeaker,
  saveSegmentSkip,
  type SegmentEditActionState,
  type SegmentSpeakerActionState,
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

export type TranscriptMarkdownProps = {
  activeReturnHighlightSegmentId?: string | null;
  audioChunkDurationSec?: number | null;
  audioLoadError?: string | null;
  audioUrl: string | null;
  exportBaseName?: string;
  jobId: string;
  onSpeakerLabelClick?: (segmentId: string, speakerLabel: string) => void;
  projectId?: string | null;
  segmentEdits?: SegmentEditMap;
  segments: TranscriptSegment[];
  speakerNames?: SpeakerNameMap;
};

export function TranscriptMarkdown({
  activeReturnHighlightSegmentId = null,
  audioChunkDurationSec = null,
  audioLoadError = null,
  audioUrl,
  exportBaseName = "transcript",
  jobId,
  onSpeakerLabelClick,
  projectId = null,
  segmentEdits = {},
  segments,
  speakerNames = {},
}: TranscriptMarkdownProps) {
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUnsavedJumpIndexRef = useRef(-1);
  const punctuationToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const skipToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [committedSegmentEditMap, setCommittedSegmentEditMap] =
    useState<SegmentEditMap>(segmentEdits);
  const [previewSkipPendingIds, setPreviewSkipPendingIds] = useState<
    Record<string, boolean>
  >({});
  const [skipToast, setSkipToast] = useState<{
    error: string | null;
    segmentId: string;
  } | null>(null);
  const [isPunctuating, setIsPunctuating] = useState(false);
  const [punctuationProgress, setPunctuationProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [punctuationToast, setPunctuationToast] = useState<{
    error: boolean;
    message: string;
  } | null>(null);
  const [segmentFormRevisions, setSegmentFormRevisions] = useState<
    Record<string, number>
  >({});

  const effectiveSegments = useMemo(
    () => buildEffectiveSegments(segments, effectiveSegmentEditMap),
    [effectiveSegmentEditMap, segments],
  );
  const committedSegments = useMemo(
    () => buildEffectiveSegments(segments, committedSegmentEditMap),
    [committedSegmentEditMap, segments],
  );
  const blocks = useMemo(
    () => buildTranscriptBlocks(committedSegments, speakerNames),
    [committedSegments, speakerNames],
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

  useEffect(() => {
    return () => {
      if (skipToastTimeoutRef.current) {
        clearTimeout(skipToastTimeoutRef.current);
      }
      if (punctuationToastTimeoutRef.current) {
        clearTimeout(punctuationToastTimeoutRef.current);
      }
    };
  }, []);

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

  function commitLocalSegmentEdit(
    segmentId: string,
    edit: SegmentEdit,
  ) {
    setCommittedSegmentEditMap((current) => ({
      ...current,
      [segmentId]: edit,
    }));
  }

  function updateSegmentSkipState(segmentId: string, isSkipped: boolean) {
    setEffectiveSegmentEditMap((current) =>
      setSegmentSkipInEditMap(current, segmentId, isSkipped),
    );
    setCommittedSegmentEditMap((current) =>
      setSegmentSkipInEditMap(current, segmentId, isSkipped),
    );
  }

  function setPreviewSkipPending(segmentId: string, isPending: boolean) {
    setPreviewSkipPendingIds((current) => {
      if (Boolean(current[segmentId]) === isPending) {
        return current;
      }

      const next = { ...current };

      if (isPending) {
        next[segmentId] = true;
      } else {
        delete next[segmentId];
      }

      return next;
    });
  }

  function showSkipToast(segmentId: string, error: string | null = null) {
    if (skipToastTimeoutRef.current) {
      clearTimeout(skipToastTimeoutRef.current);
    }

    setSkipToast({ error, segmentId });
    skipToastTimeoutRef.current = setTimeout(() => {
      setSkipToast(null);
      skipToastTimeoutRef.current = null;
    }, 5000);
  }

  function showPunctuationToast(message: string, error = false) {
    if (punctuationToastTimeoutRef.current) {
      clearTimeout(punctuationToastTimeoutRef.current);
    }

    setPunctuationToast({ error, message });
    punctuationToastTimeoutRef.current = setTimeout(() => {
      setPunctuationToast(null);
      punctuationToastTimeoutRef.current = null;
    }, 5000);
  }

  async function punctuateSegments() {
    if (isPunctuating) {
      return;
    }

    if (unsavedSegmentCount > 0) {
      showPunctuationToast(
        "未保存の本文編集を保存してから句読点を整えてください。",
        true,
      );
      return;
    }

    setIsPunctuating(true);
    setPunctuationProgress(null);
    setPunctuationToast(null);

    let completed = 0;
    let total = 0;
    let savedCount = 0;

    try {
      while (true) {
        const result = await punctuateProjectSegments({ jobId, projectId });

        if (!result.success) {
          throw new Error(
            result.error || "句読点補正処理に失敗しました。",
          );
        }

        if (result.noTargets) {
          if (completed === 0) {
            showPunctuationToast(
              "整形できる未編集セグメントがありません",
            );
          }
          break;
        }

        if (total === 0) {
          total = result.processedCount + result.remainingCount;
        }

        completed += result.processedCount;
        savedCount += result.savedSegments.length;
        setPunctuationProgress({ completed, total });

        if (result.savedSegments.length > 0) {
          const savedBySegmentId = new Map(
            result.savedSegments.map((segment) => [
              segment.segmentId,
              segment.editedText,
            ]),
          );
          const applySavedText = (current: SegmentEditMap) => {
            const next = { ...current };

            for (const [segmentId, editedText] of savedBySegmentId) {
              const currentEdit = current[segmentId];

              next[segmentId] = {
                editedText,
                isSkipped: currentEdit?.isSkipped || false,
                speakerOverride: currentEdit?.speakerOverride || null,
              };
            }

            return next;
          };

          setEffectiveSegmentEditMap(applySavedText);
          setCommittedSegmentEditMap(applySavedText);
          setSegmentFormRevisions((current) => {
            const next = { ...current };

            for (const segmentId of savedBySegmentId.keys()) {
              next[segmentId] = (next[segmentId] || 0) + 1;
            }

            return next;
          });
        }

        if (!result.hasMore) {
          break;
        }
      }

      if (completed > 0 || savedCount > 0) {
        showPunctuationToast("句読点を整えました");
      }
    } catch (error) {
      showPunctuationToast(
        error instanceof Error
          ? error.message
          : "句読点補正処理に失敗しました。",
        true,
      );
    } finally {
      setIsPunctuating(false);
    }
  }

  async function savePreviewSkipState(segmentId: string, isSkipped: boolean) {
    const formData = new FormData();

    formData.set("jobId", jobId);
    formData.set("segmentId", segmentId);
    formData.set("isSkipped", String(isSkipped));

    return saveSegmentSkip({ error: null, success: false }, formData);
  }

  async function skipPreviewSegment(segmentId: string) {
    if (previewSkipPendingIds[segmentId]) {
      return;
    }

    setPreviewSkipPending(segmentId, true);
    updateSegmentSkipState(segmentId, true);

    const result = await savePreviewSkipState(segmentId, true);

    setPreviewSkipPending(segmentId, false);

    if (!result.success) {
      updateSegmentSkipState(segmentId, false);
      showSkipToast(segmentId, result.error || "セグメントのスキップに失敗しました。");
      return;
    }

    showSkipToast(segmentId);
  }

  async function undoPreviewSkip(segmentId: string) {
    if (previewSkipPendingIds[segmentId]) {
      return;
    }

    setPreviewSkipPending(segmentId, true);
    updateSegmentSkipState(segmentId, false);

    const result = await savePreviewSkipState(segmentId, false);

    setPreviewSkipPending(segmentId, false);

    if (!result.success) {
      updateSegmentSkipState(segmentId, true);
      showSkipToast(segmentId, result.error || "スキップ解除に失敗しました。");
      return;
    }

    if (skipToastTimeoutRef.current) {
      clearTimeout(skipToastTimeoutRef.current);
      skipToastTimeoutRef.current = null;
    }

    setSkipToast(null);
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

  function jumpToSpeakerSetting(speakerLabel: string) {
    const speakerSettingElement = document.getElementById(
      `speaker-setting-${speakerLabel}`,
    );

    if (!speakerSettingElement) {
      return;
    }

    speakerSettingElement.scrollIntoView({ behavior: "smooth", block: "center" });

    if (speakerSettingElement instanceof HTMLInputElement) {
      speakerSettingElement.focus({ preventScroll: true });
    }
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
          <button
            type="button"
            onClick={() => void punctuateSegments()}
            disabled={isPunctuating}
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
          >
            {isPunctuating
              ? punctuationProgress
                ? `句読点を整えています... ${punctuationProgress.completed} / ${punctuationProgress.total}`
                : "句読点を整えています..."
              : "句読点を整える"}
          </button>
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
          <div key={`${block.speakerLabel}-${block.startSec}`} className="mb-4">
            <p className="mt-2 text-sm leading-8 text-zinc-700">
              <button
                type="button"
                onClick={() => {
                  const firstSegmentId = block.segments[0]?.id;

                  if (firstSegmentId && onSpeakerLabelClick) {
                    onSpeakerLabelClick(firstSegmentId, block.speakerLabel);
                    return;
                  }

                  jumpToSpeakerSetting(block.speakerLabel);
                }}
                className="inline font-semibold text-zinc-900 underline decoration-zinc-300 underline-offset-2 focus:outline-none focus:ring-2 focus:ring-amber-300"
              >
                {block.speakerName}
              </button>
              {block.speakerName !== block.speakerLabel ? (
                <span className="ml-1 text-xs text-zinc-500">({block.speakerLabel})</span>
              ) : null}
              <span className="mx-1">：</span>
              <span className="prose prose-sm max-w-none text-zinc-900">
                {block.segments.map((segment) => (
                  <span
                    key={segment.id}
                    id={getSegmentPreviewDomId(segment.id)}
                    className={`group/preview-segment relative inline scroll-mt-6 rounded-sm transition ${
                      activeReturnHighlightSegmentId === segment.id ||
                      highlightedPreviewSegmentId === segment.id
                        ? "bg-amber-100 ring-2 ring-amber-300"
                        : ""
                    }`}
                  >
                    {splitPreviewSentences(segment.text).map((sentence, idx) => (
                      <a
                        key={`${segment.id}-${idx}`}
                        href={`#${getSegmentEditDomId(segment.id)}`}
                        onClick={(event) => {
                          event.preventDefault();
                          jumpToSegment(segment.id, "edit");
                        }}
                        className="underline decoration-zinc-300 decoration-1 underline-offset-2 text-zinc-900 hover:bg-amber-50"
                        title={`編集へ移動 (${formatTimestamp(segment.startSec)})`}
                      >
                        {sentence}
                        {" "}
                      </a>
                    ))}
                    <button
                      type="button"
                      aria-label="このセグメントをスキップ"
                      title="このセグメントをスキップ"
                      disabled={Boolean(previewSkipPendingIds[segment.id])}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void skipPreviewSegment(segment.id);
                      }}
                      className="absolute right-0 top-0 z-10 inline-flex size-5 items-center justify-center rounded-full border border-zinc-200 bg-white/95 text-xs font-semibold leading-none text-zinc-400 opacity-0 shadow-sm transition hover:border-red-200 hover:text-red-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:cursor-not-allowed disabled:text-zinc-300 group-hover/preview-segment:opacity-100 group-focus-within/preview-segment:opacity-100"
                    >
                      x
                    </button>
                    {" "}
                  </span>
                ))}
              </span>
            </p>
          </div>
        ))}
      </div>

      {skipToast ? (
        <div
          className="fixed bottom-5 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-950 px-4 py-3 text-sm text-white shadow-lg"
          role="status"
          aria-live="polite"
        >
          <span>
            {skipToast.error || "セグメントをスキップしました"}
          </span>
          {skipToast.error ? null : (
            <button
              type="button"
              onClick={() => void undoPreviewSkip(skipToast.segmentId)}
              disabled={Boolean(previewSkipPendingIds[skipToast.segmentId])}
              className="shrink-0 rounded-sm px-2 py-1 text-sm font-semibold text-white underline decoration-white/50 underline-offset-4 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/50"
            >
              元に戻す
            </button>
          )}
        </div>
      ) : null}

      {punctuationToast ? (
        <div
          className={`fixed bottom-20 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-md border px-4 py-3 text-sm shadow-lg ${
            punctuationToast.error
              ? "border-red-200 bg-red-950 text-white"
              : "border-zinc-200 bg-zinc-950 text-white"
          }`}
          role={punctuationToast.error ? "alert" : "status"}
          aria-live="polite"
        >
          {punctuationToast.message}
        </div>
      ) : null}

      <div className="mt-8 space-y-3">
        {segments.map((segment) => {
          const edit = effectiveSegmentEditMap[segment.id];

          return (
            <SegmentEditForm
              key={`${segment.id}-${Boolean(edit?.isSkipped)}-${
                segmentFormRevisions[segment.id] || 0
              }`}
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
              onSaveCommit={(savedEdit) =>
                commitLocalSegmentEdit(segment.id, savedEdit)
              }
              onUnsavedChange={updateSegmentUnsaved}
              segment={segment}
              speakerLabels={speakerLabels}
              speakerNames={speakerNames}
            />
          );
        })}
      </div>
    </section>
  );
}

const initialSegmentEditState: SegmentEditActionState = {
  error: null,
  success: false,
};

const SEGMENT_SWIPE_THRESHOLD_PX = 72;
const SEGMENT_SWIPE_MAX_OFFSET_PX = 100;

type SegmentEditFormProps = {
  edit?: SegmentEdit;
  isHighlighted: boolean;
  jobId: string;
  onJumpToPreview: () => void;
  onLocalEditChange: (
    updater: (current: SegmentEdit | undefined) => SegmentEdit,
  ) => void;
  onPlay: () => void;
  onSaveCommit: (savedEdit: SegmentEdit) => void;
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
  onSaveCommit,
  onUnsavedChange,
  playbackStatus,
  segment,
  speakerLabels,
  speakerNames,
}: SegmentEditFormProps) {
  const editedText = edit?.editedText ?? null;
  const speakerOverride = edit?.speakerOverride ?? null;
  const isSkipped = edit?.isSkipped || false;
  const effectiveText = editedText ?? segment.text;
  const effectiveSpeakerLabel = speakerOverride ?? segment.speakerLabel;
  const [actionState, setActionState] = useState(initialSegmentEditState);
  const [skipActionState, setSkipActionState] =
    useState<SegmentSkipActionState>({
      error: null,
      success: false,
    });
  const [speakerActionState, setSpeakerActionState] =
    useState<SegmentSpeakerActionState>({
      error: null,
      success: false,
    });
  const [pending, setPending] = useState(false);
  const [skipPending, setSkipPending] = useState(false);
  const [speakerPending, setSpeakerPending] = useState(false);
  const [recentSaveStatus, setRecentSaveStatus] = useState<string | null>(null);
  const editRequestIdRef = useRef(0);
  const skipRequestIdRef = useRef(0);
  const speakerRequestIdRef = useRef(0);
  const committedSpeakerLabelRef = useRef(effectiveSpeakerLabel);
  const recentSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savedEditedText, setSavedEditedText] = useState<string | null>(
    editedText,
  );
  const [savedSpeakerOverride, setSavedSpeakerOverride] = useState<string | null>(
    speakerOverride,
  );
  const [textValue, setTextValue] = useState(effectiveText);
  const [speakerValue, setSpeakerValue] = useState(effectiveSpeakerLabel);
  const [skippedValue, setSkippedValue] = useState(isSkipped);
  const speakerName = speakerNames[speakerValue] || speakerValue;
  const hasSavedEdit = savedEditedText !== null || savedSpeakerOverride !== null;
  const savedText = savedEditedText ?? segment.text;
  const hasUnsavedChanges = textValue !== savedText;
  const isPlayingOrPreparing = playbackStatus !== null;
  const isPreparing = playbackStatus === "preparing";
  const isSaving = pending || skipPending || speakerPending;
  const swipe = useSwipeSegmentAction({
    onSwipeLeft: onPlay,
    onSwipeRight: () => {
      if (!skipPending) {
        void updateSkippedValue(!skippedValue);
      }
    },
  });

  useEffect(() => {
    return () => {
      if (recentSaveTimeoutRef.current) {
        clearTimeout(recentSaveTimeoutRef.current);
      }
    };
  }, []);

  function updateTextValue(nextText: string) {
    setTextValue(nextText);
    onUnsavedChange(segment.id, nextText !== savedText);
  }

  function markRecentlySaved(label: string) {
    if (recentSaveTimeoutRef.current) {
      clearTimeout(recentSaveTimeoutRef.current);
    }

    setRecentSaveStatus(label);
    recentSaveTimeoutRef.current = setTimeout(() => {
      setRecentSaveStatus(null);
      recentSaveTimeoutRef.current = null;
    }, 1400);
  }

  async function updateSpeakerValue(nextSpeakerLabel: string) {
    if (nextSpeakerLabel === speakerValue) {
      return;
    }

    const requestId = speakerRequestIdRef.current + 1;
    speakerRequestIdRef.current = requestId;
    const clientStartedAt = performance.now();
    const previousSpeakerLabel = speakerValue;
    const previousEdit: SegmentEdit = {
      editedText: savedEditedText,
      speakerOverride: savedSpeakerOverride,
      isSkipped: skippedValue,
    };

    debugSegmentSaveMetric("speaker:start", {
      requestId,
      segmentId: segment.id,
    });
    setSpeakerValue(nextSpeakerLabel);
    setSpeakerPending(true);
    setSpeakerActionState({ error: null, success: false });
    setRecentSaveStatus(null);
    onLocalEditChange((current) => ({
      editedText: current ? current.editedText : savedEditedText,
      speakerOverride:
        nextSpeakerLabel !== segment.speakerLabel ? nextSpeakerLabel : null,
      isSkipped: current ? current.isSkipped : skippedValue,
    }));

    const formData = new FormData();
    formData.set("jobId", jobId);
    formData.set("segmentId", segment.id);
    formData.set("speakerLabel", nextSpeakerLabel);

    const result = await saveSegmentSpeaker(formData);

    if (speakerRequestIdRef.current !== requestId) {
      debugSegmentSaveMetric("speaker:stale-response", {
        requestId,
        segmentId: segment.id,
      });
      return;
    }

    setSpeakerPending(false);
    setSpeakerActionState(result);

    if (!result.success) {
      const rollbackSpeakerLabel = committedSpeakerLabelRef.current;

      setSpeakerValue(rollbackSpeakerLabel);
      onLocalEditChange(() => previousEdit);
      debugSegmentSaveMetric("speaker:error", {
        clientElapsedMs: Math.round(performance.now() - clientStartedAt),
        requestId,
        segmentId: segment.id,
        serverMetrics: result.metrics,
      });
      return;
    }

    const nextSavedEditedText = savedEditedText;
    const nextSavedSpeakerOverride =
      result.savedSpeakerOverride === undefined
        ? savedSpeakerOverride
        : result.savedSpeakerOverride;
    const nextSavedSpeakerLabel =
      nextSavedSpeakerOverride ?? segment.speakerLabel;
    const nextSavedSkipped =
      result.savedIsSkipped === undefined ? skippedValue : result.savedIsSkipped;

    committedSpeakerLabelRef.current = nextSavedSpeakerLabel;
    setSavedEditedText(nextSavedEditedText);
    setSavedSpeakerOverride(nextSavedSpeakerOverride);
    setSpeakerValue(nextSavedSpeakerLabel);
    setSkippedValue(nextSavedSkipped);
    onLocalEditChange(() => ({
      editedText: nextSavedEditedText,
      speakerOverride: nextSavedSpeakerOverride,
      isSkipped: nextSavedSkipped,
    }));
    onSaveCommit({
      editedText: nextSavedEditedText,
      speakerOverride: nextSavedSpeakerOverride,
      isSkipped: nextSavedSkipped,
    });
    markRecentlySaved("話者変更を保存しました。");
    debugSegmentSaveMetric("speaker:done", {
      clientElapsedMs: Math.round(performance.now() - clientStartedAt),
      previousSpeakerLabel,
      requestId,
      segmentId: segment.id,
      serverMetrics: result.metrics,
    });
  }

  async function updateSkippedValue(nextSkipped: boolean) {
    const requestId = skipRequestIdRef.current + 1;
    skipRequestIdRef.current = requestId;
    const clientStartedAt = performance.now();
    const previousSkipped = skippedValue;
    const previousEdit: SegmentEdit = {
      editedText: savedEditedText,
      speakerOverride: savedSpeakerOverride,
      isSkipped: previousSkipped,
    };

    debugSegmentSaveMetric("skip:start", {
      requestId,
      segmentId: segment.id,
    });
    setSkippedValue(nextSkipped);
    setSkipPending(true);
    setSkipActionState({ error: null, success: false });
    setRecentSaveStatus(null);
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

    if (skipRequestIdRef.current !== requestId) {
      debugSegmentSaveMetric("skip:stale-response", {
        requestId,
        segmentId: segment.id,
      });
      return;
    }

    setSkipPending(false);
    setSkipActionState(result);

    if (!result.success) {
      setSkippedValue(previousSkipped);
      onLocalEditChange(() => previousEdit);
      debugSegmentSaveMetric("skip:error", {
        clientElapsedMs: Math.round(performance.now() - clientStartedAt),
        requestId,
        segmentId: segment.id,
        serverMetrics: result.metrics,
      });
      return;
    }

    const nextSavedEditedText = savedEditedText;
    const nextSavedSpeakerOverride = savedSpeakerOverride;
    const nextSavedSkipped =
      result.savedIsSkipped === undefined ? nextSkipped : result.savedIsSkipped;
    const nextSavedSpeakerLabel =
      nextSavedSpeakerOverride ?? segment.speakerLabel;

    committedSpeakerLabelRef.current = nextSavedSpeakerLabel;
    setSavedEditedText(nextSavedEditedText);
    setSavedSpeakerOverride(nextSavedSpeakerOverride);
    setSpeakerValue(nextSavedSpeakerLabel);
    setSkippedValue(nextSavedSkipped);
    onLocalEditChange(() => ({
      editedText: nextSavedEditedText,
      speakerOverride: nextSavedSpeakerOverride,
      isSkipped: nextSavedSkipped,
    }));
    onSaveCommit({
      editedText: nextSavedEditedText,
      speakerOverride: nextSavedSpeakerOverride,
      isSkipped: nextSavedSkipped,
    });
    markRecentlySaved("skip状態を保存しました。");
    debugSegmentSaveMetric("skip:done", {
      clientElapsedMs: Math.round(performance.now() - clientStartedAt),
      requestId,
      segmentId: segment.id,
      serverMetrics: result.metrics,
    });
  }

  async function submitSegmentEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nativeEvent = event.nativeEvent as SubmitEvent;
    const submitter = nativeEvent.submitter;
    const formData = new FormData(event.currentTarget);
    const intent =
      submitter instanceof HTMLButtonElement ? submitter.value : "save";

    formData.set("intent", intent);
    const requestId = editRequestIdRef.current + 1;
    editRequestIdRef.current = requestId;
    const clientStartedAt = performance.now();
    const previousTextValue = textValue;
    const previousSpeakerLabel = speakerValue;
    const previousSkipped = skippedValue;
    const previousSavedEditedText = savedEditedText;
    const previousSavedSpeakerOverride = savedSpeakerOverride;
    const previousEdit: SegmentEdit = {
      editedText: previousSavedEditedText,
      speakerOverride: previousSavedSpeakerOverride,
      isSkipped: previousSkipped,
    };
    const optimisticEditedText =
      intent === "reset" ? null : textValue.trim() ? textValue : null;
    const optimisticSpeakerOverride =
      intent === "reset"
        ? null
        : speakerValue !== segment.speakerLabel
          ? speakerValue
          : null;
    const optimisticText = optimisticEditedText ?? segment.text;
    const optimisticSpeakerLabel =
      optimisticSpeakerOverride ?? segment.speakerLabel;

    debugSegmentSaveMetric("text:start", {
      intent,
      requestId,
      segmentId: segment.id,
    });
    setPending(true);
    setActionState({ error: null, success: false });
    setRecentSaveStatus(null);
    setSavedEditedText(optimisticEditedText);
    setSavedSpeakerOverride(optimisticSpeakerOverride);
    setTextValue(optimisticText);
    setSpeakerValue(optimisticSpeakerLabel);
    committedSpeakerLabelRef.current = optimisticSpeakerLabel;
    onLocalEditChange(() => ({
      editedText: optimisticEditedText,
      speakerOverride: optimisticSpeakerOverride,
      isSkipped: skippedValue,
    }));
    onUnsavedChange(segment.id, false);

    const result = await saveSegmentEdit(initialSegmentEditState, formData);

    if (editRequestIdRef.current !== requestId) {
      debugSegmentSaveMetric("text:stale-response", {
        requestId,
        segmentId: segment.id,
      });
      return;
    }

    setActionState(result);
    setPending(false);

    if (!result.success) {
      setTextValue(previousTextValue);
      setSpeakerValue(previousSpeakerLabel);
      setSkippedValue(previousSkipped);
      setSavedEditedText(previousSavedEditedText);
      setSavedSpeakerOverride(previousSavedSpeakerOverride);
      committedSpeakerLabelRef.current = previousSpeakerLabel;
      onLocalEditChange(() => previousEdit);
      onUnsavedChange(segment.id, previousTextValue !== savedText);
      debugSegmentSaveMetric("text:error", {
        clientElapsedMs: Math.round(performance.now() - clientStartedAt),
        requestId,
        segmentId: segment.id,
        serverMetrics: result.metrics,
      });
      return;
    }

    const nextSavedEditedText =
      result.savedEditedText === undefined ? optimisticEditedText : result.savedEditedText;
    const nextSavedSpeakerOverride =
      result.savedSpeakerOverride === undefined
        ? optimisticSpeakerOverride
        : result.savedSpeakerOverride;
    const nextSavedSkipped =
      result.savedIsSkipped === undefined ? skippedValue : result.savedIsSkipped;
    const nextSavedText = nextSavedEditedText ?? segment.text;
    const nextSavedSpeakerLabel = nextSavedSpeakerOverride ?? segment.speakerLabel;

    committedSpeakerLabelRef.current = nextSavedSpeakerLabel;
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
    onSaveCommit({
      editedText: nextSavedEditedText,
      speakerOverride: nextSavedSpeakerOverride,
      isSkipped: nextSavedSkipped,
    });
    onUnsavedChange(segment.id, false);
    markRecentlySaved(intent === "reset" ? "元に戻しました。" : "本文編集を保存しました。");
    debugSegmentSaveMetric("text:done", {
      clientElapsedMs: Math.round(performance.now() - clientStartedAt),
      intent,
      requestId,
      segmentId: segment.id,
      serverMetrics: result.metrics,
    });
  }

  return (
    <form
      id={getSegmentEditDomId(segment.id)}
      onSubmit={(event) => void submitSegmentEdit(event)}
      {...swipe.handlers}
      style={swipe.style}
      className={`rounded-md border p-4 transition ${
        hasUnsavedChanges
          ? "border-orange-300 bg-orange-50"
          : isSaving
          ? "border-sky-300 bg-sky-50"
          : isPlayingOrPreparing
          ? "border-emerald-300 bg-emerald-50"
          : isHighlighted
            ? "border-amber-300 bg-amber-50"
          : skippedValue
          ? "border-zinc-200 bg-zinc-50"
          : "border-zinc-200 bg-white"
      } ${skippedValue ? "opacity-60" : ""} ${isSaving ? "shadow-sm ring-1 ring-sky-200" : ""}`}
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
            <a
              href={`#${getSegmentPreviewDomId(segment.id)}`}
              aria-disabled={skippedValue}
              onClick={(event) => {
                event.preventDefault();

                if (!skippedValue) {
                  onJumpToPreview();
                }
              }}
              className={`inline-flex min-h-9 items-center justify-center rounded-md border px-3 text-sm font-semibold transition ${
                skippedValue
                  ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
                  : "border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50"
              }`}
            >
              プレビューへ
            </a>
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
            {isSaving ? (
              <span className="rounded-md bg-sky-100 px-2 py-1 text-xs font-medium text-sky-800">
                保存中
              </span>
            ) : null}
            {recentSaveStatus ? (
              <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">
                保存済み
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
          onChange={(event) => void updateSpeakerValue(event.target.value)}
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          aria-busy={speakerPending}
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

      {/* Web standards do not allow forcing Japanese IME on; these hints keep segment text editing Japanese-input friendly. */}
      <textarea
        lang="ja"
        name="editedText"
        inputMode="text"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
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
          {recentSaveStatus || "本文編集を保存しました。"}
        </p>
      ) : null}
      {recentSaveStatus && !actionState.success ? (
        <p className="mt-3 text-sm text-emerald-700" aria-live="polite">
          {recentSaveStatus}
        </p>
      ) : null}
      {skipPending ? (
        <p className="mt-3 text-xs text-zinc-500" aria-live="polite">
          skip状態を保存中...
        </p>
      ) : null}
      {speakerPending ? (
        <p className="mt-3 text-xs text-zinc-500" aria-live="polite">
          話者変更を保存中...
        </p>
      ) : null}
      {speakerActionState.error ? (
        <p className="mt-3 text-sm text-red-700" aria-live="polite">
          {speakerActionState.error}
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

function useSwipeSegmentAction({
  onSwipeLeft,
  onSwipeRight,
}: {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
}) {
  const pointerStartRef = useRef<{
    id: number;
    x: number;
    y: number;
  } | null>(null);
  const didTriggerSwipeRef = useRef(false);
  const [translateX, setTranslateX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isMobileSwipeEnabled, setIsMobileSwipeEnabled] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mobileQuery = window.matchMedia(
      "(pointer: coarse) and (max-width: 767px)",
    );
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    function syncQueries() {
      setIsMobileSwipeEnabled(mobileQuery.matches);
      setPrefersReducedMotion(motionQuery.matches);
    }

    syncQueries();
    mobileQuery.addEventListener("change", syncQueries);
    motionQuery.addEventListener("change", syncQueries);

    return () => {
      mobileQuery.removeEventListener("change", syncQueries);
      motionQuery.removeEventListener("change", syncQueries);
    };
  }, []);

  function resetPosition() {
    pointerStartRef.current = null;
    setIsDragging(false);
    setTranslateX(0);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (
      !isMobileSwipeEnabled ||
      event.button !== 0 ||
      isInteractiveSwipeTarget(event.target)
    ) {
      return;
    }

    pointerStartRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    didTriggerSwipeRef.current = false;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const start = pointerStartRef.current;

    if (!start || start.id !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;

    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 12) {
      resetPosition();
      return;
    }

    if (Math.abs(deltaX) < 8) {
      return;
    }

    event.preventDefault();
    setTranslateX(
      Math.max(
        -SEGMENT_SWIPE_MAX_OFFSET_PX,
        Math.min(SEGMENT_SWIPE_MAX_OFFSET_PX, deltaX),
      ),
    );
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>) {
    const start = pointerStartRef.current;

    if (!start || start.id !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - start.x;

    if (deltaX >= SEGMENT_SWIPE_THRESHOLD_PX) {
      didTriggerSwipeRef.current = true;
      onSwipeRight();
    } else if (deltaX <= -SEGMENT_SWIPE_THRESHOLD_PX) {
      didTriggerSwipeRef.current = true;
      onSwipeLeft();
    }

    resetPosition();

    if (didTriggerSwipeRef.current) {
      window.setTimeout(() => {
        didTriggerSwipeRef.current = false;
      }, 250);
    }
  }

  function handlePointerCancel() {
    resetPosition();
  }

  function handleClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!didTriggerSwipeRef.current) {
      return;
    }

    didTriggerSwipeRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  const style: CSSProperties = isMobileSwipeEnabled
    ? {
        touchAction: "pan-y",
        transform: translateX ? `translateX(${translateX}px)` : undefined,
        transition:
          isDragging || prefersReducedMotion
            ? undefined
            : "transform 160ms ease-out",
      }
    : {};

  return {
    handlers: {
      onClickCapture: handleClickCapture,
      onPointerCancel: handlePointerCancel,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
    },
    style,
  };
}

function isInteractiveSwipeTarget(target: EventTarget) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "a, button, input, label, select, summary, textarea, [contenteditable='true']",
      ),
    )
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

function setSegmentSkipInEditMap(
  segmentEdits: SegmentEditMap,
  segmentId: string,
  isSkipped: boolean,
) {
  const currentEdit = segmentEdits[segmentId];
  const nextEdit: SegmentEdit = {
    editedText: currentEdit?.editedText ?? null,
    speakerOverride: currentEdit?.speakerOverride ?? null,
    isSkipped,
  };
  const nextSegmentEdits = { ...segmentEdits };

  if (!nextEdit.editedText && !nextEdit.speakerOverride && !nextEdit.isSkipped) {
    delete nextSegmentEdits[segmentId];
  } else {
    nextSegmentEdits[segmentId] = nextEdit;
  }

  return nextSegmentEdits;
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

function debugSegmentSaveMetric(
  event: string,
  payload: Record<string, unknown>,
) {
  const debugEnabled =
    process.env.NODE_ENV !== "production" ||
    (typeof window !== "undefined" &&
      window.localStorage.getItem("debugSegmentSave") === "1");

  if (!debugEnabled) {
    return;
  }

  console.debug("[save-segment]", {
    event,
    ...payload,
  });
}

function getSegmentPreviewDomId(segmentId: string) {
  return `preview-segment-${segmentId}`;
}
