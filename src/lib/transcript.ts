export type TranscriptSegment = {
  id: string;
  speakerLabel: string;
  startSec: number;
  endSec: number;
  text: string;
  chunkIndex: number;
};

export type SpeakerNameMap = Record<string, string>;

export type TranscriptBlock = {
  speakerLabel: string;
  speakerName: string;
  startSec: number;
  endSec: number;
  text: string;
};

export function buildTranscriptBlocks(
  segments: TranscriptSegment[],
  speakerNames: SpeakerNameMap = {},
) {
  const speakerLabels = createSpeakerLabels(segments, speakerNames);
  const blocks: TranscriptBlock[] = [];

  for (const segment of segments) {
    const speakerName = speakerLabels[segment.speakerLabel] || segment.speakerLabel;
    const previous = blocks.at(-1);

    if (previous && previous.speakerLabel === segment.speakerLabel) {
      previous.endSec = Math.max(previous.endSec, segment.endSec);
      previous.text = joinText(previous.text, segment.text);
      continue;
    }

    blocks.push({
      speakerLabel: segment.speakerLabel,
      speakerName,
      startSec: segment.startSec,
      endSec: segment.endSec,
      text: segment.text,
    });
  }

  return blocks;
}

export function buildTranscriptMarkdown(
  blocks: TranscriptBlock[],
  options: {
    showTimestamps: boolean;
  },
) {
  return blocks
    .map((block) => {
      const timestamp = options.showTimestamps
        ? `[${formatTimestamp(block.startSec)}] `
        : "";

      return `${timestamp}${block.speakerName}：${block.text}`;
    })
    .join("\n\n");
}

export function formatTimestamp(totalSeconds: number) {
  const safeTotalSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeTotalSeconds / 3600);
  const minutes = Math.floor((safeTotalSeconds % 3600) / 60);
  const seconds = safeTotalSeconds % 60;

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  return `${pad(minutes)}:${pad(seconds)}`;
}

function createSpeakerLabels(
  segments: TranscriptSegment[],
  speakerNames: SpeakerNameMap,
) {
  const labels: SpeakerNameMap = { ...speakerNames };
  let nextLabelIndex = 0;

  for (const segment of segments) {
    if (labels[segment.speakerLabel]) {
      continue;
    }

    labels[segment.speakerLabel] = `話者${speakerIndexToLabel(nextLabelIndex)}`;
    nextLabelIndex += 1;
  }

  return labels;
}

function speakerIndexToLabel(index: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let value = index;
  let label = "";

  do {
    label = alphabet[value % alphabet.length] + label;
    value = Math.floor(value / alphabet.length) - 1;
  } while (value >= 0);

  return label;
}

function joinText(current: string, next: string) {
  const trimmedCurrent = current.trim();
  const trimmedNext = next.trim();

  if (!trimmedCurrent) {
    return trimmedNext;
  }

  if (!trimmedNext) {
    return trimmedCurrent;
  }

  return `${trimmedCurrent}\n${trimmedNext}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
