"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  getAudioBucketName,
  validateAudioFileMetadata,
} from "@/lib/storage";

export type CreateJobActionInput = {
  jobId: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
  contentType?: string | null;
  durationSec?: number | null;
};

export type CreateJobActionState = {
  error: string | null;
  jobId?: string;
};

export type LoginActionState = {
  error: string | null;
};

export type QualityNotesActionState = {
  error: string | null;
  success: boolean;
};

export type SpeakerNamesActionState = {
  error: string | null;
  success: boolean;
};

export type ExpectedSpeakerCountActionState = {
  error: string | null;
  success: boolean;
};

export type SegmentEditActionState = {
  error: string | null;
  savedEditedText?: string | null;
  savedSpeakerOverride?: string | null;
  savedIsSkipped?: boolean;
  success: boolean;
};

export type SegmentSkipActionState = {
  error: string | null;
  savedEditedText?: string | null;
  savedSpeakerOverride?: string | null;
  savedIsSkipped?: boolean;
  success: boolean;
};

export type SegmentSpeakerActionState = {
  error: string | null;
  savedEditedText?: string | null;
  savedSpeakerOverride?: string | null;
  savedIsSkipped?: boolean;
  success: boolean;
};

export type DeleteJobActionState = {
  error: string | null;
  success: boolean;
};

export type RetryJobActionState = {
  error: string | null;
  success: boolean;
};

export async function loginWithPassword(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = getTextValue(formData, "email");
  const password = getTextValue(formData, "password");

  if (!email || !password) {
    return { error: "メールアドレスとパスワードを入力してください。" };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { error: `ログインに失敗しました: ${error.message}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message };
  }

  revalidatePath("/");
  redirect("/");
}

export async function logout() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  revalidatePath("/");
  redirect("/");
}

export async function createJobAction(
  input: CreateJobActionInput,
): Promise<CreateJobActionState> {
  const validationError = validateAudioFileMetadata({
    fileName: input.fileName,
    fileSize: input.fileSize,
    contentType: input.contentType,
  });

  if (validationError) {
    return { error: validationError };
  }

  if (!isUuid(input.jobId)) {
    return { error: "ジョブIDが不正です。" };
  }

  if (!input.storagePath) {
    return { error: "Storage path が指定されていません。" };
  }

  const durationSec =
    typeof input.durationSec === "number" && Number.isFinite(input.durationSec)
      ? input.durationSec
      : null;

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "ログインが必要です。" };
    }

    const expectedPathPrefix = `${user.id}/${input.jobId}/`;

    if (!input.storagePath.startsWith(expectedPathPrefix)) {
      return { error: "Storage path がログインユーザーの領域ではありません。" };
    }

    const adminSupabase = createAdminSupabaseClient();
    const bucketName = getAudioBucketName();
    const object = splitStoragePath(input.storagePath);
    const { data: uploadedObjects, error: listError } = await adminSupabase.storage
      .from(bucketName)
      .list(object.directory, {
        limit: 1,
        search: object.filename,
      });

    if (listError) {
      return {
        error: `アップロード済み音声ファイルの確認に失敗しました: ${listError.message}`,
      };
    }

    const uploadedObject = uploadedObjects?.find(
      (item) => item.name === object.filename,
    );

    if (!uploadedObject) {
      return { error: "アップロード済み音声ファイルがStorageに見つかりません。" };
    }

    const { error: insertError } = await adminSupabase
      .from("transcription_jobs")
      .insert({
        id: input.jobId,
        user_id: user.id,
        original_filename: input.fileName,
        storage_bucket: bucketName,
        storage_path: input.storagePath,
        audio_duration_sec: durationSec,
        audio_file_size_bytes: input.fileSize,
        audio_content_type: input.contentType || null,
        status: "queued",
        progress: 0,
      });

    if (insertError) {
      await adminSupabase.storage.from(bucketName).remove([input.storagePath]);
      return { error: `文字起こしジョブの作成に失敗しました: ${insertError.message}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message };
  }

  revalidatePath("/");
  revalidatePath("/jobs");
  return { error: null, jobId: input.jobId };
}

export async function deleteTranscriptionJob(
  _previousState: DeleteJobActionState,
  formData: FormData,
): Promise<DeleteJobActionState> {
  const jobId = getTextValue(formData, "jobId");

  if (!jobId) {
    return { error: "削除するジョブが指定されていません。", success: false };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "ログインが必要です。", success: false };
    }

    const { data: job, error: jobError } = await supabase
      .from("transcription_jobs")
      .select("id, storage_bucket, storage_path")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return { error: "ジョブが見つからないか、削除権限がありません。", success: false };
    }

    const adminSupabase = createAdminSupabaseClient();

    const { error: editsDeleteError } = await adminSupabase
      .from("transcription_segment_edits")
      .delete()
      .eq("job_id", job.id)
      .eq("user_id", user.id);

    if (editsDeleteError) {
      return {
        error: `削除失敗: segment edits の削除で止まりました。${editsDeleteError.message}`,
        success: false,
      };
    }

    const { error: segmentsDeleteError } = await adminSupabase
      .from("transcription_segments")
      .delete()
      .eq("job_id", job.id);

    if (segmentsDeleteError) {
      return {
        error: `削除失敗: segment edits は削除済みですが、segments の削除で止まりました。${segmentsDeleteError.message}`,
        success: false,
      };
    }

    const { error: jobDeleteError } = await adminSupabase
      .from("transcription_jobs")
      .delete()
      .eq("id", job.id)
      .eq("user_id", user.id);

    if (jobDeleteError) {
      return {
        error: `削除失敗: edits と segments は削除済みですが、job の削除で止まりました。${jobDeleteError.message}`,
        success: false,
      };
    }

    const storageDeleteError = await deleteJobSourceAudio({
      bucket: String(job.storage_bucket),
      path: String(job.storage_path),
    });

    if (storageDeleteError) {
      return {
        error: `DB上のjob、segments、editsは削除済みですが、Supabase Storage の元音声ファイル削除に失敗しました。${storageDeleteError.message}`,
        success: false,
      };
    }

    revalidatePath("/");
    revalidatePath("/jobs");
    return { error: null, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message, success: false };
  }
}

export async function retryTranscriptionJob(
  _previousState: RetryJobActionState,
  formData: FormData,
): Promise<RetryJobActionState> {
  const jobId = getTextValue(formData, "jobId");

  if (!jobId) {
    return { error: "再実行するジョブが指定されていません。", success: false };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "ログインが必要です。", success: false };
    }

    const { data: job, error: jobError } = await supabase
      .from("transcription_jobs")
      .select("id, status")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return { error: "ジョブが見つからないか、再実行権限がありません。", success: false };
    }

    if (job.status !== "failed") {
      return { error: "failed 状態のジョブのみ再実行できます。", success: false };
    }

    const adminSupabase = createAdminSupabaseClient();
    const { error: updateError } = await adminSupabase
      .from("transcription_jobs")
      .update({
        attempt_count: 0,
        completed_at: null,
        error_code: null,
        error_message: null,
        failed_at: null,
        locked_at: null,
        processed_audio_seconds: null,
        progress: 0,
        started_at: null,
        status: "queued",
        worker_id: null,
      })
      .eq("id", job.id)
      .eq("user_id", user.id);

    if (updateError) {
      return {
        error: `ジョブの再実行準備に失敗しました: ${updateError.message}`,
        success: false,
      };
    }

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${job.id}`);
    return { error: null, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message, success: false };
  }
}

export async function saveQualityNotes(
  _previousState: QualityNotesActionState,
  formData: FormData,
): Promise<QualityNotesActionState> {
  const jobId = getTextValue(formData, "jobId");

  if (!jobId) {
    return { error: "ジョブが指定されていません。", success: false };
  }

  const recordingEnvironment = getTextValue(formData, "recordingEnvironment");
  const misrecognitionNotes = getTextValue(formData, "misrecognitionNotes");
  const speakerMisidentificationNotes = getTextValue(
    formData,
    "speakerMisidentificationNotes",
  );
  const timestampOffsetNotes = getTextValue(formData, "timestampOffsetNotes");
  const generalQualityNotes = getTextValue(formData, "generalQualityNotes");

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "ログインが必要です。", success: false };
    }

    const { data: job, error: jobError } = await supabase
      .from("transcription_jobs")
      .select("id")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return { error: "ジョブが見つかりません。", success: false };
    }

    const { error: upsertError } = await supabase
      .from("transcription_job_quality_notes")
      .upsert(
        {
          job_id: job.id,
          user_id: user.id,
          recording_environment: recordingEnvironment,
          misrecognition_notes: misrecognitionNotes,
          speaker_misidentification_notes: speakerMisidentificationNotes,
          timestamp_offset_notes: timestampOffsetNotes,
          general_quality_notes: generalQualityNotes,
        },
        { onConflict: "job_id" },
      );

    if (upsertError) {
      return {
        error: `品質メモの保存に失敗しました: ${upsertError.message}`,
        success: false,
      };
    }

    revalidatePath(`/jobs/${job.id}`);
    return { error: null, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message, success: false };
  }
}

export async function saveSpeakerNames(
  _previousState: SpeakerNamesActionState,
  formData: FormData,
): Promise<SpeakerNamesActionState> {
  const jobId = getTextValue(formData, "jobId");

  if (!jobId) {
    return { error: "ジョブが指定されていません。", success: false };
  }

  const speakerLabels = formData
    .getAll("speakerLabel")
    .map((value) => (typeof value === "string" ? value.trim() : ""));
  const displayNames = formData
    .getAll("displayName")
    .map((value) => (typeof value === "string" ? value.trim() : ""));

  if (speakerLabels.length !== displayNames.length) {
    return { error: "話者名フォームの内容が不正です。", success: false };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "ログインが必要です。", success: false };
    }

    const { data: job, error: jobError } = await supabase
      .from("transcription_jobs")
      .select("id")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return { error: "ジョブが見つかりません。", success: false };
    }

    const rows = speakerLabels
      .map((speakerLabel, index) => ({
        display_name: displayNames[index] || "",
        job_id: job.id,
        speaker_label: speakerLabel,
        user_id: user.id,
      }))
      .filter((row) => row.speaker_label.length > 0);

    if (rows.length === 0) {
      return { error: null, success: true };
    }

    const { error: upsertError } = await supabase
      .from("transcription_job_speaker_names")
      .upsert(rows, { onConflict: "job_id,speaker_label" });

    if (upsertError) {
      return {
        error: `話者名の保存に失敗しました: ${upsertError.message}`,
        success: false,
      };
    }

    revalidatePath(`/jobs/${job.id}`);
    return { error: null, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message, success: false };
  }
}

export async function saveExpectedSpeakerCount(
  _previousState: ExpectedSpeakerCountActionState,
  formData: FormData,
): Promise<ExpectedSpeakerCountActionState> {
  const jobId = getTextValue(formData, "jobId");
  const expectedSpeakerCountValue = getTextValue(
    formData,
    "expectedSpeakerCount",
  );
  const expectedSpeakerCount = Number.parseInt(expectedSpeakerCountValue, 10);

  if (!jobId) {
    return { error: "ジョブが指定されていません。", success: false };
  }

  if (
    !Number.isInteger(expectedSpeakerCount)
    || expectedSpeakerCount < 1
    || expectedSpeakerCount > 20
  ) {
    return { error: "想定話者数は1から20の整数で入力してください。", success: false };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "ログインが必要です。", success: false };
    }

    const { data: job, error: jobError } = await supabase
      .from("transcription_jobs")
      .select("id")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return { error: "ジョブが見つかりません。", success: false };
    }

    const adminSupabase = createAdminSupabaseClient();
    const { error: updateError } = await adminSupabase
      .from("transcription_jobs")
      .update({ expected_speaker_count: expectedSpeakerCount })
      .eq("id", job.id)
      .eq("user_id", user.id);

    if (updateError) {
      return {
        error: `想定話者数の保存に失敗しました: ${updateError.message}`,
        success: false,
      };
    }

    revalidatePath(`/jobs/${job.id}`);
    return { error: null, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message, success: false };
  }
}

export async function saveSegmentEdit(
  _previousState: SegmentEditActionState,
  formData: FormData,
): Promise<SegmentEditActionState> {
  const jobId = getTextValue(formData, "jobId");
  const segmentId = getTextValue(formData, "segmentId");
  const editedText = getRawTextValue(formData, "editedText");
  const editedSpeakerLabel = getTextValue(formData, "editedSpeakerLabel");
  const intent = getTextValue(formData, "intent");

  if (!jobId || !segmentId) {
    return { error: "ジョブまたはsegmentが指定されていません。", success: false };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "ログインが必要です。", success: false };
    }

    const { data: segment, error: segmentError } = await supabase
      .from("transcription_segments")
      .select("id, job_id, speaker_label")
      .eq("id", segmentId)
      .eq("job_id", jobId)
      .single();

    if (segmentError || !segment) {
      return { error: "segmentが見つかりません。", success: false };
    }

    const editValues =
      intent === "reset"
        ? {
            edited_text: null,
            edited_speaker_label: null,
          }
        : {
            edited_text: editedText.trim() ? editedText : null,
            edited_speaker_label:
              editedSpeakerLabel && editedSpeakerLabel !== segment.speaker_label
                ? editedSpeakerLabel
                : null,
          };

    const { error: upsertError } = await supabase
      .from("transcription_segment_edits")
      .upsert(
        {
          ...editValues,
          job_id: jobId,
          segment_id: segment.id,
          user_id: user.id,
        },
        { onConflict: "segment_id" },
      );

    if (upsertError) {
      return {
        error: `segment編集の保存に失敗しました: ${upsertError.message}`,
        success: false,
      };
    }

    const { data: savedEdit, error: savedEditError } = await supabase
      .from("transcription_segment_edits")
      .select("edited_text, edited_speaker_label, is_skipped")
      .eq("segment_id", segment.id)
      .maybeSingle();

    if (savedEditError || !savedEdit) {
      return {
        error: `segment編集の再読み込みに失敗しました: ${savedEditError?.message || "not found"}`,
        success: false,
      };
    }

    revalidatePath(`/jobs/${jobId}`);
    return {
      error: null,
      savedEditedText:
        typeof savedEdit.edited_text === "string" && savedEdit.edited_text.trim()
          ? savedEdit.edited_text
          : null,
      savedSpeakerOverride:
        typeof savedEdit.edited_speaker_label === "string" &&
        savedEdit.edited_speaker_label.trim()
          ? savedEdit.edited_speaker_label
          : null,
      savedIsSkipped: Boolean(savedEdit.is_skipped),
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message, success: false };
  }
}

export async function saveSegmentSkip(
  _previousState: SegmentSkipActionState,
  formData: FormData,
): Promise<SegmentSkipActionState> {
  const jobId = getTextValue(formData, "jobId");
  const segmentId = getTextValue(formData, "segmentId");
  const isSkipped = formData.get("isSkipped") === "true";

  if (!jobId || !segmentId) {
    return { error: "ジョブまたはsegmentが指定されていません。", success: false };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "ログインが必要です。", success: false };
    }

    const { data: segment, error: segmentError } = await supabase
      .from("transcription_segments")
      .select("id, job_id")
      .eq("id", segmentId)
      .eq("job_id", jobId)
      .single();

    if (segmentError || !segment) {
      return { error: "segmentが見つかりません。", success: false };
    }

    const { error: upsertError } = await supabase
      .from("transcription_segment_edits")
      .upsert(
        {
          is_skipped: isSkipped,
          job_id: jobId,
          segment_id: segment.id,
          user_id: user.id,
        },
        { onConflict: "segment_id" },
      );

    if (upsertError) {
      return {
        error: `skip状態の保存に失敗しました: ${upsertError.message}`,
        success: false,
      };
    }

    const { data: savedEdit, error: savedEditError } = await supabase
      .from("transcription_segment_edits")
      .select("edited_text, edited_speaker_label, is_skipped")
      .eq("segment_id", segment.id)
      .maybeSingle();

    if (savedEditError || !savedEdit) {
      return {
        error: `skip状態の再読み込みに失敗しました: ${savedEditError?.message || "not found"}`,
        success: false,
      };
    }

    revalidatePath(`/jobs/${jobId}`);
    return {
      error: null,
      savedEditedText:
        typeof savedEdit.edited_text === "string" && savedEdit.edited_text.trim()
          ? savedEdit.edited_text
          : null,
      savedSpeakerOverride:
        typeof savedEdit.edited_speaker_label === "string" &&
        savedEdit.edited_speaker_label.trim()
          ? savedEdit.edited_speaker_label
          : null,
      savedIsSkipped: Boolean(savedEdit.is_skipped),
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message, success: false };
  }
}

export async function saveSegmentSpeaker(
  formData: FormData,
): Promise<SegmentSpeakerActionState> {
  const jobId = getTextValue(formData, "jobId");
  const segmentId = getTextValue(formData, "segmentId");
  const speakerLabel = getTextValue(formData, "speakerLabel");

  if (!jobId || !segmentId || !speakerLabel) {
    return {
      error: "ジョブ、segment、または話者が指定されていません。",
      success: false,
    };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { error: "ログインが必要です。", success: false };
    }

    const { data: segment, error: segmentError } = await supabase
      .from("transcription_segments")
      .select("id, job_id, speaker_label")
      .eq("id", segmentId)
      .eq("job_id", jobId)
      .single();

    if (segmentError || !segment) {
      return { error: "segmentが見つかりません。", success: false };
    }

    const { error: upsertError } = await supabase
      .from("transcription_segment_edits")
      .upsert(
        {
          edited_speaker_label:
            speakerLabel !== segment.speaker_label ? speakerLabel : null,
          job_id: jobId,
          segment_id: segment.id,
          user_id: user.id,
        },
        { onConflict: "segment_id" },
      );

    if (upsertError) {
      return {
        error: `話者変更の保存に失敗しました: ${upsertError.message}`,
        success: false,
      };
    }

    const { data: savedEdit, error: savedEditError } = await supabase
      .from("transcription_segment_edits")
      .select("edited_text, edited_speaker_label, is_skipped")
      .eq("segment_id", segment.id)
      .maybeSingle();

    if (savedEditError || !savedEdit) {
      return {
        error: `話者変更の再読み込みに失敗しました: ${savedEditError?.message || "not found"}`,
        success: false,
      };
    }

    revalidatePath(`/jobs/${jobId}`);
    return {
      error: null,
      savedEditedText:
        typeof savedEdit.edited_text === "string" && savedEdit.edited_text.trim()
          ? savedEdit.edited_text
          : null,
      savedSpeakerOverride:
        typeof savedEdit.edited_speaker_label === "string" &&
        savedEdit.edited_speaker_label.trim()
          ? savedEdit.edited_speaker_label
          : null,
      savedIsSkipped: Boolean(savedEdit.is_skipped),
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message, success: false };
  }
}

function getTextValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getRawTextValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function splitStoragePath(storagePath: string) {
  const parts = storagePath.split("/");
  const filename = parts.pop() || "";

  return {
    directory: parts.join("/"),
    filename,
  };
}

async function deleteJobSourceAudio(options: { bucket: string; path: string }) {
  const adminSupabase = createAdminSupabaseClient();
  const { error } = await adminSupabase.storage
    .from(options.bucket)
    .remove([options.path]);

  return error;
}
