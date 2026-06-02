"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertCurrentUserIsAdmin } from "@/lib/tips";

export type ArtistFormState = {
  error: string | null;
};

const ARTIST_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export async function createArtist(
  _previousState: ArtistFormState,
  formData: FormData,
): Promise<ArtistFormState> {
  await requireAdmin();

  const id = getFormString(formData, "id");
  const displayName = getFormString(formData, "displayName");
  const validationError = validateArtistInput({ displayName, id });

  if (validationError) {
    return { error: validationError };
  }

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.from("artists").insert({
    display_name: displayName,
    id,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "同じ id のアーティストがすでに登録されています。" };
    }

    return { error: `アーティストの登録に失敗しました: ${error.message}` };
  }

  revalidatePath("/admin/artists");
  revalidatePath("/admin/tips");
  redirect("/admin/artists");
}

export async function updateArtist(
  _previousState: ArtistFormState,
  formData: FormData,
): Promise<ArtistFormState> {
  await requireAdmin();

  const id = getFormString(formData, "id");
  const displayName = getFormString(formData, "displayName");

  if (!id) {
    return { error: "id が指定されていません。" };
  }

  if (!displayName) {
    return { error: "display_name を入力してください。" };
  }

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("artists")
    .update({
      display_name: displayName,
    })
    .eq("id", id);

  if (error) {
    return { error: `アーティストの更新に失敗しました: ${error.message}` };
  }

  revalidatePath("/admin/artists");
  revalidatePath(`/admin/artists/${id}/edit`);
  revalidatePath("/admin/tips");
  redirect("/admin/artists");
}

async function requireAdmin() {
  const result = await assertCurrentUserIsAdmin();

  if (!result.isAdmin) {
    throw new Error("管理者権限が必要です。");
  }
}

function validateArtistInput({
  displayName,
  id,
}: {
  displayName: string;
  id: string;
}) {
  if (!id) {
    return "id を入力してください。";
  }

  if (!displayName) {
    return "display_name を入力してください。";
  }

  if (/\s/.test(id)) {
    return "id に空白は使えません。";
  }

  if (!ARTIST_ID_PATTERN.test(id)) {
    return "id は半角英数字、ハイフン、アンダースコアで入力してください。";
  }

  return null;
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}
