import "dotenv/config";

export type WorkerConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  workerId: string;
  tmpDir: string;
  ffmpegPath: string;
  ffprobePath: string;
  audioChunkSeconds: number;
  diarizeFallbackSubchunkSeconds: number;
  openaiApiKey: string;
  openaiTranscriptionModel: string;
  openaiTranscriptionTimeoutSeconds: number;
  ffmpegTimeoutSeconds: number;
  downloadTimeoutSeconds: number;
  maxConcurrentJobs: number;
  lockTimeoutMinutes: number;
  maxLockRefreshFailures: number;
  maxAttempts: number;
  pollIntervalMs: number;
  panRelabelEnabled: boolean;
  speakerReferencesEnabled: boolean;
  mixResplitEnabled: boolean;
};

export function loadConfig(): WorkerConfig {
  return {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    workerId: process.env.WORKER_ID || "local-worker",
    tmpDir: process.env.WORKER_TMP_DIR || "/tmp/interview-transcriber",
    ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
    ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
    audioChunkSeconds: parsePositiveInteger(
      process.env.AUDIO_CHUNK_SECONDS,
      600,
      "AUDIO_CHUNK_SECONDS",
    ),
    diarizeFallbackSubchunkSeconds: parsePositiveInteger(
      process.env.DIARIZE_FALLBACK_SUBCHUNK_SECONDS,
      75,
      "DIARIZE_FALLBACK_SUBCHUNK_SECONDS",
    ),
    openaiApiKey: requireEnv("OPENAI_API_KEY"),
    openaiTranscriptionModel:
      process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe-diarize",
    openaiTranscriptionTimeoutSeconds: parsePositiveInteger(
      process.env.OPENAI_TRANSCRIPTION_TIMEOUT_SECONDS,
      1200,
      "OPENAI_TRANSCRIPTION_TIMEOUT_SECONDS",
    ),
    ffmpegTimeoutSeconds: parsePositiveInteger(
      process.env.FFMPEG_TIMEOUT_SECONDS,
      1800,
      "FFMPEG_TIMEOUT_SECONDS",
    ),
    downloadTimeoutSeconds: parsePositiveInteger(
      process.env.WORKER_DOWNLOAD_TIMEOUT_SECONDS,
      900,
      "WORKER_DOWNLOAD_TIMEOUT_SECONDS",
    ),
    maxConcurrentJobs: parseMaxConcurrentJobs(process.env.MAX_CONCURRENT_JOBS),
    lockTimeoutMinutes: parsePositiveInteger(
      process.env.WORKER_LOCK_TIMEOUT_MINUTES,
      30,
      "WORKER_LOCK_TIMEOUT_MINUTES",
    ),
    maxLockRefreshFailures: parsePositiveInteger(
      process.env.WORKER_MAX_LOCK_REFRESH_FAILURES,
      3,
      "WORKER_MAX_LOCK_REFRESH_FAILURES",
    ),
    maxAttempts: parsePositiveInteger(
      process.env.WORKER_MAX_ATTEMPTS,
      3,
      "WORKER_MAX_ATTEMPTS",
    ),
    pollIntervalMs: parsePositiveInteger(
      process.env.WORKER_POLL_INTERVAL_MS,
      10_000,
      "WORKER_POLL_INTERVAL_MS",
    ),
    panRelabelEnabled: parseBoolean(
      process.env.SPEAKER_PAN_RELABEL_ENABLED,
      true,
      "SPEAKER_PAN_RELABEL_ENABLED",
    ),
    speakerReferencesEnabled: parseBoolean(
      process.env.SPEAKER_REFERENCES_ENABLED,
      true,
      "SPEAKER_REFERENCES_ENABLED",
    ),
    mixResplitEnabled: parseBoolean(
      process.env.SPEAKER_MIX_RESPLIT_ENABLED,
      false,
      "SPEAKER_MIX_RESPLIT_ENABLED",
    ),
  };
}

function parseMaxConcurrentJobs(value: string | undefined) {
  const parsed = parsePositiveInteger(value, 1, "MAX_CONCURRENT_JOBS");

  if (parsed !== 1) {
    throw new Error("MAX_CONCURRENT_JOBS must be 1. Parallel jobs are not enabled yet.");
  }

  return parsed;
}

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string) {
  if (value === undefined || value === "") {
    return fallback;
  }

  const normalized = value.toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new Error(`${name} must be "true" or "false".`);
}
