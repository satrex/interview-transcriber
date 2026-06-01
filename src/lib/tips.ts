import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type TipStatus = "paid" | "failed" | "refunded";
export type PayoutNotificationStatus = "pending" | "notified";
export type ArtistPayoutStatus = "pending" | "paid";

export type TipRow = {
  id: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string | null;
  artist_id: string | null;
  artists: ArtistCandidate | null;
  tip_type: string;
  amount: number;
  currency: string;
  status: TipStatus;
  paid_at: string | null;
  payout_month: string;
  stripe_customer_email: string | null;
  stripe_description: string | null;
  stripe_metadata: Record<string, string>;
  created_at: string;
};

export type ArtistCandidate = {
  display_name: string;
  id: string;
};

export type MonthlyArtistPayoutRow = {
  id: string;
  artist_id: string;
  payout_month: string;
  gross_amount: number;
  fee_amount: number;
  net_amount: number;
  currency: string;
  notification_status: PayoutNotificationStatus;
  payout_status: ArtistPayoutStatus;
  notified_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizePayoutMonth(input: string | null | undefined) {
  const value = input?.trim();
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  const now = new Date();

  if (!match) {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
      2,
      "0",
    )}-01`;
  }

  return `${match[1]}-${match[2]}-01`;
}

export function formatPayoutMonth(month: string) {
  return month.slice(0, 7);
}

export function getTipPayoutFeeBps() {
  const rawValue = process.env.TIP_PAYOUT_FEE_BPS || "0";
  const feeBps = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) {
    return 0;
  }

  return feeBps;
}

export async function assertCurrentUserIsAdmin() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { isAdmin: false, supabase, user: null };
  }

  const { data, error } = await supabase.rpc("is_current_user_admin");

  if (error) {
    throw new Error(`管理者権限の確認に失敗しました: ${error.message}`);
  }

  return { isAdmin: data === true, supabase, user };
}

export function formatMinorCurrency(amount: number, currency: string) {
  const normalizedCurrency = currency.toUpperCase();
  const zeroDecimalCurrencies = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
  const divisor = zeroDecimalCurrencies.has(normalizedCurrency) ? 1 : 100;

  return new Intl.NumberFormat("ja-JP", {
    currency: normalizedCurrency,
    style: "currency",
  }).format(amount / divisor);
}
