import type {
  SegmentEditMap,
  TranscriptSegment,
} from "@/lib/transcript";

export type BackchannelMode = "keep" | "inline" | "hide";

export const BACKCHANNEL_MAX_DURATION_SEC = 2.0;
export const BACKCHANNEL_MAX_CHARS = 8;
const BACKCHANNEL_MAX_SANDWICH_GAP_SEC = 15;

export const FILLER_PATTERNS = [
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
  /^なるほど$/,
  /^そうですね$/,
  /^そうなんですね$/,
  /^ですよね$/,
  /^たしかに$/,
  /^へえ+$/,
  /^ほう+$/,
  /^ふ+ん+$/,
];

export function classifyBackchannels(
  segments: TranscriptSegment[],
  segmentEdits: SegmentEditMap,
): Set<string> {
  const ids = new Set<string>();
  const visibleSegments = segments.filter(
    (segment) => !segmentEdits[segment.id]?.isSkipped,
  );

  for (let index = 1; index < visibleSegments.length - 1; index++) {
    const previous = visibleSegments[index - 1];
    const segment = visibleSegments[index];
    const next = visibleSegments[index + 1];

    if (!previous || !segment || !next) {
      continue;
    }

    const edit = segmentEdits[segment.id];

    if (edit?.editedText !== null && edit?.editedText !== undefined) {
      continue;
    }

    if (edit?.speakerOverride) {
      continue;
    }

    const durationSec = Math.max(0, segment.endSec - segment.startSec);
    const compactText = compactBackchannelText(segment.text);

    if (
      durationSec > BACKCHANNEL_MAX_DURATION_SEC ||
      compactText.length > BACKCHANNEL_MAX_CHARS ||
      !isFillerOnlyText(segment.text)
    ) {
      continue;
    }

    if (
      previous.speakerLabel !== next.speakerLabel ||
      segment.speakerLabel === previous.speakerLabel
    ) {
      continue;
    }

    if (next.startSec - previous.endSec > BACKCHANNEL_MAX_SANDWICH_GAP_SEC) {
      continue;
    }

    ids.add(segment.id);
  }

  return ids;
}

export function isFillerOnlyText(text: string) {
  const tokens = tokenizeFillerText(text);

  if (tokens.length === 0) {
    return false;
  }

  return tokens.every((token) =>
    FILLER_PATTERNS.some((pattern) => pattern.test(token)),
  );
}

function tokenizeFillerText(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[、。,.!?！？…・「」『』（）()"'“”‘’:：;；\[\]【】]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function compactBackchannelText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[\s、。,.!?！？…・「」『』（）()"'“”‘’:：;；\[\]【】]/g, "")
    .trim();
}
