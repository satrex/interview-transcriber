"use client";

import {
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { assignTipArtist } from "@/app/admin/tips/actions";
import type {
  ArtistCandidate,
  TipRow,
} from "@/lib/tips";

type UncategorizedTipsPanelProps = {
  artists: ArtistCandidate[];
  displayMonth: string;
  tips: TipRow[];
};

type RowSelection = {
  artistId: string;
  artistOption: string;
};

export function UncategorizedTipsPanel({
  artists,
  displayMonth,
  tips,
}: UncategorizedTipsPanelProps) {
  const [selections, setSelections] = useState<Record<string, RowSelection>>({});
  const [artistResults, setArtistResults] =
    useState<ArtistCandidate[]>(artists);
  const artistOptions = useMemo(
    () =>
      artistResults.map((artist) => ({
        id: artist.id,
        label: artist.display_name,
      })),
    [artistResults],
  );

  if (tips.length === 0) {
    return null;
  }

  function updateSelection(tipId: string, values: Partial<RowSelection>) {
    setSelections((current) => ({
      ...current,
      [tipId]: {
        artistId: current[tipId]?.artistId || "",
        artistOption: current[tipId]?.artistOption || "",
        ...values,
      },
    }));
  }

  async function handleArtistSearch(
    tipId: string,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const value = event.target.value;
    const matchedArtist = artistOptions.find((option) => option.label === value);

    updateSelection(tipId, {
      artistId: matchedArtist?.id || "",
      artistOption: value,
    });

    const params = new URLSearchParams();

    if (value.trim()) {
      params.set("query", value.trim());
    }

    const response = await fetch(`/admin/tips/artists?${params.toString()}`);

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as { artists?: ArtistCandidate[] };
    const nextArtists = payload.artists || [];
    const nextMatchedArtist = nextArtists.find(
      (artist) => artist.display_name === value,
    );

    setArtistResults(nextArtists);

    if (nextMatchedArtist) {
      updateSelection(tipId, {
        artistId: nextMatchedArtist.id,
        artistOption: value,
      });
    }
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
        {tips.map((tip) => {
          const selection = selections[tip.id] || {
            artistId: "",
            artistOption: "",
          };
          const selectedArtistId = selection.artistId;

          return (
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

                <form
                  action={assignTipArtist}
                  className="grid gap-3"
                  onKeyDown={preventInputEnterSubmit}
                >
                  <input type="hidden" name="tipId" value={tip.id} />
                  <input type="hidden" name="month" value={displayMonth} />
                  <input type="hidden" name="artistId" value={selectedArtistId} />
                  <input type="hidden" name="tipType" value={tip.tip_type} />

                  <label className="text-xs font-medium text-amber-950">
                    アーティスト
                    <input
                      list={`artist-options-${tip.id}`}
                      required
                      value={selection.artistOption}
                      onChange={(event) => void handleArtistSearch(tip.id, event)}
                      placeholder="名前で検索"
                      className="mt-1 min-h-10 w-full rounded-md border border-amber-300 bg-white px-3 text-sm text-zinc-950"
                    />
                    <datalist id={`artist-options-${tip.id}`}>
                      {artistOptions.map((option) => (
                        <option key={option.id} value={option.label} />
                      ))}
                    </datalist>
                  </label>

                  <button
                    type="submit"
                    disabled={!selectedArtistId}
                    className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                  >
                    紐づけ
                  </button>
                </form>
              </div>
            </article>
          );
        })}
      </div>
    </section>
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

function preventInputEnterSubmit(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter") {
    return;
  }

  const target = event.target as HTMLElement;

  if (target.tagName === "INPUT") {
    event.preventDefault();
  }
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
