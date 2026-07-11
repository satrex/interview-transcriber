import { spawn } from "node:child_process";
import type { NormalizedSegment } from "./transcribe.js";

const SAMPLE_RATE = 8000;
const WINDOW_SEC = 0.25;
const FRAMES_PER_WINDOW = SAMPLE_RATE * WINDOW_SEC;
const BYTES_PER_FRAME = 4;
const MIN_CENTER_GAP = 0.25;
const MIN_CLUSTER_WEIGHT_RATIO = 0.1;
const MIN_CLUSTER_SEGMENT_SEC = 0.8;
const AMBIGUOUS_MARGIN_RATIO = 0.35;
const ENERGY_FLOOR_PERCENTILE = 0.2;
const SILENCE_EPSILON = 1e-9;

export type PanEnvelope = {
  windowSec: number;
  left: Float64Array;
  right: Float64Array;
};

export type SegmentPan = { pan: number; energyPerSec: number };

type PanPoint = {
  segment: NormalizedSegment;
  pan: SegmentPan;
  weightSec: number;
  clusterIndex: number;
  confident: boolean;
};

export async function extractPanEnvelope(options: {
  ffmpegPath: string;
  inputPath: string;
  timeoutMs: number;
}): Promise<PanEnvelope> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      options.ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        options.inputPath,
        "-vn",
        "-map",
        "0:a:0",
        "-ac",
        "2",
        "-ar",
        String(SAMPLE_RATE),
        "-c:a",
        "pcm_s16le",
        "-f",
        "s16le",
        "-",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const left: number[] = [];
    const right: number[] = [];
    let currentLeft = 0;
    let currentRight = 0;
    let framesInWindow = 0;
    let carry: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      ffmpeg.kill("SIGKILL");
      reject(new Error(`ffmpeg pan envelope extraction timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    ffmpeg.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    ffmpeg.stdout?.on("data", (chunk: Buffer) => {
      const buffer =
        carry.length > 0 ? Buffer.concat([carry, chunk], carry.length + chunk.length) : chunk;
      const completeBytes = buffer.length - (buffer.length % BYTES_PER_FRAME);

      for (let offset = 0; offset < completeBytes; offset += BYTES_PER_FRAME) {
        const l = buffer.readInt16LE(offset);
        const r = buffer.readInt16LE(offset + 2);
        currentLeft += l * l;
        currentRight += r * r;
        framesInWindow += 1;

        if (framesInWindow >= FRAMES_PER_WINDOW) {
          left.push(currentLeft);
          right.push(currentRight);
          currentLeft = 0;
          currentRight = 0;
          framesInWindow = 0;
        }
      }

      carry = completeBytes < buffer.length ? buffer.subarray(completeBytes) : Buffer.alloc(0);
    });

    ffmpeg.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    ffmpeg.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg exited with code ${code}${signal ? ` signal ${signal}` : ""}${
              stderr ? `\nstderr:\n${stderr}` : ""
            }`,
          ),
        );
        return;
      }

      if (framesInWindow > 0) {
        left.push(currentLeft);
        right.push(currentRight);
      }

      resolve({
        windowSec: WINDOW_SEC,
        left: Float64Array.from(left),
        right: Float64Array.from(right),
      });
    });
  });
}

export function computeSegmentPan(
  env: PanEnvelope,
  startSec: number,
  endSec: number,
): SegmentPan {
  const durationSec = Math.max(0, endSec - startSec);

  if (durationSec <= 0 || env.left.length === 0) {
    return { pan: 0, energyPerSec: 0 };
  }

  const startIndex = Math.max(0, Math.floor(startSec / env.windowSec));
  const endIndex = Math.min(env.left.length, Math.ceil(endSec / env.windowSec));
  let leftEnergy = 0;
  let rightEnergy = 0;

  for (let i = startIndex; i < endIndex; i++) {
    leftEnergy += env.left[i] ?? 0;
    rightEnergy += env.right[i] ?? 0;
  }

  const leftRoot = Math.sqrt(leftEnergy);
  const rightRoot = Math.sqrt(rightEnergy);
  const totalRoot = leftRoot + rightRoot;
  const totalEnergy = leftEnergy + rightEnergy;

  if (totalRoot <= SILENCE_EPSILON || totalEnergy <= SILENCE_EPSILON) {
    return { pan: 0, energyPerSec: 0 };
  }

  return {
    pan: (rightRoot - leftRoot) / totalRoot,
    energyPerSec: totalEnergy / durationSec,
  };
}

export function clusterPans(
  items: Array<{ pan: number; weightSec: number }>,
  k: number,
): { centers: number[]; separated: boolean } {
  const validItems = items.filter(
    (item) => Number.isFinite(item.pan) && item.weightSec > 0,
  );

  if (validItems.length === 0) {
    return { centers: [], separated: false };
  }

  const clusterCount = clamp(k, 2, 4);
  let centers = initialCenters(validItems, clusterCount);
  let assignments = new Array<number>(validItems.length).fill(0);

  for (let iteration = 0; iteration < 50; iteration++) {
    let changed = false;

    assignments = validItems.map((item, index) => {
      const next = nearestCenterIndex(item.pan, centers);
      if (next !== assignments[index]) {
        changed = true;
      }
      return next;
    });

    const sums = new Array<number>(clusterCount).fill(0);
    const weights = new Array<number>(clusterCount).fill(0);

    validItems.forEach((item, index) => {
      const clusterIndex = assignments[index] ?? 0;
      sums[clusterIndex] += item.pan * item.weightSec;
      weights[clusterIndex] += item.weightSec;
    });

    centers = centers.map((center, index) =>
      weights[index] > 0 ? sums[index] / weights[index] : center,
    );

    if (!changed) {
      break;
    }
  }

  const sortedCenters = [...centers].sort((a, b) => a - b);
  const totalWeight = validItems.reduce((sum, item) => sum + item.weightSec, 0);
  const clusterWeights = new Array<number>(clusterCount).fill(0);

  validItems.forEach((item) => {
    clusterWeights[nearestCenterIndex(item.pan, centers)] += item.weightSec;
  });

  const minGap = sortedCenters.slice(1).reduce((min, center, index) => {
    return Math.min(min, center - sortedCenters[index]);
  }, Number.POSITIVE_INFINITY);
  const minWeight = Math.min(...clusterWeights);

  return {
    centers: sortedCenters,
    separated:
      sortedCenters.length === clusterCount &&
      minGap >= MIN_CENTER_GAP &&
      minWeight >= totalWeight * MIN_CLUSTER_WEIGHT_RATIO,
  };
}

export function relabelSegmentsByPan(options: {
  segments: NormalizedSegment[];
  envelope: PanEnvelope;
  expectedSpeakerCount: number | null;
}): { segments: NormalizedSegment[]; applied: boolean; summary: string } {
  if (options.segments.length === 0) {
    return { segments: options.segments, applied: false, summary: "pan relabel skipped: no segments" };
  }

  const segmentPans = options.segments.map((segment) => ({
    segment,
    pan: computeSegmentPan(options.envelope, segment.startSec, segment.endSec),
    weightSec: Math.max(0, segment.endSec - segment.startSec),
  }));
  const energyFloor = percentile(
    segmentPans.map((item) => item.pan.energyPerSec).filter((energy) => energy > 0),
    ENERGY_FLOOR_PERCENTILE,
  );
  const clusterInputs = segmentPans
    .filter(
      (item) =>
        item.weightSec >= MIN_CLUSTER_SEGMENT_SEC &&
        item.pan.energyPerSec >= energyFloor,
    )
    .map((item) => ({ pan: item.pan.pan, weightSec: item.weightSec }));

  const k = clamp(options.expectedSpeakerCount ?? 2, 2, 4);
  const clustered = clusterPans(clusterInputs, k);

  if (!clustered.separated) {
    return {
      segments: options.segments,
      applied: false,
      summary: `pan relabel skipped: stereo separation gate failed; centers=${formatCenters(clustered.centers)}`,
    };
  }

  const centers = clustered.centers;
  const points: PanPoint[] = segmentPans.map((item) => {
    const nearest = nearestCenterIndex(item.pan.pan, centers);
    const second = secondNearestDistance(item.pan.pan, centers, nearest);
    const nearestDistance = Math.abs(item.pan.pan - centers[nearest]);
    const localGap = Math.max(SILENCE_EPSILON, second.distance - nearestDistance);
    const minAdjacentGap = nearestAdjacentGap(centers, nearest);
    const filteredOut =
      item.weightSec < MIN_CLUSTER_SEGMENT_SEC || item.pan.energyPerSec < energyFloor;

    return {
      segment: item.segment,
      pan: item.pan,
      weightSec: item.weightSec,
      clusterIndex: nearest,
      confident:
        !filteredOut &&
        localGap >= Math.max(SILENCE_EPSILON, minAdjacentGap * AMBIGUOUS_MARGIN_RATIO),
    };
  });

  const majorityByChunkAndLabel = new Map<string, number>();
  const voteWeights = new Map<string, Map<number, number>>();

  for (const point of points) {
    if (!point.confident) {
      continue;
    }

    const key = `${point.segment.chunkIndex}\u0000${point.segment.speakerLabel}`;
    const votes = voteWeights.get(key) ?? new Map<number, number>();
    votes.set(point.clusterIndex, (votes.get(point.clusterIndex) ?? 0) + point.weightSec);
    voteWeights.set(key, votes);
  }

  for (const [key, votes] of voteWeights) {
    const sortedVotes = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    if (sortedVotes.length > 0 && (sortedVotes.length === 1 || sortedVotes[0][1] > sortedVotes[1][1])) {
      majorityByChunkAndLabel.set(key, sortedVotes[0][0]);
    }
  }

  const firstConfidentStartByCluster = new Map<number, number>();
  const clusterDurations = new Map<number, number>();
  let ambiguousCount = 0;

  for (const point of points) {
    if (!point.confident) {
      ambiguousCount += 1;
      const key = `${point.segment.chunkIndex}\u0000${point.segment.speakerLabel}`;
      point.clusterIndex = majorityByChunkAndLabel.get(key) ?? point.clusterIndex;
    }

    clusterDurations.set(
      point.clusterIndex,
      (clusterDurations.get(point.clusterIndex) ?? 0) + point.weightSec,
    );

    if (point.confident) {
      const current = firstConfidentStartByCluster.get(point.clusterIndex);
      if (current === undefined || point.segment.startSec < current) {
        firstConfidentStartByCluster.set(point.clusterIndex, point.segment.startSec);
      }
    }
  }

  const orderedClusters = centers
    .map((center, index) => ({
      center,
      index,
      firstStart: firstConfidentStartByCluster.get(index) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.firstStart - b.firstStart || a.index - b.index);
  const labelsByCluster = new Map<number, string>();
  orderedClusters.forEach((cluster, index) => {
    labelsByCluster.set(cluster.index, String.fromCharCode("A".charCodeAt(0) + index));
  });

  let changedCount = 0;
  const relabeled = points.map((point) => {
    const speakerLabel = labelsByCluster.get(point.clusterIndex) ?? point.segment.speakerLabel;
    if (speakerLabel !== point.segment.speakerLabel) {
      changedCount += 1;
    }
    return { ...point.segment, speakerLabel };
  });
  const durations = [...clusterDurations.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([clusterIndex, duration]) => `${labelsByCluster.get(clusterIndex) ?? clusterIndex}:${duration.toFixed(1)}s`)
    .join(",");

  return {
    segments: relabeled,
    applied: true,
    summary: `pan relabel applied: centers=${formatCenters(centers)} durations=${durations} changed=${changedCount}/${points.length} ambiguous=${ambiguousCount}`,
  };
}

function initialCenters(
  items: Array<{ pan: number; weightSec: number }>,
  k: number,
) {
  const sorted = [...items].sort((a, b) => a.pan - b.pan);

  return Array.from({ length: k }, (_, index) => {
    const position = k === 1 ? 0 : index / (k - 1);
    const sortedIndex = Math.min(
      sorted.length - 1,
      Math.max(0, Math.round(position * (sorted.length - 1))),
    );
    return sorted[sortedIndex].pan;
  });
}

function nearestCenterIndex(value: number, centers: number[]) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  centers.forEach((center, index) => {
    const distance = Math.abs(value - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function secondNearestDistance(value: number, centers: number[], nearestIndex: number) {
  let secondIndex = nearestIndex;
  let distance = Number.POSITIVE_INFINITY;

  centers.forEach((center, index) => {
    if (index === nearestIndex) {
      return;
    }
    const nextDistance = Math.abs(value - center);
    if (nextDistance < distance) {
      distance = nextDistance;
      secondIndex = index;
    }
  });

  return { index: secondIndex, distance };
}

function nearestAdjacentGap(centers: number[], index: number) {
  const gaps = [
    index > 0 ? Math.abs(centers[index] - centers[index - 1]) : Number.POSITIVE_INFINITY,
    index < centers.length - 1
      ? Math.abs(centers[index + 1] - centers[index])
      : Number.POSITIVE_INFINITY,
  ];

  return Math.min(...gaps);
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * ratio)),
  );
  return sorted[index];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatCenters(centers: number[]) {
  return `[${centers.map((center) => center.toFixed(3)).join(",")}]`;
}
