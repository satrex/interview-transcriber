const ALLOWED_AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "wav"]);

export function getAudioBucketName() {
  return process.env.SUPABASE_AUDIO_BUCKET || "audio-uploads";
}

export function getMaxUploadSizeBytes() {
  const sizeMb = Number.parseInt(process.env.MAX_UPLOAD_SIZE_MB || "500", 10);
  return sizeMb * 1024 * 1024;
}

export function validateAudioFile(file: File) {
  if (file.size <= 0) {
    return "音声ファイルを選択してください。";
  }

  if (file.size > getMaxUploadSizeBytes()) {
    return `アップロードできる音声ファイルは最大 ${process.env.MAX_UPLOAD_SIZE_MB || "500"}MB です。`;
  }

  const extension = getFileExtension(file.name);

  if (!extension || !ALLOWED_AUDIO_EXTENSIONS.has(extension)) {
    return "対応している音声形式は mp3, m4a, wav です。";
  }

  return null;
}

export function buildJobSourceStoragePath(jobId: string, originalFilename: string) {
  return `jobs/${jobId}/source/${toSafeStorageFilename(originalFilename)}`;
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
