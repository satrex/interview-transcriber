"use client";

import { useRef, useState } from "react";
import { type TranscriptSegment } from "@/lib/transcript";

type SegmentPlaybackStatus = "preparing" | "playing";

export type SegmentPlaybackState = {
  segmentId: string;
  status: SegmentPlaybackStatus;
};

type SegmentAudioPlaybackOptions = {
  chunkDurationSec?: number | null;
  initialAudioError?: string | null;
  jobId?: string;
};

type PlaybackIssueSeverity = "debug" | "warn" | "error";

type SignedAudioChunk = {
  chunkDurationSec: number;
  chunkIndex: number;
  chunkPath: string;
  contentLength: string | null;
  contentType: string | null;
  signedUrl: string;
  signedUrlProbeStatus: number | null;
  signedUrlWasFetched: boolean;
};

type SignedAudioProbe = {
  contentLength: string | null;
  contentType: string | null;
  status: number | null;
  wasFetched: boolean;
};

type SegmentAudioSource = {
  chunkDurationSec: number | null;
  chunkIndex: number | null;
  contentLength: string | null;
  contentType: string | null;
  chunkLocalEnd: number | null;
  chunkLocalStart: number | null;
  chunkPath: string | null;
  endSec: number;
  mode: "chunk" | "source-fallback";
  signedUrlProbeStatus: number | null;
  signedUrlWasFetched: boolean;
  startSec: number;
  url: string;
};

type ActivePlaybackSegment = {
  segment: TranscriptSegment;
  source: SegmentAudioSource;
};

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
  const { chunkDurationSec = null, initialAudioError = null, jobId = null } =
    options;
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeSegmentRef = useRef<ActivePlaybackSegment | null>(null);
  const lastPlaybackRef = useRef<ActivePlaybackSegment | null>(null);
  const chunkSignedUrlCacheRef = useRef<Map<number, SignedAudioChunk>>(new Map());
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

    if (!audio) {
      setAudioErrorMessage(AUDIO_ERROR_MESSAGE);
      return;
    }

    if (!audioUrl && (!jobId || !chunkDurationSec)) {
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

    targetSeekTimeRef.current = Math.max(0, segment.startSec);
    setPlaybackState({ segmentId: segment.id, status: "preparing" });
    setAudioErrorMessage(null);

    try {
      const source = await resolveSegmentAudioSource({
        audioUrl,
        chunkDurationSec,
        chunkSignedUrlCache: chunkSignedUrlCacheRef.current,
        jobId,
        segment,
      });

      if (requestIdRef.current !== requestId) {
        return;
      }

      activeSegmentRef.current = { segment, source };
      lastPlaybackRef.current = { segment, source };
      applyAudioSource(audio, source.url);
      await ensureAudioMetadata(audio);

      if (requestIdRef.current !== requestId) {
        return;
      }

      const targetSeekTime = getPlayableStartSec(source.startSec, audio);
      targetSeekTimeRef.current = targetSeekTime;
      audio.currentTime = targetSeekTime;
      await waitForAudioReadyAfterSeek(audio);

      if (requestIdRef.current !== requestId) {
        return;
      }

      logSegmentPlaybackPrepared({
        audio,
        jobId,
        segment,
        source,
        targetSeekTime,
      });
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
        playback: activeSegmentRef.current ?? lastPlaybackRef.current ?? { segment, source: null },
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
    const playback = activeSegmentRef.current ?? lastPlaybackRef.current;

    if (audio) {
      logSegmentPlaybackIssue({
        audio,
        error: audio.error,
        jobId,
        severity: getMediaErrorSeverity(audio.error),
        playback,
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
    const activePlayback = activeSegmentRef.current;

    if (!audio || !activePlayback) {
      return;
    }

    if (audio.currentTime >= activePlayback.source.endSec) {
      audio.pause();
      audio.currentTime = activePlayback.source.endSec;
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

async function resolveSegmentAudioSource({
  audioUrl,
  chunkDurationSec,
  chunkSignedUrlCache,
  jobId,
  segment,
}: {
  audioUrl: string | null;
  chunkDurationSec: number | null;
  chunkSignedUrlCache: Map<number, SignedAudioChunk>;
  jobId: string | null;
  segment: TranscriptSegment;
}): Promise<SegmentAudioSource> {
  if (jobId && chunkDurationSec && chunkDurationSec > 0) {
    const chunkIndex = Math.max(0, Math.floor(segment.startSec / chunkDurationSec));
    const chunkLocalStart = Math.max(0, segment.startSec - chunkIndex * chunkDurationSec);
    const chunkLocalEnd = Math.min(
      chunkDurationSec,
      Math.max(chunkLocalStart, segment.endSec - chunkIndex * chunkDurationSec),
    );

    try {
      const chunk = await fetchSignedAudioChunk({
        chunkIndex,
        chunkSignedUrlCache,
        jobId,
      });
      const source = {
        chunkDurationSec: chunk.chunkDurationSec,
        chunkIndex,
        contentLength: chunk.contentLength,
        contentType: chunk.contentType,
        chunkLocalEnd,
        chunkLocalStart,
        chunkPath: chunk.chunkPath,
        endSec: chunkLocalEnd,
        mode: "chunk" as const,
    signedUrlProbeStatus: chunk.signedUrlProbeStatus,
    signedUrlWasFetched: chunk.signedUrlWasFetched,
        startSec: chunkLocalStart,
        url: chunk.signedUrl,
      };

      console.debug("[segment audio] using chunk source", {
        chunkIndex: source.chunkIndex,
        contentLength: source.contentLength,
        contentType: source.contentType,
        chunkLocalEnd: source.chunkLocalEnd,
        chunkLocalStart: source.chunkLocalStart,
        chunkPath: source.chunkPath,
        segmentEnd: segment.endSec,
        segmentId: segment.id,
        segmentStart: segment.startSec,
      });

      return source;
    } catch (error) {
      console.warn("[segment audio] chunk source unavailable; falling back to source audio", {
        chunkIndex,
        chunkLocalEnd,
        chunkLocalStart,
        error: error instanceof Error ? error.message : String(error),
        jobId,
        segmentEnd: segment.endSec,
        segmentId: segment.id,
        segmentStart: segment.startSec,
      });
    }
  }

  if (!audioUrl) {
    throw new Error("Source audio signed URL is not available.");
  }

  const sourceProbe = await probeSignedAudioUrl({
    label: "source audio",
    path: null,
    signedUrl: audioUrl,
  });

  return {
    chunkDurationSec: null,
    chunkIndex: null,
    contentLength: sourceProbe.contentLength,
    contentType: sourceProbe.contentType,
    chunkLocalEnd: null,
    chunkLocalStart: null,
    chunkPath: null,
    endSec: segment.endSec,
    mode: "source-fallback",
    signedUrlProbeStatus: sourceProbe.status,
    signedUrlWasFetched: sourceProbe.wasFetched,
    startSec: segment.startSec,
    url: audioUrl,
  };
}

function logSegmentPlaybackPrepared({
  audio,
  jobId,
  segment,
  source,
  targetSeekTime,
}: {
  audio: HTMLAudioElement;
  jobId: string | null;
  segment: TranscriptSegment;
  source: SegmentAudioSource;
  targetSeekTime: number;
}) {
  console.debug("[segment audio] playback prepared", {
    chunkIndex: source.chunkIndex,
    contentLength: source.contentLength,
    contentType: source.contentType,
    chunkLocalEnd: source.chunkLocalEnd,
    chunkLocalStart: source.chunkLocalStart,
    chunkPath: source.chunkPath,
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : null,
    duration: Number.isFinite(audio.duration) ? audio.duration : null,
    jobId,
    networkState: audio.networkState,
    readyState: audio.readyState,
    segmentEnd: segment.endSec,
    segmentId: segment.id,
    segmentStart: segment.startSec,
    sourceMode: source.mode,
    signedUrlProbeStatus: source.signedUrlProbeStatus,
    signedUrlWasFetched: source.signedUrlWasFetched,
    targetSeekTime,
  });
}

async function fetchSignedAudioChunk({
  chunkIndex,
  chunkSignedUrlCache,
  jobId,
}: {
  chunkIndex: number;
  chunkSignedUrlCache: Map<number, SignedAudioChunk>;
  jobId: string;
}) {
  const cached = chunkSignedUrlCache.get(chunkIndex);

  if (cached) {
    console.debug("[segment audio] using cached chunk signed URL", {
      chunkIndex: cached.chunkIndex,
      chunkPath: cached.chunkPath,
      contentLength: cached.contentLength,
      contentType: cached.contentType,
      signedUrlProbeStatus: cached.signedUrlProbeStatus,
      signedUrlWasFetched: cached.signedUrlWasFetched,
    });
    return cached;
  }

  const response = await fetch(
    `/jobs/${encodeURIComponent(jobId)}/audio-chunks/${chunkIndex}`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Chunk signed URL request failed with status ${response.status}`);
  }

  const data = (await response.json()) as Partial<SignedAudioChunk>;

  if (
    typeof data.signedUrl !== "string" ||
    typeof data.chunkPath !== "string" ||
    typeof data.chunkDurationSec !== "number" ||
    typeof data.chunkIndex !== "number"
  ) {
    throw new Error("Chunk signed URL response was incomplete.");
  }

  const probe = await probeSignedAudioUrl({
    chunkIndex: data.chunkIndex,
    label: "chunk audio",
    path: data.chunkPath,
    signedUrl: data.signedUrl,
  });
  const chunk = {
    chunkDurationSec: data.chunkDurationSec,
    chunkIndex: data.chunkIndex,
    chunkPath: data.chunkPath,
    contentLength: probe.contentLength,
    contentType: probe.contentType,
    signedUrl: data.signedUrl,
    signedUrlProbeStatus: probe.status,
    signedUrlWasFetched: true,
  };

  chunkSignedUrlCache.set(chunkIndex, chunk);
  return chunk;
}

async function probeSignedAudioUrl({
  chunkIndex,
  label,
  path,
  signedUrl,
}: {
  chunkIndex?: number;
  label: string;
  path: string | null;
  signedUrl: string;
}): Promise<SignedAudioProbe> {
  if (process.env.NODE_ENV === "production") {
    return {
      contentLength: null,
      contentType: null,
      status: null,
      wasFetched: true,
    };
  }

  let response: Response;

  try {
    response = await fetch(signedUrl, {
      cache: "no-store",
      method: "HEAD",
    });
  } catch (error) {
    console.warn(`[segment audio] ${label} signed URL HEAD failed`, {
      chunkIndex,
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`${label} HEAD check failed.`);
  }

  const contentType = response.headers.get("content-type");
  const contentLength = response.headers.get("content-length");
  const probeDetails = {
    chunkIndex,
    contentLength,
    contentType,
    path,
    status: response.status,
  };

  console.debug(`[segment audio] ${label} signed URL HEAD`, probeDetails);

  if (!response.ok) {
    const notFoundMessage =
      response.status === 404
        ? `${label} not found`
        : `${label} unavailable`;
    console.warn(`[segment audio] ${notFoundMessage}`, probeDetails);
    throw new Error(
      `${label} HEAD check failed with status ${response.status}.`,
    );
  }

  if (isProbablyHtmlOrJson(contentType)) {
    console.warn(`[segment audio] ${label} signed URL returned non-audio content`, {
      ...probeDetails,
      reason: "json-or-html-content-type",
    });
    throw new Error(`${label} has invalid content type: ${contentType}.`);
  }

  return {
    contentLength,
    contentType,
    status: response.status,
    wasFetched: true,
  };
}

function isProbablyHtmlOrJson(contentType: string | null) {
  if (!contentType) {
    return false;
  }

  const normalized = contentType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("text/html");
}

function applyAudioSource(audio: HTMLAudioElement, url: string) {
  if (audio.src === url) {
    return;
  }

  audio.src = url;
  audio.load();
}

function waitForAudioReadyAfterSeek(audio: HTMLAudioElement) {
  if (audio.readyState >= 3) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while preparing audio seek."));
    }, 15000);

    function cleanup() {
      window.clearTimeout(timeoutId);
      audio.removeEventListener("canplay", handleReady);
      audio.removeEventListener("seeked", handleReady);
      audio.removeEventListener("error", handleError);
    }

    function handleReady() {
      cleanup();
      resolve();
    }

    function handleError() {
      cleanup();
      reject(audio.error ?? new Error("Audio failed while preparing seek."));
    }

    audio.addEventListener("canplay", handleReady, { once: true });
    audio.addEventListener("seeked", handleReady, { once: true });
    audio.addEventListener("error", handleError, { once: true });
  });
}

function logSegmentPlaybackIssue({
  audio,
  error,
  jobId,
  playback,
  severity,
  src,
  targetSeekTime,
}: {
  audio: HTMLAudioElement;
  error: unknown;
  jobId: string | null;
  playback: ActivePlaybackSegment | { segment: TranscriptSegment; source: null } | null;
  severity: PlaybackIssueSeverity;
  src: string | null;
  targetSeekTime: number | null;
}) {
  const details = buildSegmentPlaybackLogDetails({
    audio,
    error,
    jobId,
    playback,
    src,
    targetSeekTime,
  });
  const message = getPlaybackLogMessage(audio.error, severity);

  if (severity === "debug") {
    console.debug(message, details);
    console.debug(`${message} details`, JSON.stringify(details));
    return;
  }

  if (severity === "warn") {
    console.warn(message, details);
    console.warn(`${message} details`, JSON.stringify(details));
    return;
  }

  console.error(message, details);
  console.error(`${message} details`, JSON.stringify(details));
}

function buildSegmentPlaybackLogDetails({
  audio,
  error,
  jobId,
  playback,
  src,
  targetSeekTime,
}: {
  audio: HTMLAudioElement;
  error: unknown;
  jobId: string | null;
  playback: ActivePlaybackSegment | { segment: TranscriptSegment; source: null } | null;
  src: string | null;
  targetSeekTime: number | null;
}) {
  const segment = playback?.segment ?? null;
  const source = playback?.source ?? null;

  return {
    audioErrorCode: audio.error?.code ?? null,
    audioErrorMessage: audio.error?.message || null,
    chunkIndex: source?.chunkIndex ?? null,
    chunkContentLength: source?.contentLength ?? null,
    chunkContentType: source?.contentType ?? null,
    chunkLocalEnd: source?.chunkLocalEnd ?? null,
    chunkLocalStart: source?.chunkLocalStart ?? null,
    chunkPath: source?.chunkPath ?? null,
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
    sourceMode: source?.mode ?? "none",
    signedUrlProbeStatus: source?.signedUrlProbeStatus ?? null,
    signedUrlWasFetched: source?.signedUrlWasFetched ?? false,
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

function getPlayableStartSec(startSec: number, audio: HTMLAudioElement) {
  const playableStartSec = Math.max(0, startSec);

  if (!Number.isFinite(audio.duration)) {
    return playableStartSec;
  }

  return Math.min(playableStartSec, audio.duration);
}
