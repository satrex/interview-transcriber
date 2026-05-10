"use client";

import {
  formatTimestamp,
  type SpeakerNameMap,
  type TranscriptSegment,
} from "@/lib/transcript";
import { useSegmentAudioPlayback } from "./use-segment-audio-playback";

type SegmentAudioPlayerProps = {
  audioUrl: string | null;
  segments: TranscriptSegment[];
  speakerNames?: SpeakerNameMap;
};

export function SegmentAudioPlayer({
  audioUrl,
  segments,
  speakerNames = {},
}: SegmentAudioPlayerProps) {
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
  } = useSegmentAudioPlayback(audioUrl);

  if (segments.length === 0) {
    return null;
  }

  return (
    <section className="mt-8 border-t border-zinc-200 pt-8">
      <div>
        <h2 className="text-xl font-semibold text-zinc-950">segment再生</h2>
        <p className="mt-1 text-sm text-zinc-500">
          各segmentの開始位置から該当区間だけ再生します。
        </p>
      </div>

      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        preload="metadata"
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

      <div className="mt-5 space-y-3">
        {segments.map((segment) => {
          const segmentPlaybackStatus =
            playbackState?.segmentId === segment.id
              ? playbackState.status
              : null;
          const isActive = segmentPlaybackStatus !== null;
          const isPreparing = segmentPlaybackStatus === "preparing";
          const speakerName =
            speakerNames[segment.speakerLabel] || segment.speakerLabel;

          return (
            <article
              key={segment.id}
              className={`rounded-md border p-4 transition ${
                isActive
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-zinc-200 bg-zinc-50"
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <button
                  type="button"
                  onClick={() => void playSegment(segment)}
                  disabled={isPreparing}
                  className={`inline-flex min-h-10 shrink-0 items-center justify-center rounded-md px-4 text-sm font-semibold transition ${
                    isActive
                      ? "bg-emerald-700 text-white hover:bg-emerald-800"
                      : "bg-zinc-950 text-white hover:bg-zinc-800"
                  } disabled:cursor-not-allowed disabled:bg-zinc-400`}
                >
                  {isPreparing ? "準備中..." : isActive ? "停止" : "再生"}
                </button>

                <div className="min-w-0 flex-1 text-sm leading-7 text-zinc-900">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-zinc-500">
                      [{formatTimestamp(segment.startSec)} -{" "}
                      {formatTimestamp(segment.endSec)}]
                    </span>
                    <span className="font-semibold">{speakerName}</span>
                  </div>
                  <p className="mt-2">{segment.text}</p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
