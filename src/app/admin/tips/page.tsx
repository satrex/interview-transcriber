import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  closeMonthlyArtistPayouts,
  importStripeTipsForMonth,
  markPayoutNotified,
  markPayoutPaid,
} from "@/app/admin/tips/actions";
import { UncategorizedTipsPanel } from "@/components/uncategorized-tips-panel";
import {
  assertCurrentUserIsAdmin,
  formatMinorCurrency,
  formatPayoutMonth,
  normalizePayoutMonth,
  UNCATEGORIZED_TIP_ARTIST_ID,
  type ArtistCandidate,
  type MonthlyArtistPayoutRow,
  type TipRow,
} from "@/lib/tips";

type AdminTipsPageProps = {
  searchParams: Promise<{
    month?: string;
  }>;
};

export default async function AdminTipsPage({
  searchParams,
}: AdminTipsPageProps) {
  const { month } = await searchParams;
  const payoutMonth = normalizePayoutMonth(month);
  const displayMonth = formatPayoutMonth(payoutMonth);
  const { isAdmin, supabase, user } = await assertCurrentUserIsAdmin();

  if (!user) {
    redirect("/");
  }

  if (!isAdmin) {
    notFound();
  }

  const [
    { data: tips, error: tipsError },
    { data: payouts, error: payoutsError },
    { data: artists, error: artistsError },
  ] = await Promise.all([
      supabase
        .from("tips")
        .select(
          "id, stripe_checkout_session_id, stripe_payment_intent_id, artist_id, tip_type, amount, currency, status, paid_at, payout_month, stripe_description, stripe_customer_email, stripe_metadata, created_at",
        )
        .eq("payout_month", payoutMonth)
        .order("paid_at", { ascending: false }),
      supabase
        .from("monthly_artist_payouts")
        .select(
          "id, artist_id, payout_month, gross_amount, fee_amount, net_amount, currency, notification_status, payout_status, notified_at, paid_at, created_at, updated_at",
        )
        .eq("payout_month", payoutMonth)
        .order("artist_id", { ascending: true }),
      supabase
        .from("artists")
        .select("id, display_name")
        .order("display_name", { ascending: true }),
    ]);

  if (tipsError) {
    throw new Error(`tips の取得に失敗しました: ${tipsError.message}`);
  }

  if (payoutsError) {
    throw new Error(`monthly_artist_payouts の取得に失敗しました: ${payoutsError.message}`);
  }

  if (artistsError) {
    throw new Error(`artists の取得に失敗しました: ${artistsError.message}`);
  }

  const typedTips = (tips || []) as TipRow[];
  const typedPayouts = (payouts || []) as MonthlyArtistPayoutRow[];
  const artistCandidates = (artists || []) as ArtistCandidate[];
  const aggregateRows = buildArtistAggregates(typedTips);
  const uncategorizedTips = typedTips.filter(
    (tip) => tip.artist_id === UNCATEGORIZED_TIP_ARTIST_ID,
  );
  const closeAction = closeMonthlyArtistPayouts.bind(null);
  const importAction = importStripeTipsForMonth.bind(null);

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6">
      <section className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="text-sm font-medium text-zinc-500 hover:text-zinc-900">
              ← ホーム
            </Link>
            <h1 className="mt-3 text-3xl font-semibold">投げ銭 月次管理</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Stripe Webhookで保存した投げ銭を、アーティスト別・月別に集計します。
            </p>
          </div>
          <form className="flex flex-col gap-2 sm:flex-row sm:items-center" action="/admin/tips">
            <label className="text-sm font-medium text-zinc-700" htmlFor="month">
              対象月
            </label>
            <input
              id="month"
              name="month"
              type="month"
              defaultValue={displayMonth}
              className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
            />
            <button className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold hover:bg-zinc-50">
              表示
            </button>
          </form>
        </div>

        <div className="mt-6 flex flex-col gap-3 rounded-md border border-zinc-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{displayMonth} の取り込み・月次締め</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Stripe上の過去分を取り込み、未分類を紐づけてから月次締めします。支払済みレコードは上書きしません。
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <form action={importAction}>
              <input type="hidden" name="month" value={displayMonth} />
              <button
                type="submit"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold hover:bg-zinc-50 sm:w-auto"
              >
                Stripeから取り込み
              </button>
            </form>
            <form action={closeAction}>
              <input type="hidden" name="month" value={displayMonth} />
              <button
                type="submit"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 sm:w-auto"
              >
                月次締め
              </button>
            </form>
          </div>
        </div>

        <UncategorizedTipsPanel
          artists={artistCandidates}
          displayMonth={displayMonth}
          tips={uncategorizedTips}
        />

        <section className="mt-8">
          <h2 className="text-xl font-semibold">アーティスト別集計</h2>
          <div className="mt-4 overflow-x-auto rounded-md border border-zinc-200 bg-white">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">artist_id</th>
                  <th className="px-3 py-2 font-medium">currency</th>
                  <th className="px-3 py-2 font-medium">paid</th>
                  <th className="px-3 py-2 font-medium">refunded</th>
                  <th className="px-3 py-2 font-medium">failed</th>
                  <th className="px-3 py-2 font-medium">件数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {aggregateRows.map((row) => (
                  <tr key={`${row.artistId}-${row.currency}`}>
                    <td className="px-3 py-2 font-mono text-xs">{row.artistId}</td>
                    <td className="px-3 py-2 uppercase">{row.currency}</td>
                    <td className="px-3 py-2 font-semibold">
                      {formatMinorCurrency(row.paidAmount, row.currency)}
                    </td>
                    <td className="px-3 py-2 text-zinc-700">
                      {formatMinorCurrency(row.refundedAmount, row.currency)}
                    </td>
                    <td className="px-3 py-2 text-zinc-700">
                      {formatMinorCurrency(row.failedAmount, row.currency)}
                    </td>
                    <td className="px-3 py-2">{row.count}</td>
                  </tr>
                ))}
                {aggregateRows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-zinc-500" colSpan={6}>
                      この月の投げ銭はまだありません。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-semibold">支払タスク</h2>
          <div className="mt-4 grid gap-3">
            {typedPayouts.map((payout) => (
              <article
                key={payout.id}
                className="rounded-md border border-zinc-200 bg-white p-4"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="font-mono text-sm font-semibold">{payout.artist_id}</p>
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
                      <Stat label="gross" value={formatMinorCurrency(payout.gross_amount, payout.currency)} />
                      <Stat label="fee" value={formatMinorCurrency(payout.fee_amount, payout.currency)} />
                      <Stat label="net" value={formatMinorCurrency(payout.net_amount, payout.currency)} />
                      <Stat label="status" value={`${payout.notification_status} / ${payout.payout_status}`} />
                    </dl>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <details className="group">
                      <summary className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold hover:bg-zinc-50">
                        告知文生成
                      </summary>
                      <pre className="mt-3 max-w-lg whitespace-pre-wrap rounded-md bg-zinc-50 p-3 text-sm text-zinc-800">
                        {buildNotificationText(payout)}
                      </pre>
                    </details>
                    <form action={markPayoutNotified}>
                      <input type="hidden" name="payoutId" value={payout.id} />
                      <input type="hidden" name="month" value={displayMonth} />
                      <button
                        type="submit"
                        disabled={payout.notification_status === "notified"}
                        className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                      >
                        告知済みにする
                      </button>
                    </form>
                    <form action={markPayoutPaid}>
                      <input type="hidden" name="payoutId" value={payout.id} />
                      <input type="hidden" name="month" value={displayMonth} />
                      <button
                        type="submit"
                        disabled={payout.payout_status === "paid"}
                        className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                      >
                        支払済みにする
                      </button>
                    </form>
                  </div>
                </div>
              </article>
            ))}
            {typedPayouts.length === 0 ? (
              <div className="rounded-md border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500">
                月次締めを実行すると支払タスクが作成されます。
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-semibold">月別投げ銭一覧</h2>
          <div className="mt-4 overflow-x-auto rounded-md border border-zinc-200 bg-white">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">paid_at</th>
                  <th className="px-3 py-2 font-medium">artist_id</th>
                  <th className="px-3 py-2 font-medium">type</th>
                  <th className="px-3 py-2 font-medium">amount</th>
                  <th className="px-3 py-2 font-medium">status</th>
                  <th className="px-3 py-2 font-medium">stripe ids</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {typedTips.map((tip) => (
                  <tr key={tip.id}>
                    <td className="px-3 py-2 text-xs text-zinc-600">
                      {tip.paid_at ? new Date(tip.paid_at).toLocaleString("ja-JP") : "-"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{tip.artist_id}</td>
                    <td className="px-3 py-2">{tip.tip_type}</td>
                    <td className="px-3 py-2 font-semibold">
                      {formatMinorCurrency(tip.amount, tip.currency)}
                    </td>
                    <td className="px-3 py-2">{tip.status}</td>
                    <td className="px-3 py-2">
                      <p className="break-all font-mono text-xs">{tip.stripe_checkout_session_id}</p>
                      {tip.stripe_payment_intent_id ? (
                        <p className="mt-1 break-all font-mono text-xs text-zinc-500">
                          {tip.stripe_payment_intent_id}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {typedTips.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-zinc-500" colSpan={6}>
                      この月の投げ銭はまだありません。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 font-semibold text-zinc-950">{value}</dd>
    </div>
  );
}

function buildArtistAggregates(tips: TipRow[]) {
  const rows = new Map<
    string,
    {
      artistId: string;
      count: number;
      currency: string;
      failedAmount: number;
      paidAmount: number;
      refundedAmount: number;
    }
  >();

  for (const tip of tips) {
    const key = `${tip.artist_id}:${tip.currency}`;
    const row =
      rows.get(key) ||
      {
        artistId: tip.artist_id,
        count: 0,
        currency: tip.currency,
        failedAmount: 0,
        paidAmount: 0,
        refundedAmount: 0,
      };

    row.count += 1;

    if (tip.status === "paid") {
      row.paidAmount += tip.amount;
    } else if (tip.status === "refunded") {
      row.refundedAmount += tip.amount;
    } else {
      row.failedAmount += tip.amount;
    }

    rows.set(key, row);
  }

  return Array.from(rows.values()).sort((left, right) =>
    left.artistId.localeCompare(right.artistId),
  );
}

function buildNotificationText(payout: MonthlyArtistPayoutRow) {
  return [
    `${formatPayoutMonth(payout.payout_month)}分の投げ銭集計です。`,
    "",
    `アーティストID: ${payout.artist_id}`,
    `総額: ${formatMinorCurrency(payout.gross_amount, payout.currency)}`,
    `手数料: ${formatMinorCurrency(payout.fee_amount, payout.currency)}`,
    `支払予定額: ${formatMinorCurrency(payout.net_amount, payout.currency)}`,
    "",
    "内容をご確認ください。支払いは別途手動で行います。",
  ].join("\n");
}
