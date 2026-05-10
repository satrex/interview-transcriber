"use client";

import { useRef, useState } from "react";
import { type TranscriptSegment } from "@/lib/transcript";

type SegmentPlaybackStatus = "preparing" | "playing";

export type SegmentPlaybackState = {
  segmentId: string;
  status: SegmentPlaybackStatus;
};

type SegmentAudioPlaybackOptions = {
  initialAudioError?: string | null;
  jobId?: string;
};

type PlaybackIssueSeverity = "debug" | "warn" | "error";

const MEDIA_ERROR_CODE = {
  MEDIA_ERR_ABORTED: 1,
  MEDIA_ERR_NETWORK: 2,
  MEDIA_ERR_DECODE: 3,
  MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
} as const;

const AUDIO_ERROR_MESSAGE =
  "音声を再生できませんでした。詳細はコンソールを確認してください。";

export function useSegmentAudioPlayback(
  audioUrl: string | null,
  options: SegmentAudioPlaybackOptions = {},
) {
  const { initialAudioError = null, jobId = null } = options;
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeSegmentRef = useRef<TranscriptSegment | null>(null);
  const requestIdRef = useRef(0);
  const targetSeekTimeRef = useRef<number | null>(null);
  const playbackStateRef = useRef<SegmentPlaybackState | null>(null);
  const [audioErrorMessage, setAudioErrorMessage] = useState<string | null>(
    initialAudioError,
  );
  const [playbackState, setPlaybackStateValue] =
    useState<SegmentPlaybackState | null>(null);

  function setPlaybackState(nextState: SegmentPlaybackState | null) {
    playbackStateRef.current = nextState;
    setPlaybackStateValue(nextState);
  }

  function clearActiveSegment() {
    requestIdRef.current += 1;
    activeSegmentRef.current = null;
    targetSeekTimeRef.current = null;
    setPlaybackState(null);
  }

  async function playSegment(segment: TranscriptSegment) {
    const audio = audioRef.current;
    const currentState = playbackStateRef.current;

    if (!audio || !audioUrl) {
      setAudioErrorMessage(AUDIO_ERROR_MESSAGE);
      return;
    }

    if (currentState?.segmentId === segment.id) {
      if (currentState.status === "preparing") {
        return;
      }

      audio.pause();
      clearActiveSegment();
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!audio.paused) {
      audio.pause();
    }

    activeSegmentRef.current = segment;
    targetSeekTimeRef.current = Math.max(0, segment.startSec);
    setPlaybackState({ segmentId: segment.id, status: "preparing" });
    setAudioErrorMessage(null);

    try {
      await ensureAudioMetadata(audio);

      if (requestIdRef.current !== requestId) {
        return;
      }

      const targetSeekTime = getPlayableStartSec(segment, audio);
      targetSeekTimeRef.current = targetSeekTime;
      audio.currentTime = targetSeekTime;
      await audio.play();

      if (requestIdRef.current !== requestId) {
        return;
      }

      setPlaybackState({ segmentId: segment.id, status: "playing" });
      setAudioErrorMessage(null);
    } catch (error) {
      const isStaleRequest = requestIdRef.current !== requestId;
      const playbackIssue = classifyPlaybackIssue(audio, error, isStaleRequest);

      logSegmentPlaybackIssue({
        audio,
        error,
        jobId,
        severity: playbackIssue.severity,
        segment,
        src: audioUrl,
        targetSeekTime: targetSeekTimeRef.current,
      });

      if (isStaleRequest) {
        return;
      }

      if (playbackIssue.isFatal) {
        setAudioErrorMessage(AUDIO_ERROR_MESSAGE);
      }

      clearActiveSegment();
    }
  }

  function handleAudioError() {
    const audio = audioRef.current;
    const segment = activeSegmentRef.current;

    if (audio) {
      logSegmentPlaybackIssue({
        audio,
        error: audio.error,
        jobId,
        severity: getMediaErrorSeverity(audio.error),
        segment,
        src: audioUrl,
        targetSeekTime: targetSeekTimeRef.current,
      });
    }

    if (audio?.error?.code !== MEDIA_ERROR_CODE.MEDIA_ERR_ABORTED) {
      setAudioErrorMessage(AUDIO_ERROR_MESSAGE);
    }

    clearActiveSegment();
  }

  function handleAudioPause() {
    if (playbackStateRef.current?.status !== "playing") {
      return;
    }

    clearActiveSegment();
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

  return {
    audioErrorMessage,
    audioRef,
    clearActiveSegment,
    handleAudioError,
    handleAudioPause,
    playSegment,
    playbackState,
    setAudioErrorMessage,
    stopAtSegmentEnd,
  };
}

function ensureAudioMetadata(audio: HTMLAudioElement) {
  if (audio.readyState >= 1) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while loading audio metadata."));
    }, 10000);

    function cleanup() {
      window.clearTimeout(timeoutId);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("error", handleError);
    }

    function handleLoadedMetadata() {
      cleanup();
      resolve();
    }

    function handleError() {
      cleanup();
      reject(audio.error ?? new Error("Audio metadata failed to load."));
    }

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("error", handleError);
    audio.load();
  });
}

function logSegmentPlaybackIssue({
  audio,
  error,
  jobId,
  severity,
  segment,
  src,
  targetSeekTime,
}: {
  audio: HTMLAudioElement;
  error: unknown;
  jobId: string | null;
  severity: PlaybackIssueSeverity;
  segment: TranscriptSegment | null;
  src: string | null;
  targetSeekTime: number | null;
}) {
  const details = buildSegmentPlaybackLogDetails({
    audio,
    error,
    jobId,
    segment,
    src,
    targetSeekTime,
  });
  const message = getPlaybackLogMessage(audio.error, severity);

  if (severity === "debug") {
    console.debug(message, details);
    return;
  }

  if (severity === "warn") {
    console.warn(message, details);
    return;
  }

  console.error(message, details);
}

function buildSegmentPlaybackLogDetails({
  audio,
  error,
  jobId,
  segment,
  src,
  targetSeekTime,
}: {
  audio: HTMLAudioElement;
  error: unknown;
  jobId: string | null;
  segment: TranscriptSegment | null;
  src: string | null;
  targetSeekTime: number | null;
}) {
  return {
    audioErrorCode: audio.error?.code ?? null,
    audioErrorMessage: audio.error?.message || null,
    currentSrc: audio.currentSrc || null,
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : null,
    duration: Number.isFinite(audio.duration) ? audio.duration : null,
    error: serializePlaybackError(error),
    jobId,
    mediaErrorName: getMediaErrorName(audio.error?.code ?? null),
    networkState: audio.networkState,
    readyState: audio.readyState,
    segmentEnd: segment?.endSec ?? null,
    segmentId: segment?.id ?? null,
    segmentStart: segment?.startSec ?? null,
    src: audio.src || src,
    targetSeekTime,
  };
}

function serializePlaybackError(error: unknown) {
  if (!error) {
    return null;
  }

  if (error instanceof DOMException) {
    return {
      code: error.code,
      message: error.message,
      name: error.name,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  if (isMediaError(error)) {
    return {
      code: error.code,
      mediaErrorName: getMediaErrorName(error.code),
      message: error.message || null,
    };
  }

  return {
    message: String(error),
  };
}

function classifyPlaybackIssue(
  audio: HTMLAudioElement,
  error: unknown,
  isStaleRequest: boolean,
) {
  if (isStaleRequest || isUserInterruptedPlayback(error)) {
    return { isFatal: false, severity: "debug" as const };
  }

  if (audio.error?.code === MEDIA_ERROR_CODE.MEDIA_ERR_ABORTED) {
    return { isFatal: false, severity: "warn" as const };
  }

  return {
    isFatal: true,
    severity: getMediaErrorSeverity(audio.error),
  };
}

function getMediaErrorSeverity(error: MediaError | null) {
  if (error?.code === MEDIA_ERROR_CODE.MEDIA_ERR_ABORTED) {
    return "warn" as const;
  }

  return "error" as const;
}

function getPlaybackLogMessage(
  error: MediaError | null,
  severity: PlaybackIssueSeverity,
) {
  if (severity === "debug") {
    return "[segment audio] playback interrupted";
  }

  switch (error?.code) {
    case MEDIA_ERROR_CODE.MEDIA_ERR_ABORTED:
      return "[segment audio] media aborted";
    case MEDIA_ERROR_CODE.MEDIA_ERR_NETWORK:
      return "[segment audio] media network error";
    case MEDIA_ERROR_CODE.MEDIA_ERR_DECODE:
      return "[segment audio] media decode error";
    case MEDIA_ERROR_CODE.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "[segment audio] media source not supported";
    default:
      return "[segment audio] playback failed";
  }
}

function getMediaErrorName(code: number | null) {
  switch (code) {
    case MEDIA_ERROR_CODE.MEDIA_ERR_ABORTED:
      return "MEDIA_ERR_ABORTED";
    case MEDIA_ERROR_CODE.MEDIA_ERR_NETWORK:
      return "MEDIA_ERR_NETWORK";
    case MEDIA_ERROR_CODE.MEDIA_ERR_DECODE:
      return "MEDIA_ERR_DECODE";
    case MEDIA_ERROR_CODE.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "MEDIA_ERR_SRC_NOT_SUPPORTED";
    default:
      return null;
  }
}

function isMediaError(error: unknown): error is MediaError {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (
    "code" in error &&
    typeof error.code === "number" &&
    "message" in error
  );
}

function isUserInterruptedPlayback(error: unknown) {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }

  if (error && typeof error === "object" && "name" in error) {
    return error.name === "AbortError";
  }

  return false;
}

function getPlayableStartSec(segment: TranscriptSegment, audio: HTMLAudioElement) {
  const startSec = Math.max(0, segment.startSec);

  if (!Number.isFinite(audio.duration)) {
    return startSec;
  }

  return Math.min(startSec, audio.duration);
}
