"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  getAudioBucketName,
  validateAudioFileMetadata,
} from "@/lib/storage";
import {
  normalizePriority,
  parseAliases,
  parseDictionaryYaml,
} from "@/lib/term-dictionaries";

export type CreateProjectActionInput = {
  projectId: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
  contentType?: string | null;
  durationSec?: number | null;
  termDictionaryId?: string | null;
};

export type CreateProjectActionState = {
  error: string | null;
  projectId?: string;
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
  metrics?: SegmentSaveMetrics;
  savedEditedText?: string | null;
  savedSpeakerOverride?: string | null;
  savedIsSkipped?: boolean;
  segmentId?: string;
  success: boolean;
};

export type SegmentSkipActionState = {
  error: string | null;
  metrics?: SegmentSaveMetrics;
  savedEditedText?: string | null;
  savedSpeakerOverride?: string | null;
  savedIsSkipped?: boolean;
  segmentId?: string;
  success: boolean;
};

export type SegmentSpeakerActionState = {
  error: string | null;
  metrics?: SegmentSaveMetrics;
  savedEditedText?: string | null;
  savedSpeakerOverride?: string | null;
  savedIsSkipped?: boolean;
  segmentId?: string;
  success: boolean;
};

export type SegmentSaveMetrics = {
  dbElapsedMs: number;
  serverElapsedMs: number;
};

export type DeleteJobActionState = {
  error: string | null;
  success: boolean;
};

export type RetryJobActionState = {
  error: string | null;
  success: boolean;
};

export type TermDictionaryActionState = {
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
  input: CreateProjectActionInput,
): Promise<CreateProjectActionState> {
  const validationError = validateAudioFileMetadata({
    fileName: input.fileName,
    fileSize: input.fileSize,
    contentType: input.contentType,
  });

  if (validationError) {
    return { error: validationError };
  }

  if (!isUuid(input.projectId)) {
    return { error: "プロジェクトIDが不正です。" };
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

    const expectedPathPrefix = `${user.id}/${input.projectId}/`;

    if (!input.storagePath.startsWith(expectedPathPrefix)) {
      return { error: "Storage path がログインユーザーの領域ではありません。" };
    }

    const termDictionaryId =
      input.termDictionaryId && isUuid(input.termDictionaryId)
        ? input.termDictionaryId
        : null;

    if (input.termDictionaryId && !termDictionaryId) {
      return { error: "用語辞書IDが不正です。" };
    }

    if (termDictionaryId) {
      const { data: dictionary, error: dictionaryError } = await supabase
        .from("term_dictionaries")
        .select("id")
        .eq("id", termDictionaryId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (dictionaryError || !dictionary) {
        return { error: "指定された用語辞書が見つからないか、使用権限がありません。" };
      }
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
        id: input.projectId,
        user_id: user.id,
        original_filename: input.fileName,
        storage_bucket: bucketName,
        storage_path: input.storagePath,
        audio_duration_sec: durationSec,
        audio_file_size_bytes: input.fileSize,
        audio_content_type: input.contentType || null,
        term_dictionary_id: termDictionaryId,
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
  return { error: null, projectId: input.projectId };
}

export async function createProjectAction(
  input: CreateProjectActionInput,
): Promise<CreateProjectActionState> {
  const validationError = validateAudioFileMetadata({
    fileName: input.fileName,
    fileSize: input.fileSize,
    contentType: input.contentType,
  });

  if (validationError) {
    return { error: validationError };
  }

  if (!isUuid(input.projectId)) {
    return { error: "プロジェクトIDが不正です。" };
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

    const expectedPathPrefix = `${user.id}/projects/${input.projectId}/source/`;

    if (!input.storagePath.startsWith(expectedPathPrefix)) {
      return { error: "Storage path がログインユーザーの領域ではありません。" };
    }

    const termDictionaryId =
      input.termDictionaryId && isUuid(input.termDictionaryId)
        ? input.termDictionaryId
        : null;

    if (input.termDictionaryId && !termDictionaryId) {
      return { error: "用語辞書IDが不正です。" };
    }

    if (termDictionaryId) {
      const { data: dictionary, error: dictionaryError } = await supabase
        .from("term_dictionaries")
        .select("id")
        .eq("id", termDictionaryId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (dictionaryError || !dictionary) {
        return { error: "指定された用語辞書が見つからないか、使用権限がありません。" };
      }
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

    const title = input.fileName.replace(/\.[^/.]+$/, ""); // Remove extension

    const { error: insertError } = await adminSupabase
      .from("transcription_projects")
      .insert({
        id: input.projectId,
        user_id: user.id,
        title,
        original_filename: input.fileName,
        storage_bucket: bucketName,
        storage_path: input.storagePath,
        total_duration_sec: durationSec,
        part_duration_sec: 1800, // 30 minutes
        status: "queued",
      });

    if (insertError) {
      await adminSupabase.storage.from(bucketName).remove([input.storagePath]);
      return { error: `文字起こしプロジェクトの作成に失敗しました: ${insertError.message}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message };
  }

  revalidatePath("/");
  revalidatePath("/projects");
  return { error: null, projectId: input.projectId };
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

export async function createTermDictionary(
  formData: FormData,
): Promise<void> {
  const name = getTextValue(formData, "name");
  const description = getTextValue(formData, "description");

  if (!name) {
    redirect("/settings/dictionaries?error=missing_name");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("term_dictionaries")
    .insert({
      description: description || null,
      name,
      user_id: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect(
      `/settings/dictionaries?error=${encodeURIComponent(error?.message || "create_failed")}`,
    );
  }

  revalidatePath("/settings/dictionaries");
  redirect(`/settings/dictionaries/${data.id}`);
}

export async function updateTermDictionary(
  _previousState: TermDictionaryActionState,
  formData: FormData,
): Promise<TermDictionaryActionState> {
  const dictionaryId = getTextValue(formData, "dictionaryId");
  const name = getTextValue(formData, "name");
  const description = getTextValue(formData, "description");

  if (!isUuid(dictionaryId) || !name) {
    return { error: "辞書IDまたは辞書名が不正です。", success: false };
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

    const { error } = await supabase
      .from("term_dictionaries")
      .update({ description: description || null, name })
      .eq("id", dictionaryId)
      .eq("user_id", user.id);

    if (error) {
      return { error: `辞書の保存に失敗しました: ${error.message}`, success: false };
    }

    revalidatePath("/settings/dictionaries");
    revalidatePath(`/settings/dictionaries/${dictionaryId}`);
    return { error: null, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message, success: false };
  }
}

export async function deleteTermDictionary(formData: FormData): Promise<void> {
  const dictionaryId = getTextValue(formData, "dictionaryId");

  if (!isUuid(dictionaryId)) {
    redirect("/settings/dictionaries?error=invalid_dictionary");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login");
  }

  await supabase
    .from("term_dictionaries")
    .delete()
    .eq("id", dictionaryId)
    .eq("user_id", user.id);

  revalidatePath("/settings/dictionaries");
  redirect("/settings/dictionaries");
}

export async function createTermDictionaryEntry(
  _previousState: TermDictionaryActionState,
  formData: FormData,
): Promise<TermDictionaryActionState> {
  const dictionaryId = getTextValue(formData, "dictionaryId");
  const term = getTextValue(formData, "term");

  if (!isUuid(dictionaryId) || !term) {
    return { error: "辞書IDまたは用語が不正です。", success: false };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const sortOrder = await getNextTermSortOrder(supabase, dictionaryId);
    const { error } = await supabase.from("term_dictionary_entries").insert({
      aliases: parseAliases(getTextValue(formData, "aliases")),
      category: getTextValue(formData, "category") || null,
      description: getTextValue(formData, "description") || null,
      dictionary_id: dictionaryId,
      is_enabled: formData.get("isEnabled") !== "false",
      priority: normalizePriority(getTextValue(formData, "priority"), 100),
      reading: getTextValue(formData, "reading") || null,
      sort_order: sortOrder,
      term,
    });

    if (error) {
      return { error: `用語の追加に失敗しました: ${error.message}`, success: false };
    }

    revalidatePath(`/settings/dictionaries/${dictionaryId}`);
    return { error: null, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message, success: false };
  }
}

export async function updateTermDictionaryEntry(
  _previousState: TermDictionaryActionState,
  formData: FormData,
): Promise<TermDictionaryActionState> {
  const dictionaryId = getTextValue(formData, "dictionaryId");
  const entryId = getTextValue(formData, "entryId");
  const term = getTextValue(formData, "term");

  if (!isUuid(dictionaryId) || !isUuid(entryId) || !term) {
    return { error: "辞書ID、用語ID、または用語が不正です。", success: false };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase
      .from("term_dictionary_entries")
      .update({
        aliases: parseAliases(getTextValue(formData, "aliases")),
        category: getTextValue(formData, "category") || null,
        description: getTextValue(formData, "description") || null,
        is_enabled: formData.get("isEnabled") === "true",
        priority: normalizePriority(getTextValue(formData, "priority"), 100),
        reading: getTextValue(formData, "reading") || null,
        sort_order: normalizePriority(getTextValue(formData, "sortOrder"), 0),
        term,
      })
      .eq("id", entryId)
      .eq("dictionary_id", dictionaryId);

    if (error) {
      return { error: `用語の保存に失敗しました: ${error.message}`, success: false };
    }

    revalidatePath(`/settings/dictionaries/${dictionaryId}`);
    return { error: null, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { error: message, success: false };
  }
}

export async function deleteTermDictionaryEntry(
  formData: FormData,
): Promise<void> {
  const dictionaryId = getTextValue(formData, "dictionaryId");
  const entryId = getTextValue(formData, "entryId");

  if (!isUuid(dictionaryId) || !isUuid(entryId)) {
    redirect("/settings/dictionaries");
  }

  const supabase = await createServerSupabaseClient();
  await supabase
    .from("term_dictionary_entries")
    .delete()
    .eq("id", entryId)
    .eq("dictionary_id", dictionaryId);

  revalidatePath(`/settings/dictionaries/${dictionaryId}`);
  redirect(`/settings/dictionaries/${dictionaryId}`);
}

export async function moveTermDictionaryEntry(
  formData: FormData,
): Promise<void> {
  const dictionaryId = getTextValue(formData, "dictionaryId");
  const entryId = getTextValue(formData, "entryId");
  const direction = getTextValue(formData, "direction");

  if (!isUuid(dictionaryId) || !isUuid(entryId)) {
    redirect("/settings/dictionaries");
  }

  const supabase = await createServerSupabaseClient();
  const { data: entries } = await supabase
    .from("term_dictionary_entries")
    .select("id, sort_order")
    .eq("dictionary_id", dictionaryId)
    .order("sort_order", { ascending: true })
    .order("priority", { ascending: true })
    .order("term", { ascending: true });
  const rows = (entries || []) as Array<{ id: string; sort_order: number }>;
  const currentIndex = rows.findIndex((row) => row.id === entryId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (currentIndex >= 0 && targetIndex >= 0 && targetIndex < rows.length) {
    const current = rows[currentIndex];
    const target = rows[targetIndex];
    await supabase
      .from("term_dictionary_entries")
      .update({ sort_order: target.sort_order })
      .eq("id", current.id)
      .eq("dictionary_id", dictionaryId);
    await supabase
      .from("term_dictionary_entries")
      .update({ sort_order: current.sort_order })
      .eq("id", target.id)
      .eq("dictionary_id", dictionaryId);
  }

  revalidatePath(`/settings/dictionaries/${dictionaryId}`);
  redirect(`/settings/dictionaries/${dictionaryId}`);
}

export async function importTermDictionaryYaml(
  formData: FormData,
): Promise<void> {
  const textareaYaml = getRawTextValue(formData, "yaml");
  const fileValue = formData.get("yamlFile");
  const fileYaml =
    fileValue &&
    typeof fileValue === "object" &&
    "size" in fileValue &&
    Number(fileValue.size) > 0 &&
    "text" in fileValue &&
    typeof fileValue.text === "function"
      ? await fileValue.text()
      : "";
  const yaml = fileYaml || textareaYaml;

  if (!yaml.trim()) {
    redirect("/settings/dictionaries?error=missing_yaml");
  }

  let parsed: ReturnType<typeof parseDictionaryYaml>;

  try {
    parsed = parseDictionaryYaml(yaml);
  } catch (error) {
    redirect(
      `/settings/dictionaries?error=${encodeURIComponent(
        error instanceof Error ? error.message : "yaml_parse_failed",
      )}`,
    );
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login");
  }

  const { data: dictionary, error: dictionaryError } = await supabase
    .from("term_dictionaries")
    .insert({
      description: parsed.description,
      name: parsed.name,
      user_id: user.id,
    })
    .select("id")
    .single();

  if (dictionaryError || !dictionary) {
    redirect(
      `/settings/dictionaries?error=${encodeURIComponent(
        dictionaryError?.message || "import_failed",
      )}`,
    );
  }

  const { error: entriesError } = await supabase
    .from("term_dictionary_entries")
    .insert(
      parsed.terms.map((term, index) => ({
        aliases: term.aliases,
        category: term.category,
        description: term.description,
        dictionary_id: dictionary.id,
        priority: term.priority,
        reading: term.reading,
        sort_order: index,
        term: term.term,
      })),
    );

  if (entriesError) {
    redirect(
      `/settings/dictionaries/${dictionary.id}?error=${encodeURIComponent(entriesError.message)}`,
    );
  }

  revalidatePath("/settings/dictionaries");
  redirect(`/settings/dictionaries/${dictionary.id}`);
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
  const actionStartedAt = Date.now();
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

    debugSegmentSaveMetric("saveSegmentEdit:upsert:start", {
      segmentId,
    });
    const dbStartedAt = Date.now();
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
    const dbElapsedMs = Date.now() - dbStartedAt;
    debugSegmentSaveMetric("saveSegmentEdit:upsert:end", {
      dbElapsedMs,
      segmentId,
    });

    if (upsertError) {
      return {
        error: `segment編集の保存に失敗しました: ${upsertError.message}`,
        metrics: buildSegmentSaveMetrics(actionStartedAt, dbElapsedMs),
        segmentId,
        success: false,
      };
    }

    const savedEditedText =
      intent === "reset" ? null : editedText.trim() ? editedText : null;
    const savedSpeakerOverride =
      intent === "reset"
        ? null
        : editedSpeakerLabel && editedSpeakerLabel !== segment.speaker_label
          ? editedSpeakerLabel
          : null;
    const metrics = buildSegmentSaveMetrics(actionStartedAt, dbElapsedMs);
    debugSegmentSaveMetric("saveSegmentEdit:end", {
      ...metrics,
      segmentId,
    });
    return {
      error: null,
      metrics,
      savedEditedText,
      savedSpeakerOverride,
      segmentId,
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return {
      error: message,
      metrics: buildSegmentSaveMetrics(actionStartedAt, 0),
      segmentId,
      success: false,
    };
  }
}

export async function saveSegmentSkip(
  _previousState: SegmentSkipActionState,
  formData: FormData,
): Promise<SegmentSkipActionState> {
  const actionStartedAt = Date.now();
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

    debugSegmentSaveMetric("saveSegmentSkip:upsert:start", {
      segmentId,
    });
    const dbStartedAt = Date.now();
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
    const dbElapsedMs = Date.now() - dbStartedAt;
    debugSegmentSaveMetric("saveSegmentSkip:upsert:end", {
      dbElapsedMs,
      segmentId,
    });

    if (upsertError) {
      return {
        error: `skip状態の保存に失敗しました: ${upsertError.message}`,
        metrics: buildSegmentSaveMetrics(actionStartedAt, dbElapsedMs),
        segmentId,
        success: false,
      };
    }

    const metrics = buildSegmentSaveMetrics(actionStartedAt, dbElapsedMs);
    debugSegmentSaveMetric("saveSegmentSkip:end", {
      ...metrics,
      segmentId,
    });
    return {
      error: null,
      metrics,
      savedIsSkipped: isSkipped,
      segmentId,
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return {
      error: message,
      metrics: buildSegmentSaveMetrics(actionStartedAt, 0),
      segmentId,
      success: false,
    };
  }
}

export async function saveSegmentSpeaker(
  formData: FormData,
): Promise<SegmentSpeakerActionState> {
  const actionStartedAt = Date.now();
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

    debugSegmentSaveMetric("saveSegmentSpeaker:upsert:start", {
      segmentId,
    });
    const dbStartedAt = Date.now();
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
    const dbElapsedMs = Date.now() - dbStartedAt;
    debugSegmentSaveMetric("saveSegmentSpeaker:upsert:end", {
      dbElapsedMs,
      segmentId,
    });

    if (upsertError) {
      return {
        error: `話者変更の保存に失敗しました: ${upsertError.message}`,
        metrics: buildSegmentSaveMetrics(actionStartedAt, dbElapsedMs),
        segmentId,
        success: false,
      };
    }

    const savedSpeakerOverride =
      speakerLabel !== segment.speaker_label ? speakerLabel : null;
    const metrics = buildSegmentSaveMetrics(actionStartedAt, dbElapsedMs);
    debugSegmentSaveMetric("saveSegmentSpeaker:end", {
      ...metrics,
      segmentId,
    });
    return {
      error: null,
      metrics,
      savedSpeakerOverride,
      segmentId,
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return {
      error: message,
      metrics: buildSegmentSaveMetrics(actionStartedAt, 0),
      segmentId,
      success: false,
    };
  }
}

function getTextValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function getNextTermSortOrder(supabase: SupabaseClient, dictionaryId: string) {
  const { data } = await supabase
    .from("term_dictionary_entries")
    .select("sort_order")
    .eq("dictionary_id", dictionaryId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastSortOrder =
    data &&
    typeof data === "object" &&
    "sort_order" in data &&
    typeof data.sort_order === "number"
      ? data.sort_order
      : -1;

  return lastSortOrder + 1;
}

function buildSegmentSaveMetrics(
  actionStartedAt: number,
  dbElapsedMs: number,
) {
  return {
    dbElapsedMs,
    serverElapsedMs: Date.now() - actionStartedAt,
  };
}

function debugSegmentSaveMetric(
  event: string,
  payload: Record<string, unknown>,
) {
  if (process.env.NODE_ENV !== "production" || process.env.DEBUG_SEGMENT_SAVE === "1") {
    console.debug("[save-segment]", {
      event,
      ...payload,
    });
  }
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
