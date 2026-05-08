"use server";

import { revalidatePath } from "next/cache";
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
  savedIsSkipped?: boolean;
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
  const isSkipped = formData.get("isSkipped") === "on";
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
      .select("id, job_id")
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
          }
        : {
            edited_text: editedText.trim() ? editedText : null,
            is_skipped: isSkipped,
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
      .select("edited_text, is_skipped")
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
