import "server-only";

import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripeClient } from "@/lib/stripe";
import { type TipStatus } from "@/lib/tips";

export type StripeTipSyncResult = {
  imported: number;
  skipped: number;
  warnings: string[];
};

type TipUpsert = {
  amount: number;
  artist_id: string | null;
  currency: string;
  paid_at: string | null;
  payout_month: string;
  status: TipStatus;
  stripe_customer_email: string | null;
  stripe_description: string | null;
  stripe_checkout_session_id: string;
  stripe_metadata: Record<string, string>;
  stripe_payment_link_id: string | null;
  stripe_payment_link_metadata: Record<string, string> | null;
  stripe_payment_link_name: string | null;
  stripe_payment_link_url: string | null;
  stripe_payment_intent_id: string | null;
  stripe_product_name: string | null;
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
  const warnings: string[] = [];
  const tip = await buildTipUpsert(session, supabase, warnings, statusOverride);

  if (!tip) {
    return { didImport: false, warnings };
  }

  const { error } = await supabase.from("tips").upsert(tip, {
    onConflict: "stripe_checkout_session_id",
  });

  if (error) {
    throw new Error(`tips upsert failed: ${error.message}`);
  }

  return { didImport: true, warnings };
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
  const warnings: string[] = [];

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
      const result = await upsertTipFromCheckoutSession({
        session,
        supabase,
      });

      warnings.push(...result.warnings);

      if (result.didImport) {
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

  return { imported, skipped, warnings };
}

async function buildTipUpsert(
  session: Stripe.Checkout.Session,
  supabase: SupabaseClient,
  warnings: string[],
  statusOverride?: TipStatus,
): Promise<TipUpsert | null> {
  if (session.mode !== "payment") {
    return null;
  }

  const paymentIntent = await loadPaymentIntent(session.payment_intent, warnings);

  if (session.payment_status !== "paid" && !paymentIntent) {
    return null;
  }

  const charge = await loadCharge(paymentIntent?.latest_charge ?? null, warnings);
  const paymentLink = await loadPaymentLink(session, warnings);
  const paymentLinkMetadata = normalizeMetadata(paymentLink?.metadata);
  const productName = await loadProductName(session, paymentLink, warnings);
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
  const existingArtistId = await loadExistingTipArtistId(supabase, session.id);
  const metadataArtistId =
    getMetadataValue(normalizeMetadata(session.metadata), "artist_id") ||
    getMetadataValue(paymentLinkMetadata, "artist_id");
  const resolvedArtistId =
    existingArtistId || (await resolveExistingArtistId(supabase, metadataArtistId));
  const status = statusOverride ?? deriveTipStatus(session, paymentIntent, charge);
  const eventTime = new Date(
    ((charge?.created || paymentIntent?.created || session.created) ?? session.created) *
      1000,
  ).toISOString();
  const paidAt = status === "paid" ? eventTime : null;

  return {
    amount,
    artist_id: resolvedArtistId,
    currency,
    paid_at: paidAt,
    payout_month: `${eventTime.slice(0, 7)}-01`,
    status,
    stripe_customer_email:
      session.customer_details?.email ||
      session.customer_email ||
      paymentIntent?.receipt_email ||
      charge?.billing_details.email ||
      null,
    stripe_checkout_session_id: session.id,
    stripe_description: charge?.description || paymentIntent?.description || null,
    stripe_metadata: metadata,
    stripe_payment_link_id: paymentLink?.id ?? getStripeId(session.payment_link),
    stripe_payment_link_metadata:
      Object.keys(paymentLinkMetadata).length > 0 ? paymentLinkMetadata : null,
    stripe_payment_link_name: paymentLink ? getPaymentLinkName(paymentLink) : null,
    stripe_payment_link_url: paymentLink?.url || null,
    stripe_payment_intent_id: paymentIntent?.id ?? getStripeId(session.payment_intent),
    stripe_product_name: productName,
    tip_type: getMetadataValue(metadata, "tip_type") || "tip",
  };
}

async function loadExistingTipArtistId(
  supabase: SupabaseClient,
  checkoutSessionId: string,
) {
  const { data, error } = await supabase
    .from("tips")
    .select("artist_id")
    .eq("stripe_checkout_session_id", checkoutSessionId)
    .maybeSingle();

  if (error) {
    throw new Error(`existing tip lookup failed: ${error.message}`);
  }

  return typeof data?.artist_id === "string" && data.artist_id.trim()
    ? data.artist_id
    : null;
}

async function resolveExistingArtistId(
  supabase: SupabaseClient,
  artistId: string,
) {
  if (!artistId) {
    return null;
  }

  const { data, error } = await supabase
    .from("artists")
    .select("id")
    .eq("id", artistId)
    .maybeSingle();

  if (error) {
    throw new Error(`artist lookup failed: ${error.message}`);
  }

  return data?.id || null;
}

async function loadPaymentIntent(
  value: string | Stripe.PaymentIntent | null,
  warnings: string[],
) {
  if (!value) {
    return null;
  }

  if (typeof value !== "string") {
    return value;
  }

  try {
    return await getStripeClient().paymentIntents.retrieve(value, {
      expand: ["latest_charge"],
    });
  } catch (error) {
    warnings.push(
      `payment intent retrieve failed for ${value}: ${getErrorMessage(error)}`,
    );

    return null;
  }
}

async function loadCharge(value: string | Stripe.Charge | null, warnings: string[]) {
  if (!value) {
    return null;
  }

  if (typeof value !== "string") {
    return value;
  }

  try {
    return await getStripeClient().charges.retrieve(value);
  } catch (error) {
    warnings.push(`charge retrieve failed for ${value}: ${getErrorMessage(error)}`);

    return null;
  }
}

async function loadPaymentLink(
  session: Stripe.Checkout.Session,
  warnings: string[],
) {
  const paymentLinkId = getStripeId(session.payment_link);

  if (!paymentLinkId) {
    return null;
  }

  if (typeof session.payment_link !== "string") {
    return session.payment_link;
  }

  try {
    return await getStripeClient().paymentLinks.retrieve(paymentLinkId);
  } catch (error) {
    warnings.push(
      `payment link retrieve failed for ${paymentLinkId}: ${getErrorMessage(error)}`,
    );

    return null;
  }
}

async function loadProductName(
  session: Stripe.Checkout.Session,
  paymentLink: Stripe.PaymentLink | null,
  warnings: string[],
) {
  const sessionProductName = await loadCheckoutSessionProductName(session, warnings);

  if (sessionProductName) {
    return sessionProductName;
  }

  if (!paymentLink) {
    return null;
  }

  try {
    const lineItems = await getStripeClient().paymentLinks.listLineItems(
      paymentLink.id,
      {
        expand: ["data.price.product"],
        limit: 1,
      },
    );

    return getLineItemProductName(lineItems.data[0]);
  } catch (error) {
    warnings.push(
      `payment link line items retrieve failed for ${paymentLink.id}: ${getErrorMessage(error)}`,
    );

    return null;
  }
}

async function loadCheckoutSessionProductName(
  session: Stripe.Checkout.Session,
  warnings: string[],
) {
  try {
    const lineItems = await getStripeClient().checkout.sessions.listLineItems(
      session.id,
      {
        expand: ["data.price.product"],
        limit: 1,
      },
    );

    return getLineItemProductName(lineItems.data[0]);
  } catch (error) {
    warnings.push(
      `checkout session line items retrieve failed for ${session.id}: ${getErrorMessage(error)}`,
    );

    return null;
  }
}

function getLineItemProductName(lineItem: Stripe.LineItem | undefined) {
  const product = lineItem?.price?.product;

  if (product && typeof product !== "string" && !product.deleted) {
    return product.name || lineItem.description || null;
  }

  return lineItem?.description || null;
}

function mergeMetadata(
  ...items: Array<Stripe.Metadata | null | undefined>
): Record<string, string> {
  return Object.assign({}, ...items);
}

function normalizeMetadata(
  metadata: Stripe.Metadata | null | undefined,
): Record<string, string> {
  return Object.assign({}, metadata);
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

function getPaymentLinkName(paymentLink: Stripe.PaymentLink) {
  return getObjectString(paymentLink, "name");
}

function getObjectString(value: object, key: string) {
  const record = value as Record<string, unknown>;
  const field = record[key];

  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getStripeId(
  value:
    | string
    | Stripe.PaymentIntent
    | Stripe.PaymentLink
    | null,
) {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.id;
}
