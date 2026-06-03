"use client";

import {
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { assignTipArtist } from "@/app/admin/tips/actions";
import type { ArtistCandidate } from "@/lib/tips";

type TipArtistAssignmentFormProps = {
  artists: ArtistCandidate[];
  currentArtistName?: string;
  displayMonth: string;
  tipId: string;
  tipType: string;
};

export function TipArtistAssignmentForm({
  artists,
  currentArtistName,
  displayMonth,
  tipId,
  tipType,
}: TipArtistAssignmentFormProps) {
  const [artistResults, setArtistResults] = useState<ArtistCandidate[]>(artists);
  const [artistId, setArtistId] = useState("");
  const [artistOption, setArtistOption] = useState(currentArtistName || "");
  const artistOptions = useMemo(
    () =>
      artistResults.map((artist) => ({
        id: artist.id,
        label: artist.display_name,
      })),
    [artistResults],
  );

  async function handleArtistSearch(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    const matchedArtist = artistOptions.find((option) => option.label === value);

    setArtistId(matchedArtist?.id || "");
    setArtistOption(value);

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
      setArtistId(nextMatchedArtist.id);
      setArtistOption(value);
    }
  }

  return (
    <form action={assignTipArtist} className="grid gap-3" onKeyDown={preventInputEnterSubmit}>
      <input type="hidden" name="tipId" value={tipId} />
      <input type="hidden" name="month" value={displayMonth} />
      <input type="hidden" name="artistId" value={artistId} />
      <input type="hidden" name="tipType" value={tipType} />

      <label className="text-xs font-medium text-zinc-700">
        アーティスト
        <input
          list={`artist-options-${tipId}`}
          required
          value={artistOption}
          onChange={(event) => void handleArtistSearch(event)}
          placeholder="名前で検索"
          className="mt-1 min-h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
        />
        <datalist id={`artist-options-${tipId}`}>
          {artistOptions.map((option) => (
            <option key={option.id} value={option.label} />
          ))}
        </datalist>
      </label>

      <button
        type="submit"
        disabled={!artistId}
        className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        紐づけを保存
      </button>
    </form>
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
