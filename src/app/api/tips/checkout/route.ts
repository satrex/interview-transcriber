import { getStripeClient } from "@/lib/stripe";

export const runtime = "nodejs";

type CheckoutTipRequest = {
  amount?: unknown;
  artistId?: unknown;
  cancelUrl?: unknown;
  currency?: unknown;
  successUrl?: unknown;
  tipType?: unknown;
};

export async function POST(request: Request) {
  let body: CheckoutTipRequest;

  try {
    body = (await request.json()) as CheckoutTipRequest;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const artistId = getRequiredString(body.artistId);
  const tipType = getRequiredString(body.tipType) || "tip";
  const currency = (getRequiredString(body.currency) || "jpy").toLowerCase();
  const amount = typeof body.amount === "number" ? Math.round(body.amount) : 0;

  if (!artistId) {
    return Response.json({ error: "artist_id_required" }, { status: 400 });
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return Response.json({ error: "positive_amount_required" }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const successUrl =
    getRequiredString(body.successUrl) ||
    process.env.STRIPE_TIP_SUCCESS_URL ||
    `${origin}/`;
  const cancelUrl =
    getRequiredString(body.cancelUrl) ||
    process.env.STRIPE_TIP_CANCEL_URL ||
    `${origin}/`;
  const metadata = {
    artist_id: artistId,
    tip_type: tipType,
  };
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
    cancel_url: cancelUrl,
    line_items: [
      {
        price_data: {
          currency,
          product_data: {
            name: "Artist tip",
          },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    metadata,
    mode: "payment",
    payment_intent_data: {
      metadata,
    },
    success_url: successUrl,
  });

  return Response.json({
    id: session.id,
    url: session.url,
  });
}

function getRequiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
