import type { TranscriptSegment } from "@/lib/transcript";

export type SpeakerAnalysis = {
  expectedSpeakerCount: number;
  speakerCount: number;
  stats: SpeakerStats[];
  noiseSpeakerCandidates: NoiseSpeakerCandidate[];
  mergeTargetOptions: string[];
};

export type SpeakerStats = {
  speakerLabel: string;
  characterCount: number;
  requiresReview: boolean;
  segmentCount: number;
  textFillerCentered: boolean;
  totalDurationSec: number;
};

export type NoiseSpeakerCandidate = SpeakerStats & {
  reasons: string[];
};

const MIN_SPEAKER_DURATION_SECONDS = 3;
const MIN_SPEAKER_SEGMENT_COUNT = 3;

const FILLER_PATTERNS = [
  /^h+m+$/i,
  /^h+u*m+$/i,
  /^u+h+$/i,
  /^u+m+$/i,
  /^a+h+$/i,
  /^え+$/,
  /^えー+$/,
  /^えっと+$/,
  /^あ+$/,
  /^あー+$/,
  /^うん+$/,
  /^ん+$/,
  /^はい+$/,
  /^まあ+$/,
];

export function analyzeSpeakers(
  segments: TranscriptSegment[],
  expectedSpeakerCount: number,
): SpeakerAnalysis {
  const rawStats = buildSpeakerStats(segments);
  const mergeTargetOptions = [...rawStats]
    .sort((left, right) => {
      const durationDiff = right.totalDurationSec - left.totalDurationSec;

      if (durationDiff !== 0) {
        return durationDiff;
      }

      return left.speakerLabel.localeCompare(right.speakerLabel);
    })
    .slice(0, expectedSpeakerCount)
    .map((speakerStats) => speakerStats.speakerLabel);
  const mergeTargetLabels = new Set(mergeTargetOptions);
  const stats = rawStats.map((speakerStats) => ({
    ...speakerStats,
    requiresReview:
      rawStats.length > expectedSpeakerCount
      && !mergeTargetLabels.has(speakerStats.speakerLabel),
  }));
  const noiseSpeakerCandidates = stats
    .map((speakerStats) => ({
      ...speakerStats,
      reasons: buildNoiseCandidateReasons(speakerStats),
    }))
    .filter((candidate) => candidate.reasons.length > 0);

  return {
    expectedSpeakerCount,
    mergeTargetOptions,
    noiseSpeakerCandidates,
    speakerCount: stats.length,
    stats,
  };
}

function buildSpeakerStats(segments: TranscriptSegment[]) {
  const statsBySpeaker = new Map<
    string,
    Omit<SpeakerStats, "requiresReview" | "textFillerCentered"> & {
      fillerSegmentCount: number;
    }
  >();

  for (const segment of segments) {
    const current = statsBySpeaker.get(segment.speakerLabel) || {
      characterCount: 0,
      fillerSegmentCount: 0,
      segmentCount: 0,
      speakerLabel: segment.speakerLabel,
      totalDurationSec: 0,
    };

    current.segmentCount += 1;
    current.characterCount += countCharacters(segment.text);
    current.totalDurationSec += Math.max(0, segment.endSec - segment.startSec);

    if (isFillerOnlyText(segment.text)) {
      current.fillerSegmentCount += 1;
    }

    statsBySpeaker.set(segment.speakerLabel, current);
  }

  return Array.from(statsBySpeaker.values())
    .map(({ fillerSegmentCount, ...stats }) => ({
      ...stats,
      requiresReview: false,
      textFillerCentered:
        stats.segmentCount > 0 && fillerSegmentCount / stats.segmentCount >= 0.7,
      totalDurationSec: roundDuration(stats.totalDurationSec),
    }))
    .sort((left, right) => left.speakerLabel.localeCompare(right.speakerLabel));
}

function buildNoiseCandidateReasons(stats: SpeakerStats) {
  const reasons: string[] = [];

  if (stats.totalDurationSec < MIN_SPEAKER_DURATION_SECONDS) {
    reasons.push(`総発話が${MIN_SPEAKER_DURATION_SECONDS}秒未満`);
  }

  if (stats.segmentCount < MIN_SPEAKER_SEGMENT_COUNT) {
    reasons.push("segment数が2以下");
  }

  if (stats.textFillerCentered) {
    reasons.push("本文が相づち・フィラー中心");
  }

  return reasons;
}

function countCharacters(text: string) {
  return text.replace(/\s+/g, "").length;
}

function isFillerOnlyText(text: string) {
  const tokens = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[、。,.!?！？…・「」『』（）()"'“”‘’:：;；\[\]【】]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return false;
  }

  return tokens.every((token) =>
    FILLER_PATTERNS.some((pattern) => pattern.test(token)),
  );
}

function roundDuration(seconds: number) {
  return Math.round(seconds * 10) / 10;
}
