const ALLOWED_AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "wav"]);

const AUDIO_SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 6;

export const DEFAULT_AUDIO_CHUNK_DURATION_SEC = 600;

export type AudioFileMetadata = {
  fileName: string;
  fileSize: number;
  contentType?: string | null;
};

export function getAudioBucketName() {
  return process.env.SUPABASE_AUDIO_BUCKET || "audio-uploads";
}

export function getBrowserAudioBucketName() {
  return process.env.NEXT_PUBLIC_SUPABASE_AUDIO_BUCKET || "audio-uploads";
}

export function getMaxUploadSizeBytes() {
  const sizeMb = Number.parseInt(process.env.MAX_UPLOAD_SIZE_MB || "1024", 10);
  return sizeMb * 1024 * 1024;
}

export function validateAudioFile(file: File) {
  if (file.size <= 0) {
    return "音声ファイルを選択してください。";
  }

  if (file.size > getMaxUploadSizeBytes()) {
    return `アップロードできる音声ファイルは最大 ${process.env.MAX_UPLOAD_SIZE_MB || "1024"}MB です。`;
  }

  const extension = getFileExtension(file.name);

  if (!extension || !ALLOWED_AUDIO_EXTENSIONS.has(extension)) {
    return "対応している音声形式は mp3, m4a, wav です。";
  }

  return null;
}

export function validateAudioFileMetadata(file: AudioFileMetadata) {
  if (file.fileSize <= 0) {
    return "音声ファイルを選択してください。";
  }

  if (file.fileSize > getMaxUploadSizeBytes()) {
    return `アップロードできる音声ファイルは最大 ${process.env.MAX_UPLOAD_SIZE_MB || "1024"}MB です。`;
  }

  const extension = getFileExtension(file.fileName);

  if (!extension || !ALLOWED_AUDIO_EXTENSIONS.has(extension)) {
    return "対応している音声形式は mp3, m4a, wav です。";
  }

  return null;
}

export function buildJobSourceStoragePath(jobId: string, originalFilename: string) {
  return `jobs/${jobId}/source/${toSafeStorageFilename(originalFilename)}`;
}

export function buildUserJobSourceStoragePath(
  userId: string,
  jobId: string,
  originalFilename: string,
) {
  return `${userId}/${jobId}/${toSafeStorageFilename(originalFilename)}`;
}

export function buildJobAudioChunkStoragePath(
  jobId: string,
  chunkIndex: number,
) {
  return `jobs/${jobId}/chunks/chunk_${chunkIndex
    .toString()
    .padStart(3, "0")}.wav`;
}

export function getAudioContentType(filename: string, fallback?: string) {
  const extension = getFileExtension(filename);

  switch (extension) {
    case "m4a":
      return "audio/mp4";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    default:
      return fallback || "application/octet-stream";
  }
}

export async function createAudioSignedUrl(options: {
  bucket: string;
  path: string;
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
      ) => Promise<{
        data: { signedUrl: string } | null;
        error: { message: string } | null;
      }>;
    };
  };
}) {
  const { data, error } = await options.storage
    .from(options.bucket)
    .createSignedUrl(options.path, AUDIO_SIGNED_URL_EXPIRES_IN_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error(
      `音声ファイルの署名付きURLを作成できませんでした: ${error?.message || "unknown error"}`,
    );
  }

  return data.signedUrl;
}

function getFileExtension(filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase();
  return extension === filename ? null : extension;
}

function toSafeStorageFilename(filename: string) {
  const extension = getFileExtension(filename);
  const baseName = filename.replace(/\.[^/.]+$/, "");
  const safeBaseName = baseName
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  const fallbackName = safeBaseName || "audio";
  return extension ? `${fallbackName}.${extension}` : fallbackName;
}
