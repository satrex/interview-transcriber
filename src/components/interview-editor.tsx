"use client";

import { useEffect, useRef, useState } from "react";
import {
  SpeakerAnalysisPanel,
  type SpeakerAnalysisPanelProps,
} from "@/components/speaker-analysis-panel";
import {
  TranscriptMarkdown,
  type TranscriptMarkdownProps,
} from "@/components/transcript-markdown";

type InterviewEditorProps = SpeakerAnalysisPanelProps &
  Pick<
    TranscriptMarkdownProps,
    | "audioChunkDurationSec"
    | "audioLoadError"
    | "audioUrl"
    | "exportBaseName"
    | "projectId"
    | "segmentEdits"
    | "segments"
    | "speakerNames"
  >;

export function InterviewEditor({
  analysis,
  audioChunkDurationSec,
  audioLoadError,
  audioUrl,
  exportBaseName,
  jobId,
  projectId,
  segmentEdits,
  segments,
  speakerNames,
  speakers,
}: InterviewEditorProps) {
  const [speakerReturnSegmentId, setSpeakerReturnSegmentId] = useState<
    string | null
  >(null);
  const [
    activeReturnHighlightSegmentId,
    setActiveReturnHighlightSegmentId,
  ] = useState<string | null>(null);
  const returnHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (returnHighlightTimeoutRef.current) {
        clearTimeout(returnHighlightTimeoutRef.current);
      }
    };
  }, []);

  function handleSpeakerLabelClick(segmentId: string, speakerLabel: string) {
    setSpeakerReturnSegmentId(segmentId);

    const speakerSettingElement = document.getElementById(
      `speaker-setting-${speakerLabel}`,
    );

    if (!speakerSettingElement) {
      return;
    }

    speakerSettingElement.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    if (speakerSettingElement instanceof HTMLInputElement) {
      speakerSettingElement.focus({ preventScroll: true });
    }
  }

  function returnToPreviewPosition() {
    if (!speakerReturnSegmentId) {
      return;
    }

    const previewElement = document.getElementById(
      `preview-segment-${speakerReturnSegmentId}`,
    );

    if (!previewElement) {
      return;
    }

    if (returnHighlightTimeoutRef.current) {
      clearTimeout(returnHighlightTimeoutRef.current);
    }

    setActiveReturnHighlightSegmentId(speakerReturnSegmentId);
    setSpeakerReturnSegmentId(null);
    previewElement.scrollIntoView({ behavior: "smooth", block: "center" });

    returnHighlightTimeoutRef.current = setTimeout(() => {
      setActiveReturnHighlightSegmentId(null);
      returnHighlightTimeoutRef.current = null;
    }, 2400);
  }

  return (
    <>
      <SpeakerAnalysisPanel
        analysis={analysis}
        jobId={jobId}
        mixSuspects={segments
          .filter(
            (segment) =>
              segment.mixSuspectBoundarySec !== null &&
              segment.mixSuspectBoundarySec !== undefined,
          )
          .map((segment) => ({
            boundarySec: segment.mixSuspectBoundarySec ?? segment.startSec,
            id: segment.id,
            intruderSpeakerLabel: segment.mixSuspectSpeakerLabel ?? null,
            speakerLabel: segment.speakerLabel,
            startSec: segment.startSec,
            text: segment.text,
          }))}
        onReturnToPreviewPosition={returnToPreviewPosition}
        speakerReturnSegmentId={speakerReturnSegmentId}
        speakerNames={speakerNames}
        speakers={speakers}
      />

      <TranscriptMarkdown
        activeReturnHighlightSegmentId={activeReturnHighlightSegmentId}
        audioChunkDurationSec={audioChunkDurationSec}
        audioLoadError={audioLoadError}
        audioUrl={audioUrl}
        exportBaseName={exportBaseName}
        jobId={jobId}
        onSpeakerLabelClick={handleSpeakerLabelClick}
        projectId={projectId}
        segmentEdits={segmentEdits}
        segments={segments}
        speakerNames={speakerNames}
      />
    </>
  );
}
