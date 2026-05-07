"use server";

import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  buildJobSourceStoragePath,
  getAudioBucketName,
  validateAudioFile,
} from "@/lib/storage";

export type UploadActionState = {
  error: string | null;
};

export async function createTranscriptionJob(
  _previousState: UploadActionState,
  formData: FormData,
): Promise<UploadActionState> {
  const file = formData.get("audio");

  if (!(file instanceof File)) {
    return { error: "音声ファイルを選択してください。" };
  }

  const validationError = validateAudioFile(file);

  if (validationError) {
    return { error: validationError };
  }

  let jobId: string | null = null;

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "ログインが必要です。" };
    }

    jobId = crypto.randomUUID();

    const adminSupabase = createAdminSupabaseClient();
    const bucketName = getAudioBucketName();
    const storagePath = buildJobSourceStoragePath(jobId, file.name);

    const { error: uploadError } = await adminSupabase.storage
      .from(bucketName)
      .upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      return { error: `音声ファイルのアップロードに失敗しました: ${uploadError.message}` };
    }

    const { error: insertError } = await adminSupabase
      .from("transcription_jobs")
      .insert({
        id: jobId,
        user_id: user.id,
        original_filename: file.name,
        storage_bucket: bucketName,
        storage_path: storagePath,
        status: "queued",
        progress: 0,
      });

    if (insertError) {
      await adminSupabase.storage.from(bucketName).remove([storagePath]);
      return { error: `文字起こしジョブの作成に失敗しました: ${insertError.message}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message };
  }

  redirect(`/jobs/${jobId}`);
}
