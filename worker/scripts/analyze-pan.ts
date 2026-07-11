import { extractPanEnvelope, clusterPans } from "../src/pan.js";
import { probeAudio } from "../src/ffprobe.js";

const audioFile = process.argv[2];
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH || "ffprobe";
const timeoutMs = Number.parseInt(process.env.FFMPEG_TIMEOUT_SECONDS || "1800", 10) * 1000;

if (!audioFile) {
  console.error(
    "Usage: npx tsx scripts/analyze-pan.ts <audio-file> [--segment <start-sec> <end-sec> <k>]",
  );
  process.exit(1);
}

const audioInfo = await probeAudio(ffprobePath, audioFile, timeoutMs);
const firstAudioStream = audioInfo.streams.find((stream) => stream.codecType === "audio");
console.log(`channels: ${firstAudioStream?.channels ?? "unknown"}`);
console.log(`duration: ${audioInfo.durationSec ?? "unknown"}s`);

const envelope = await extractPanEnvelope({
  ffmpegPath,
  inputPath: audioFile,
  timeoutMs,
});

const windowItems = Array.from({ length: envelope.left.length }, (_, index) => {
  const left = envelope.left[index] ?? 0;
  const right = envelope.right[index] ?? 0;
  const leftRoot = Math.sqrt(left);
  const rightRoot = Math.sqrt(right);
  const totalRoot = leftRoot + rightRoot;
  const pan = totalRoot > 0 ? (rightRoot - leftRoot) / totalRoot : 0;
  return {
    pan,
    weightSec: envelope.windowSec,
    energy: left + right,
  };
}).filter((item) => item.energy > 0);

console.log(`windows: ${envelope.left.length}`);
console.log(
  `energy/window: min=${formatNumber(min(windowItems.map((item) => item.energy)))} median=${formatNumber(
    percentile(windowItems.map((item) => item.energy), 0.5),
  )} max=${formatNumber(max(windowItems.map((item) => item.energy)))}`,
);
console.log("pan histogram:");
console.log(formatHistogram(windowItems.map((item) => item.pan)));

for (const k of [2, 3, 4]) {
  const clustered = clusterPans(windowItems, k);
  console.log(
    `k=${k}: centers=[${clustered.centers
      .map((center) => center.toFixed(3))
      .join(", ")}] separated=${clustered.separated}`,
  );
}

const segmentArgIndex = process.argv.indexOf("--segment");

if (segmentArgIndex >= 0) {
  const startSec = Number.parseFloat(process.argv[segmentArgIndex + 1] || "");
  const endSec = Number.parseFloat(process.argv[segmentArgIndex + 2] || "");
  const k = Number.parseInt(process.argv[segmentArgIndex + 3] || "2", 10);

  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
    throw new Error("--segment requires <start-sec> <end-sec>.");
  }

  const clustered = clusterPans(windowItems, k);

  console.log(
    `segment windows ${startSec.toFixed(3)}..${endSec.toFixed(3)} k=${k} centers=[${clustered.centers
      .map((center) => center.toFixed(3))
      .join(", ")}]`,
  );

  const startIndex = Math.max(0, Math.floor(startSec / envelope.windowSec));
  const endIndex = Math.min(envelope.left.length, Math.ceil(endSec / envelope.windowSec));

  for (let index = startIndex; index < endIndex; index++) {
    const left = envelope.left[index] ?? 0;
    const right = envelope.right[index] ?? 0;
    const leftRoot = Math.sqrt(left);
    const rightRoot = Math.sqrt(right);
    const totalRoot = leftRoot + rightRoot;
    const pan = totalRoot > 0 ? (rightRoot - leftRoot) / totalRoot : 0;
    const clusterIndex = nearestCenterIndex(pan, clustered.centers);

    console.log(
      `${(index * envelope.windowSec).toFixed(3)} pan=${pan.toFixed(3)} cluster=${clusterIndex} energy=${formatNumber(left + right)}`,
    );
  }
}

function formatHistogram(values: number[]) {
  const buckets = new Array<number>(10).fill(0);

  for (const value of values) {
    const index = Math.min(9, Math.max(0, Math.floor(((value + 1) / 2) * 10)));
    buckets[index] += 1;
  }

  const maxBucket = Math.max(...buckets, 1);

  return buckets
    .map((count, index) => {
      const start = -1 + index * 0.2;
      const end = start + 0.2;
      const bar = "#".repeat(Math.round((count / maxBucket) * 40));
      return `${start.toFixed(1)}..${end.toFixed(1)} ${count.toString().padStart(5, " ")} ${bar}`;
    })
    .join("\n");
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

function min(values: number[]) {
  return values.length === 0 ? 0 : Math.min(...values);
}

function max(values: number[]) {
  return values.length === 0 ? 0 : Math.max(...values);
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toExponential(3) : "n/a";
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
