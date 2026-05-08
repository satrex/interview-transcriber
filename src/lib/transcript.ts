export type TranscriptSegment = {
  id: string;
  speakerLabel: string;
  startSec: number;
  endSec: number;
  text: string;
  chunkIndex: number;
};

export type SpeakerNameMap = Record<string, string>;

export type SegmentEdit = {
  editedText: string | null;
  isSkipped: boolean;
};

export type SegmentEditMap = Record<string, SegmentEdit>;

export type TranscriptBlock = {
  speakerLabel: string;
  speakerName: string;
  startSec: number;
  endSec: number;
  paragraphs: string[];
};

const DEFAULT_PARAGRAPH_MAX_LENGTH = 360;

export function buildTranscriptBlocks(
  segments: TranscriptSegment[],
  speakerNames: SpeakerNameMap = {},
) {
  const blocks: Array<Omit<TranscriptBlock, "paragraphs"> & { text: string }> = [];

  for (const segment of segments) {
    const speakerName = speakerNames[segment.speakerLabel] || segment.speakerLabel;
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
      text: normalizeSegmentText(segment.text),
    });
  }

  return blocks.map(({ text, ...block }) => ({
    ...block,
    paragraphs: splitIntoParagraphs(text),
  }));
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
      const firstParagraph = block.paragraphs[0] || "";
      const restParagraphs = block.paragraphs.slice(1);

      return [
        `${timestamp}**${block.speakerName}**：${firstParagraph}`,
        ...restParagraphs,
      ].join("\n\n");
    })
    .join("\n\n");
}

export function buildTranscriptText(
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
      const firstParagraph = block.paragraphs[0] || "";
      const restParagraphs = block.paragraphs.slice(1);

      return [
        `${timestamp}${block.speakerName}：${firstParagraph}`,
        ...restParagraphs,
      ].join("\n\n");
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

function joinText(current: string, next: string) {
  const trimmedCurrent = normalizeSegmentText(current);
  const trimmedNext = normalizeSegmentText(next);

  if (!trimmedCurrent) {
    return trimmedNext;
  }

  if (!trimmedNext) {
    return trimmedCurrent;
  }

  if (shouldJoinWithoutSpace(trimmedCurrent, trimmedNext)) {
    return `${trimmedCurrent}${trimmedNext}`;
  }

  return `${trimmedCurrent} ${trimmedNext}`;
}

function normalizeSegmentText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function splitIntoParagraphs(
  text: string,
  maxLength = DEFAULT_PARAGRAPH_MAX_LENGTH,
) {
  const normalized = normalizeSegmentText(text);

  if (!normalized) {
    return [];
  }

  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const sentences = normalized.match(/[^。！？!?]+[。！？!?」』）)]*|.+$/g) || [
    normalized,
  ];
  const paragraphs: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();

    if (!trimmedSentence) {
      continue;
    }

    if (current && current.length + trimmedSentence.length > maxLength) {
      paragraphs.push(current);
      current = trimmedSentence;
      continue;
    }

    current = current
      ? joinText(current, trimmedSentence)
      : trimmedSentence;
  }

  if (current) {
    paragraphs.push(current);
  }

  return paragraphs.flatMap((paragraph) => splitLongParagraph(paragraph, maxLength));
}

function splitLongParagraph(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return [text];
  }

  const paragraphs: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const splitAt = findSplitIndex(remaining, maxLength);
    paragraphs.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    paragraphs.push(remaining);
  }

  return paragraphs;
}

function findSplitIndex(text: string, maxLength: number) {
  const preferredWindowStart = Math.floor(maxLength * 0.65);
  const searchArea = text.slice(preferredWindowStart, maxLength + 1);
  const preferredBreaks = ["、", ",", " "];

  for (const breakChar of preferredBreaks) {
    const index = searchArea.lastIndexOf(breakChar);

    if (index >= 0) {
      return preferredWindowStart + index + 1;
    }
  }

  return maxLength;
}

function shouldJoinWithoutSpace(current: string, next: string) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(current)
    && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(next);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
