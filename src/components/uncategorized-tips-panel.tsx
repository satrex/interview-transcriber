"use client";

import { TipArtistAssignmentForm } from "@/components/tip-artist-assignment-form";
import type {
  ArtistCandidate,
  TipRow,
} from "@/lib/tips";

type UncategorizedTipsPanelProps = {
  artists: ArtistCandidate[];
  displayMonth: string;
  tips: TipRow[];
};

export function UncategorizedTipsPanel({
  artists,
  displayMonth,
  tips,
}: UncategorizedTipsPanelProps) {
  if (tips.length === 0) {
    return null;
  }

  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold">未分類の投げ銭</h2>
      {artists.length === 0 ? (
        <p className="mt-3 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-amber-950">
          アーティストが未登録です。public.artists に display_name を登録すると、ここで選択できます。
        </p>
      ) : null}
      <div className="mt-4 grid gap-3">
        {tips.map((tip) => (
          <article
            key={tip.id}
            className="rounded-md border border-amber-200 bg-amber-50 p-4"
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)]">
              <div>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <Info label="決済日時" value={formatDateTime(tip.paid_at || tip.created_at)} />
                  <Info label="金額" value={formatMinorCurrency(tip.amount, tip.currency)} />
                  <Info label="通貨" value={tip.currency.toUpperCase()} />
                </div>
                <div className="mt-3 rounded-md bg-white/70 p-3 text-xs text-amber-950">
                  <p className="break-all font-mono">
                    {tip.stripe_payment_intent_id || tip.stripe_checkout_session_id}
                  </p>
                  <PaymentLinkDetails tip={tip} />
                  {tip.stripe_description ? (
                    <p className="mt-2">description: {tip.stripe_description}</p>
                  ) : null}
                  {tip.stripe_customer_email ? (
                    <p className="mt-1">customer_email: {tip.stripe_customer_email}</p>
                  ) : null}
                  {Object.keys(tip.stripe_metadata || {}).length > 0 ? (
                    <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono">
                      {JSON.stringify(tip.stripe_metadata, null, 2)}
                    </pre>
                  ) : null}
                </div>
              </div>

              <TipArtistAssignmentForm
                artists={artists}
                displayMonth={displayMonth}
                tipId={tip.id}
                tipType={tip.tip_type}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PaymentLinkDetails({ tip }: { tip: TipRow }) {
  const paymentLinkLabel = tip.stripe_payment_link_name || tip.stripe_payment_link_id;
  const metadataArtistId = tip.stripe_payment_link_metadata?.artist_id;
  const metadataArtistName = tip.stripe_payment_link_metadata?.artist_name;

  return (
    <div className="mt-2 grid gap-1">
      {paymentLinkLabel ? <p>payment_link: {paymentLinkLabel}</p> : null}
      {tip.stripe_product_name ? <p>product: {tip.stripe_product_name}</p> : null}
      {metadataArtistId ? (
        <p>payment_link.metadata.artist_id: {metadataArtistId}</p>
      ) : null}
      {metadataArtistName ? (
        <p>payment_link.metadata.artist_name: {metadataArtistName}</p>
      ) : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-amber-900">{label}</p>
      <p className="mt-1 font-semibold text-amber-950">{value}</p>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ja-JP");
}

function formatMinorCurrency(amount: number, currency: string) {
  const normalizedCurrency = currency.toUpperCase();
  const zeroDecimalCurrencies = new Set([
    "BIF",
    "CLP",
    "DJF",
    "GNF",
    "JPY",
    "KMF",
    "KRW",
    "MGA",
    "PYG",
    "RWF",
    "UGX",
    "VND",
    "VUV",
    "XAF",
    "XOF",
    "XPF",
  ]);
  const divisor = zeroDecimalCurrencies.has(normalizedCurrency) ? 1 : 100;

  return new Intl.NumberFormat("ja-JP", {
    currency: normalizedCurrency,
    style: "currency",
  }).format(amount / divisor);
}
