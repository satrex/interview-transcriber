"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { importCheckoutSessionsForMonth } from "@/lib/stripe-tip-sync";
import {
  assertCurrentUserIsAdmin,
  getTipPayoutFeeBps,
  normalizePayoutMonth,
} from "@/lib/tips";

export async function closeMonthlyArtistPayouts(formData: FormData) {
  const { supabase } = await requireAdmin();

  const payoutMonth = normalizePayoutMonth(getFormString(formData, "month"));
  const feeBps = getTipPayoutFeeBps();
  const { error } = await supabase.rpc("close_monthly_artist_payouts", {
    p_fee_bps: feeBps,
    p_payout_month: payoutMonth,
  });

  if (error) {
    throw new Error(`月次締めに失敗しました: ${error.message}`);
  }

  revalidatePath(`/admin/tips?month=${payoutMonth.slice(0, 7)}`);
}

export async function importStripeTipsForMonth(formData: FormData) {
  await requireAdmin();

  const payoutMonth = normalizePayoutMonth(getFormString(formData, "month"));
  const supabase = createAdminSupabaseClient();

  await importCheckoutSessionsForMonth({
    month: payoutMonth,
    supabase,
  });

  revalidatePath(`/admin/tips?month=${payoutMonth.slice(0, 7)}`);
}

export async function assignTipArtist(formData: FormData) {
  await requireAdmin();

  const tipId = getFormString(formData, "tipId");
  const month = normalizePayoutMonth(getFormString(formData, "month"));
  const artistId = getFormString(formData, "artistId");
  const tipType = getFormString(formData, "tipType") || "tip";

  if (!tipId) {
    throw new Error("tipId が指定されていません。");
  }

  if (!artistId) {
    throw new Error("artistId を入力してください。");
  }

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("tips")
    .update({
      artist_id: artistId,
      tip_type: tipType,
    })
    .eq("id", tipId);

  if (error) {
    throw new Error(`投げ銭の紐づけに失敗しました: ${error.message}`);
  }

  revalidatePath(`/admin/tips?month=${month.slice(0, 7)}`);
}

export async function markPayoutNotified(formData: FormData) {
  await updatePayoutTask(formData, {
    notification_status: "notified",
    notified_at: new Date().toISOString(),
  });
}

export async function markPayoutPaid(formData: FormData) {
  await updatePayoutTask(formData, {
    paid_at: new Date().toISOString(),
    payout_status: "paid",
  });
}

async function updatePayoutTask(
  formData: FormData,
  values: Record<string, string>,
) {
  await requireAdmin();

  const payoutId = getFormString(formData, "payoutId");
  const month = normalizePayoutMonth(getFormString(formData, "month"));

  if (!payoutId) {
    throw new Error("payoutId が指定されていません。");
  }

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("monthly_artist_payouts")
    .update(values)
    .eq("id", payoutId);

  if (error) {
    throw new Error(`支払タスク更新に失敗しました: ${error.message}`);
  }

  revalidatePath(`/admin/tips?month=${month.slice(0, 7)}`);
}

async function requireAdmin() {
  const result = await assertCurrentUserIsAdmin();

  if (!result.isAdmin) {
    throw new Error("管理者権限が必要です。");
  }

  return result;
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}
