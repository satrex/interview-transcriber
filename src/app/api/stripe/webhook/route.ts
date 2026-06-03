import Stripe from "stripe";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { upsertTipFromCheckoutSession } from "@/lib/stripe-tip-sync";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return Response.json({ error: "missing_signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    const rawBody = await request.text();
    event = getStripeClient().webhooks.constructEvent(
      rawBody,
      signature,
      getStripeWebhookSecret(),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid signature";

    return Response.json(
      { error: "signature_verification_failed", message },
      { status: 400 },
    );
  }

  try {
    if (event.type === "checkout.session.completed") {
      await saveCompletedCheckoutSession(
        event.data.object as Stripe.Checkout.Session,
      );
    } else if (event.type === "checkout.session.async_payment_failed") {
      await saveFailedCheckoutSession(event.data.object as Stripe.Checkout.Session);
    } else if (event.type === "charge.refunded") {
      await markTipRefunded(event.data.object as Stripe.Charge);
    } else if (event.type === "payment_intent.payment_failed") {
      await markPaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "webhook handling failed";

    return Response.json({ error: "webhook_handler_failed", message }, { status: 500 });
  }

  return Response.json({ received: true });
}

async function saveCompletedCheckoutSession(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") {
    return;
  }

  const result = await upsertTipFromCheckoutSession({
    session,
    statusOverride: "paid",
    supabase: createAdminSupabaseClient(),
  });

  logStripeTipSyncWarnings(result.warnings);
}

async function saveFailedCheckoutSession(session: Stripe.Checkout.Session) {
  const result = await upsertTipFromCheckoutSession({
    session,
    statusOverride: "failed",
    supabase: createAdminSupabaseClient(),
  });

  logStripeTipSyncWarnings(result.warnings);
}

async function markPaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("tips")
    .update({ status: "failed" })
    .eq("stripe_payment_intent_id", paymentIntent.id);

  if (error) {
    throw new Error(`payment intent failure update failed: ${error.message}`);
  }
}

async function markTipRefunded(charge: Stripe.Charge) {
  const paymentIntentId = getStripeId(charge.payment_intent);

  if (!paymentIntentId) {
    return;
  }

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("tips")
    .update({ status: "refunded" })
    .eq("stripe_payment_intent_id", paymentIntentId);

  if (error) {
    throw new Error(`tip refund update failed: ${error.message}`);
  }
}

function getStripeId(value: string | Stripe.PaymentIntent | null) {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.id;
}

function logStripeTipSyncWarnings(warnings: string[]) {
  for (const warning of warnings) {
    console.warn(`[stripe-tip-sync] ${warning}`);
  }
}
