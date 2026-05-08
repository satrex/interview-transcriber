import { ExpectedSpeakerCountForm } from "@/components/expected-speaker-count-form";
import type { SpeakerAnalysis } from "@/lib/speaker-analysis";

type SpeakerAnalysisPanelProps = {
  analysis: SpeakerAnalysis;
  jobId: string;
};

export function SpeakerAnalysisPanel({
  analysis,
  jobId,
}: SpeakerAnalysisPanelProps) {
  return (
    <section className="mt-8 border-t border-zinc-200 pt-8">
      <div>
        <h2 className="text-xl font-semibold text-zinc-950">話者識別チェック</h2>
        <p className="mt-1 text-sm text-zinc-500">
          speakerごとの発話量を確認します。自動削除や自動統合は行いません。
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

      {analysis.noiseSpeakerCandidates.length > 0 ? (
        <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">noise_speaker 候補があります。</p>
          <ul className="mt-3 space-y-2">
            {analysis.noiseSpeakerCandidates.map((candidate) => (
              <li key={candidate.speakerLabel}>
                <span className="font-mono font-semibold">
                  {candidate.speakerLabel}
                </span>
                : {candidate.reasons.join("、")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.stats.length > 0 ? (
        <div className="mt-5 overflow-x-auto rounded-md border border-zinc-200">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">speaker_label</th>
                <th className="px-3 py-2 font-medium">segments</th>
                <th className="px-3 py-2 font-medium">合計発話秒数</th>
                <th className="px-3 py-2 font-medium">文字数</th>
                <th className="px-3 py-2 font-medium">判定</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {analysis.stats.map((stats) => {
                const candidate = analysis.noiseSpeakerCandidates.find(
                  (item) => item.speakerLabel === stats.speakerLabel,
                );

                return (
                  <tr key={stats.speakerLabel}>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-800">
                      {stats.speakerLabel}
                    </td>
                    <td className="px-3 py-2 text-zinc-800">
                      {stats.segmentCount}
                    </td>
                    <td className="px-3 py-2 text-zinc-800">
                      {stats.totalDurationSec.toFixed(1)} 秒
                    </td>
                    <td className="px-3 py-2 text-zinc-800">
                      {stats.characterCount}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {stats.requiresReview ? (
                          <span className="rounded-md bg-rose-100 px-2 py-1 text-xs font-medium text-rose-900">
                            要確認
                          </span>
                        ) : null}
                        {candidate ? (
                          <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
                            ノイズ候補
                          </span>
                        ) : null}
                        {!stats.requiresReview && !candidate ? (
                          <span className="text-zinc-500">通常</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-5 rounded-md bg-zinc-50 p-4 text-sm text-zinc-600">
          話者識別チェックに使う segment はまだ保存されていません。
        </div>
      )}
    </section>
  );
}
