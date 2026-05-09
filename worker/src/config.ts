import "dotenv/config";

export type WorkerConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  audioBucket: string;
  workerId: string;
  tmpDir: string;
  ffmpegPath: string;
  ffprobePath: string;
  audioChunkSeconds: number;
  openaiApiKey: string;
  openaiTranscriptionModel: string;
  lockTimeoutMinutes: number;
  maxLockRefreshFailures: number;
  maxAttempts: number;
};

export function loadConfig(): WorkerConfig {
  return {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    audioBucket: process.env.SUPABASE_AUDIO_BUCKET || "audio-uploads",
    workerId: process.env.WORKER_ID || "local-worker",
    tmpDir: process.env.WORKER_TMP_DIR || "/tmp/interview-transcriber",
    ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
    ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
    audioChunkSeconds: parsePositiveInteger(
      process.env.AUDIO_CHUNK_SECONDS,
      600,
      "AUDIO_CHUNK_SECONDS",
    ),
    openaiApiKey: requireEnv("OPENAI_API_KEY"),
    openaiTranscriptionModel:
      process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe-diarize",
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
  };
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
