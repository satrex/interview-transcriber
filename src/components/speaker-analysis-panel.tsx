"use client";

import { useActionState } from "react";
import {
  saveSpeakerNames,
  type SpeakerNamesActionState,
} from "@/app/actions";
import { ExpectedSpeakerCountForm } from "@/components/expected-speaker-count-form";
import type { SpeakerAnalysis } from "@/lib/speaker-analysis";

export type SpeakerNameFormRow = {
  speakerLabel: string;
  displayName: string;
};

type SpeakerAnalysisPanelProps = {
  analysis: SpeakerAnalysis;
  jobId: string;
  speakers: SpeakerNameFormRow[];
};

const initialState: SpeakerNamesActionState = {
  error: null,
  success: false,
};

export function SpeakerAnalysisPanel({
  analysis,
  jobId,
  speakers,
}: SpeakerAnalysisPanelProps) {
  const [state, formAction, pending] = useActionState(
    saveSpeakerNames,
    initialState,
  );
  const rows = speakers.map((speaker) => {
    const stats = analysis.stats.find(
      (item) => item.speakerLabel === speaker.speakerLabel,
    );
    const candidate = analysis.noiseSpeakerCandidates.find(
      (item) => item.speakerLabel === speaker.speakerLabel,
    );

    return {
      candidate,
      speaker,
      stats,
    };
  });

  return (
    <section className="mt-8 border-t border-zinc-200 pt-8">
      <div>
        <h2 className="text-xl font-semibold text-zinc-950">話者設定</h2>
        <p className="mt-1 text-sm text-zinc-500">
          speaker_label と表示名、発話量、要確認判定を同じ表で確認します。
        </p>
      </div>

      <ExpectedSpeakerCountForm
        expectedSpeakerCount={analysis.expectedSpeakerCount}
        jobId={jobId}
      />

      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-md bg-zinc-50 p-3">
          <p className="text-zinc-500">検出された話者数</p>
          <p className="mt-1 font-medium text-zinc-950">
            {analysis.speakerCount} / 想定 {analysis.expectedSpeakerCount}
          </p>
        </div>
        <div className="rounded-md bg-zinc-50 p-3">
          <p className="text-zinc-500">将来の統合先候補</p>
          <p className="mt-1 break-all font-mono text-xs text-zinc-800">
            {analysis.mergeTargetOptions.length > 0
              ? analysis.mergeTargetOptions.join(", ")
              : "未検出"}
          </p>
        </div>
      </div>

      {analysis.speakerCount > analysis.expectedSpeakerCount ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          想定より多い話者ラベルが検出されています。超過分は「要確認」として表示します。
        </p>
      ) : null}

      {rows.length > 0 ? (
        <form action={formAction} className="mt-5 space-y-4">
          <input type="hidden" name="jobId" value={jobId} />

          <div className="overflow-x-auto rounded-md border border-zinc-200">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">label / display_name</th>
                  <th className="px-3 py-2 font-medium">segments</th>
                  <th className="px-3 py-2 font-medium">合計発話秒数</th>
                  <th className="px-3 py-2 font-medium">文字数</th>
                  <th className="px-3 py-2 font-medium">判定</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 bg-white">
                {rows.map(({ candidate, speaker, stats }) => (
                  <tr key={speaker.speakerLabel}>
                    <td className="px-3 py-2">
                      <div className="grid grid-cols-[max-content_minmax(10rem,1fr)] items-center gap-2">
                        <label
                          htmlFor={`speaker-${speaker.speakerLabel}`}
                          className="min-w-8 break-all font-mono text-sm font-semibold text-zinc-900"
                        >
                          {speaker.speakerLabel}
                        </label>
                        <input
                          id={`speaker-${speaker.speakerLabel}`}
                          name="displayName"
                          type="text"
                          defaultValue={speaker.displayName}
                          placeholder="表示名"
                          className="min-h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900"
                        />
                        <input
                          type="hidden"
                          name="speakerLabel"
                          value={speaker.speakerLabel}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-zinc-800">
                      {stats?.segmentCount ?? 0}
                    </td>
                    <td className="px-3 py-2 text-zinc-800">
                      {stats ? `${stats.totalDurationSec.toFixed(1)} 秒` : "0.0 秒"}
                    </td>
                    <td className="px-3 py-2 text-zinc-800">
                      {stats?.characterCount ?? 0}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {stats?.requiresReview ? (
                          <span className="rounded-md bg-rose-100 px-2 py-1 text-xs font-medium text-rose-900">
                            要確認
                          </span>
                        ) : null}
                        {candidate ? (
                          <span
                            className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900"
                            title={candidate.reasons.join("、")}
                          >
                            ノイズ候補
                          </span>
                        ) : null}
                        {!stats?.requiresReview && !candidate ? (
                          <span className="text-zinc-500">通常</span>
                        ) : null}
                        {candidate ? (
                          <span className="text-xs text-zinc-500">
                            {candidate.reasons.join("、")}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {state.error ? (
            <p
              aria-live="polite"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {state.error}
            </p>
          ) : null}

          {state.success ? (
            <p className="text-sm text-emerald-700" aria-live="polite">
              話者名を保存しました。
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {pending ? "保存中..." : "話者名を保存"}
          </button>
        </form>
      ) : (
        <div className="mt-5 rounded-md bg-zinc-50 p-4 text-sm text-zinc-600">
          話者ラベルはまだ検出されていません。
        </div>
      )}
    </section>
  );
}
