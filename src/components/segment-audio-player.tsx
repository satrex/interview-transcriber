"use client";

import { useRef, useState } from "react";
import {
  formatTimestamp,
  type SpeakerNameMap,
  type TranscriptSegment,
} from "@/lib/transcript";

type SegmentAudioPlayerProps = {
  audioUrl: string;
  segments: TranscriptSegment[];
  speakerNames?: SpeakerNameMap;
};

export function SegmentAudioPlayer({
  audioUrl,
  segments,
  speakerNames = {},
}: SegmentAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeSegmentRef = useRef<TranscriptSegment | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);

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
        src={audioUrl}
        preload="metadata"
        onTimeUpdate={stopAtSegmentEnd}
        onEnded={clearActiveSegment}
        onPause={clearActiveSegment}
      />

      <div className="mt-5 space-y-3">
        {segments.map((segment) => {
          const isActive = activeSegmentId === segment.id;
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
                  className={`inline-flex min-h-10 shrink-0 items-center justify-center rounded-md px-4 text-sm font-semibold transition ${
                    isActive
                      ? "bg-emerald-700 text-white hover:bg-emerald-800"
                      : "bg-zinc-950 text-white hover:bg-zinc-800"
                  }`}
                >
                  {isActive ? "停止" : "再生"}
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
