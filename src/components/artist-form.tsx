"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  createArtist,
  updateArtist,
  type ArtistFormState,
} from "@/app/admin/artists/actions";

type ArtistCreateFormProps = {
  initialDisplayName?: string;
  initialId?: string;
};

type ArtistEditFormProps = {
  artist: {
    display_name: string;
    id: string;
  };
};

const INITIAL_STATE: ArtistFormState = {
  error: null,
};

export function ArtistCreateForm({
  initialDisplayName = "",
  initialId = "",
}: ArtistCreateFormProps) {
  const [state, formAction, isPending] = useActionState(
    createArtist,
    INITIAL_STATE,
  );
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [id, setId] = useState(initialId);
  const [idEdited, setIdEdited] = useState(Boolean(initialId));

  return (
    <form action={formAction} className="mt-6 grid gap-5 rounded-md border border-zinc-200 bg-white p-5">
      <div>
        <label className="text-sm font-semibold text-zinc-800" htmlFor="displayName">
          display_name
        </label>
        <input
          id="displayName"
          name="displayName"
          required
          value={displayName}
          onChange={(event) => {
            const nextDisplayName = event.target.value;

            setDisplayName(nextDisplayName);

            if (!idEdited) {
              setId(buildIdSuggestion(nextDisplayName));
            }
          }}
          className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm"
        />
      </div>

      <div>
        <label className="text-sm font-semibold text-zinc-800" htmlFor="id">
          id
        </label>
        <input
          id="id"
          name="id"
          required
          pattern="[a-zA-Z0-9_-]+"
          value={id}
          onChange={(event) => {
            setId(event.target.value);
            setIdEdited(true);
          }}
          className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 font-mono text-sm"
        />
        <p className="mt-2 text-xs text-zinc-500">
          半角英数字、ハイフン、アンダースコアが使えます。URLや識別子として扱いやすい値にしてください。
        </p>
      </div>

      <ArtistFormError error={state.error} />

      <FormButtons isPending={isPending} submitLabel="登録する" />
    </form>
  );
}

export function ArtistEditForm({ artist }: ArtistEditFormProps) {
  const [state, formAction, isPending] = useActionState(
    updateArtist,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="mt-6 grid gap-5 rounded-md border border-zinc-200 bg-white p-5">
      <input type="hidden" name="id" value={artist.id} />

      <div>
        <label className="text-sm font-semibold text-zinc-800" htmlFor="id">
          id
        </label>
        <input
          id="id"
          readOnly
          value={artist.id}
          className="mt-2 min-h-11 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 font-mono text-sm text-zinc-600"
        />
        <p className="mt-2 text-xs text-zinc-500">
          id は主キーのため、この画面では変更できません。
        </p>
      </div>

      <div>
        <label className="text-sm font-semibold text-zinc-800" htmlFor="displayName">
          display_name
        </label>
        <input
          id="displayName"
          name="displayName"
          required
          defaultValue={artist.display_name}
          className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm"
        />
      </div>

      <ArtistFormError error={state.error} />

      <FormButtons isPending={isPending} submitLabel="更新する" />
    </form>
  );
}

function FormButtons({
  isPending,
  submitLabel,
}: {
  isPending: boolean;
  submitLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-5 sm:flex-row sm:justify-end">
      <Link
        href="/admin/artists"
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold hover:bg-zinc-50"
      >
        キャンセル
      </Link>
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {isPending ? "保存中..." : submitLabel}
      </button>
    </div>
  );
}

function ArtistFormError({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }

  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error}
    </div>
  );
}

function buildIdSuggestion(displayName: string) {
  return displayName
    .normalize("NFKD")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}
