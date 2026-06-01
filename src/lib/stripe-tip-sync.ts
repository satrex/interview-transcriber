import "server-only";

import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripeClient } from "@/lib/stripe";
import {
  UNCATEGORIZED_TIP_ARTIST_ID,
  UNCATEGORIZED_TIP_EVENT_ID,
  type TipStatus,
} from "@/lib/tips";

export type StripeTipSyncResult = {
  imported: number;
  skipped: number;
};

type TipUpsert = {
  amount: number;
  artist_id: string;
  currency: string;
  event_id: string;
  paid_at: string | null;
  payout_month: string;
  status: TipStatus;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string | null;
  tip_type: string;
};

export async function upsertTipFromCheckoutSession({
  session,
  statusOverride,
  supabase,
}: {
  session: Stripe.Checkout.Session;
  statusOverride?: TipStatus;
  supabase: SupabaseClient;
}) {
  const tip = await buildTipUpsert(session, statusOverride);

  if (!tip) {
    return false;
  }

  const { error } = await supabase.from("tips").upsert(tip, {
    onConflict: "stripe_checkout_session_id",
  });

  if (error) {
    throw new Error(`tips upsert failed: ${error.message}`);
  }

  return true;
}

export async function importCheckoutSessionsForMonth({
  month,
  supabase,
}: {
  month: string;
  supabase: SupabaseClient;
}): Promise<StripeTipSyncResult> {
  const stripe = getStripeClient();
  const start = Math.floor(new Date(`${month}T00:00:00.000Z`).getTime() / 1000);
  const endDate = new Date(`${month}T00:00:00.000Z`);

  endDate.setUTCMonth(endDate.getUTCMonth() + 1);

  const end = Math.floor(endDate.getTime() / 1000) - 1;
  let startingAfter: string | undefined;
  let imported = 0;
  let skipped = 0;

  for (;;) {
    const sessions = await stripe.checkout.sessions.list({
      created: {
        gte: start,
        lte: end,
      },
      expand: ["data.payment_intent"],
      limit: 100,
      starting_after: startingAfter,
    });

    for (const session of sessions.data) {
      const didImport = await upsertTipFromCheckoutSession({
        session,
        supabase,
      });

      if (didImport) {
        imported += 1;
      } else {
        skipped += 1;
      }
    }

    if (!sessions.has_more || sessions.data.length === 0) {
      break;
    }

    startingAfter = sessions.data.at(-1)?.id;
  }

  return { imported, skipped };
}

async function buildTipUpsert(
  session: Stripe.Checkout.Session,
  statusOverride?: TipStatus,
): Promise<TipUpsert | null> {
  if (session.mode !== "payment") {
    return null;
  }

  const paymentIntent = await loadPaymentIntent(session.payment_intent);

  if (session.payment_status !== "paid" && !paymentIntent) {
    return null;
  }

  const charge = await loadCharge(paymentIntent?.latest_charge ?? null);
  const amount =
    session.amount_total ??
    paymentIntent?.amount_received ??
    paymentIntent?.amount ??
    charge?.amount ??
    null;
  const currency = (
    session.currency ||
    paymentIntent?.currency ||
    charge?.currency ||
    ""
  ).toLowerCase();

  if (amount === null || amount <= 0 || !currency) {
    return null;
  }

  const metadata = mergeMetadata(
    charge?.metadata,
    paymentIntent?.metadata,
    session.metadata,
  );
  const status = statusOverride ?? deriveTipStatus(session, paymentIntent, charge);
  const eventTime = new Date(
    ((charge?.created || paymentIntent?.created || session.created) ?? session.created) *
      1000,
  ).toISOString();
  const paidAt = status === "paid" ? eventTime : null;

  return {
    amount,
    artist_id: getMetadataValue(metadata, "artist_id") || UNCATEGORIZED_TIP_ARTIST_ID,
    currency,
    event_id: getMetadataValue(metadata, "event_id") || UNCATEGORIZED_TIP_EVENT_ID,
    paid_at: paidAt,
    payout_month: `${eventTime.slice(0, 7)}-01`,
    status,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntent?.id ?? getStripeId(session.payment_intent),
    tip_type: getMetadataValue(metadata, "tip_type") || "tip",
  };
}

async function loadPaymentIntent(
  value: string | Stripe.PaymentIntent | null,
) {
  if (!value) {
    return null;
  }

  if (typeof value !== "string") {
    return value;
  }

  return getStripeClient().paymentIntents.retrieve(value, {
    expand: ["latest_charge"],
  });
}

async function loadCharge(value: string | Stripe.Charge | null) {
  if (!value) {
    return null;
  }

  if (typeof value !== "string") {
    return value;
  }

  return getStripeClient().charges.retrieve(value);
}

function mergeMetadata(
  ...items: Array<Stripe.Metadata | null | undefined>
): Record<string, string> {
  return Object.assign({}, ...items);
}

function getMetadataValue(metadata: Record<string, string>, key: string) {
  return metadata[key]?.trim() || "";
}

function deriveTipStatus(
  session: Stripe.Checkout.Session,
  paymentIntent: Stripe.PaymentIntent | null,
  charge: Stripe.Charge | null,
): TipStatus {
  if (charge?.refunded || (charge?.amount_refunded ?? 0) >= (charge?.amount ?? 1)) {
    return "refunded";
  }

  if (session.payment_status === "paid" || paymentIntent?.status === "succeeded") {
    return "paid";
  }

  return "failed";
}

function getStripeId(value: string | Stripe.PaymentIntent | null) {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.id;
}
