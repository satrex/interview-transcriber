"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  createProjectAction,
} from "@/app/actions";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import {
  AUDIO_BUCKET,
  buildUserProjectSourceStoragePath,
  getAudioContentType,
} from "@/lib/storage";

const LONG_AUDIO_WARNING_THRESHOLD_SEC = 60 * 60;
const LONG_AUDIO_WARNING_MESSAGE =
  "この音声は60分を超えています。処理や編集画面の動作が重くなる場合があります。必要に応じて1時間程度に分割してアップロードしてください。";

type TranscodeResult = {
  file: File;
  originalSize: number;
  reductionPercent: number;
};

type TranscodeStatus =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "transcoding"; progress: number }
  | { phase: "ready"; result: TranscodeResult }
  | { phase: "error"; message: string };

export function UploadForm({
  dictionaries = [],
}: {
  dictionaries?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [termDictionaryId, setTermDictionaryId] = useState("");
  const [durationWarning, setDurationWarning] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [storageUploadError, setStorageUploadError] = useState<string | null>(null);
  const [jobCreateError, setJobCreateError] = useState<string | null>(null);
  const [status, setStatus] = useState<TranscodeStatus>({ phase: "idle" });
  const conversionIdRef = useRef(0);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    const conversionId = conversionIdRef.current + 1;
    conversionIdRef.current = conversionId;
    setSelectedFile(file);
    setDurationWarning(null);
    setDurationSec(null);
    setSubmitError(null);
    setStorageUploadError(null);
    setJobCreateError(null);

    if (!file) {
      setStatus({ phase: "idle" });
      return;
    }

    void updateDurationWarning(file, conversionId);

    try {
      setStatus({ phase: "loading" });
      const result = await transcodeAudio(file, (progress) => {
        if (conversionIdRef.current !== conversionId) {
          return;
        }

        setStatus({
          phase: "transcoding",
          progress,
        });
      });

      if (conversionIdRef.current === conversionId) {
        setStatus({ phase: "ready", result });
      }
    } catch (error) {
      if (conversionIdRef.current !== conversionId) {
        return;
      }

      const message =
        error instanceof Error ? error.message : "音声変換に失敗しました。";
      setStatus({ phase: "error", message });
    }
  }

  async function updateDurationWarning(file: File, conversionId: number) {
    const loadedDurationSec = await loadAudioDuration(file);

    if (conversionIdRef.current !== conversionId) {
      return;
    }

    setDurationSec(loadedDurationSec);

    if (
      loadedDurationSec !== null &&
      loadedDurationSec > LONG_AUDIO_WARNING_THRESHOLD_SEC
    ) {
      setDurationWarning(LONG_AUDIO_WARNING_MESSAGE);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setStorageUploadError(null);
    setJobCreateError(null);

    if (status.phase !== "ready") {
      setStatus({
        phase: "error",
        message: selectedFile
          ? "変換が完了してからアップロードしてください。"
          : "音声ファイルを選択してください。",
      });
      return;
    }

    const uploadFile = status.result.file;
    const contentType = getAudioContentType(uploadFile.name, uploadFile.type);
    const supabase = createBrowserSupabaseClient();
    setIsUploading(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setSubmitError("ログイン状態を確認できませんでした。再ログインしてください。");
        return;
      }

      const projectId = crypto.randomUUID();
      const storagePath = buildUserProjectSourceStoragePath(
        user.id,
        projectId,
        uploadFile.name,
      );
      const firstPathSegment = storagePath.split("/")[0];

      console.log({
        bucket: AUDIO_BUCKET,
        storagePath,
        userId: user.id,
        firstPathSegment,
      });

      if (firstPathSegment !== user.id) {
        setSubmitError("Storage path がログインユーザーの領域ではありません。");
        return;
      }

      const { error: uploadError } = await supabase.storage
        .from(AUDIO_BUCKET)
        .upload(storagePath, uploadFile, {
          contentType,
          upsert: false,
        });

      if (uploadError) {
        setStorageUploadError(uploadError.message);
        return;
      }

      const result = await createProjectAction({
        projectId,
        storagePath,
        fileName: uploadFile.name,
        fileSize: uploadFile.size,
        contentType,
        durationSec,
        termDictionaryId: termDictionaryId || null,
      });

      if (result.error || !result.projectId) {
        setJobCreateError(result.error || "不明なエラーが発生しました。");
        return;
      }

      router.push(`/projects/${result.projectId}`);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
      setSubmitError(message);
    } finally {
      setIsUploading(false);
    }
  }

  const busy = status.phase === "loading" || status.phase === "transcoding";
  const canSubmit = status.phase === "ready" && !isUploading;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <label
          htmlFor="audio"
          className="block text-sm font-medium text-zinc-800"
        >
          音声ファイル
        </label>
        <input
          id="audio"
          name="audio"
          type="file"
          accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav,audio/x-wav"
          required
          disabled={isUploading}
          onChange={handleFileChange}
          className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white disabled:cursor-not-allowed disabled:bg-zinc-100"
        />
        <p className="text-sm text-zinc-500">
          mp3, m4a, wav / 最大 1GB。アップロード前に m4a、mono、16kHz、32kbps
          へ変換します。
        </p>
      </div>

      <TranscodeSummary status={status} selectedFile={selectedFile} />

      <div className="space-y-2">
        <label
          htmlFor="termDictionaryId"
          className="block text-sm font-medium text-zinc-800"
        >
          使用する用語辞書
        </label>
        <select
          id="termDictionaryId"
          name="termDictionaryId"
          value={termDictionaryId}
          disabled={isUploading}
          onChange={(event) => setTermDictionaryId(event.currentTarget.value)}
          className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-100"
        >
          <option value="">使用しない</option>
          {dictionaries.map((dictionary) => (
            <option key={dictionary.id} value={dictionary.id}>
              {dictionary.name}
            </option>
          ))}
        </select>
        <p className="text-sm text-zinc-500">
          辞書は文字起こし前のpromptヒントとして使われます。原文segmentの後処理置換は行いません。
        </p>
      </div>

      {durationWarning ? (
        <p
          aria-live="polite"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900"
        >
          {durationWarning}
        </p>
      ) : null}

      {submitError ? (
        <p
          aria-live="polite"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {submitError}
        </p>
      ) : null}

      {storageUploadError ? (
        <p
          aria-live="polite"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          音声ファイルのアップロードに失敗しました: {storageUploadError}
        </p>
      ) : null}

      {jobCreateError ? (
        <p
          aria-live="polite"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          ジョブ作成に失敗しました: {jobCreateError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit || busy}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {isUploading
          ? "アップロード中..."
          : busy
            ? "変換中..."
            : "文字起こしジョブを作成"}
      </button>
    </form>
  );
}

function TranscodeSummary({
  status,
  selectedFile,
}: {
  status: TranscodeStatus;
  selectedFile: File | null;
}) {
  if (!selectedFile && status.phase === "idle") {
    return null;
  }

  if (status.phase === "loading") {
    return (
      <p aria-live="polite" className="text-sm text-zinc-600">
        ffmpeg を準備しています...
      </p>
    );
  }

  if (status.phase === "transcoding") {
    const percent = Math.round(status.progress * 100);

    return (
      <div aria-live="polite" className="space-y-2">
        <div className="flex items-center justify-between text-sm text-zinc-600">
          <span>音声をアップロード用に変換しています</span>
          <span>{percent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-200">
          <div
            className="h-full rounded-full bg-zinc-950 transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  if (status.phase === "ready") {
    const { result } = status;

    return (
      <div
        aria-live="polite"
        className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
      >
        <p className="font-medium">変換後ファイルをアップロードします</p>
        <p className="mt-1">
          元サイズ {formatBytes(result.originalSize)} → 変換後{" "}
          {formatBytes(result.file.size)}（{result.reductionPercent}% 削減）
        </p>
      </div>
    );
  }

  if (status.phase === "error") {
    return (
      <p
        aria-live="polite"
        className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
      >
        {status.message}
      </p>
    );
  }

  return selectedFile ? (
    <p aria-live="polite" className="text-sm text-zinc-600">
      選択中: {selectedFile.name}（{formatBytes(selectedFile.size)}）
    </p>
  ) : null;
}

function loadAudioDuration(file: File) {
  return new Promise<number | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 10000);

    function cleanup() {
      window.clearTimeout(timeoutId);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("error", handleError);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
    }

    function handleLoadedMetadata() {
      const durationSec = Number.isFinite(audio.duration) ? audio.duration : null;
      cleanup();
      resolve(durationSec);
    }

    function handleError() {
      cleanup();
      resolve(null);
    }

    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("error", handleError);
    audio.src = url;
  });
}

async function transcodeAudio(
  file: File,
  onProgress: (progress: number) => void,
): Promise<TranscodeResult> {
  const [{ FFmpeg }, { fetchFile }] = await Promise.all([
    import("@ffmpeg/ffmpeg"),
    import("@ffmpeg/util"),
  ]);
  const ffmpeg = new FFmpeg();
  const inputName = `input.${getFileExtension(file.name) || "audio"}`;
  const outputName = `${stripExtension(file.name) || "audio"}-16khz-32kbps.m4a`;

  ffmpeg.on("progress", ({ progress }) => {
    onProgress(Math.max(0, Math.min(progress, 1)));
  });

  await ffmpeg.load({
    coreURL: "/ffmpeg/ffmpeg-core.js",
    wasmURL: "/ffmpeg/ffmpeg-core.wasm",
  });
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  const exitCode = await ffmpeg.exec([
    "-i",
    inputName,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "32k",
    "-c:a",
    "aac",
    "-profile:a",
    "aac_low",
    "-movflags",
    "+faststart",
    outputName,
  ]);

  if (exitCode !== 0) {
    throw new Error("ffmpeg による音声変換に失敗しました。");
  }

  const outputData = await ffmpeg.readFile(outputName);

  if (!(outputData instanceof Uint8Array)) {
    throw new Error("変換後の音声データを読み取れませんでした。");
  }

  await Promise.all([
    ffmpeg.deleteFile(inputName).catch(() => null),
    ffmpeg.deleteFile(outputName).catch(() => null),
  ]);
  ffmpeg.terminate();

  const outputBuffer = new ArrayBuffer(outputData.byteLength);
  new Uint8Array(outputBuffer).set(outputData);

  const transcodedFile = new File([outputBuffer], outputName, {
    type: "audio/mp4",
  });
  const reductionPercent = Math.max(
    0,
    Math.round((1 - transcodedFile.size / file.size) * 100),
  );

  return {
    file: transcodedFile,
    originalSize: file.size,
    reductionPercent,
  };
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function getFileExtension(filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase();
  return extension === filename ? "" : extension;
}

function stripExtension(filename: string) {
  return filename.replace(/\.[^/.]+$/, "");
}
