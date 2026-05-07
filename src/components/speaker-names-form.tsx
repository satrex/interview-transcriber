"use client";

import { useActionState } from "react";
import {
  saveSpeakerNames,
  type SpeakerNamesActionState,
} from "@/app/actions";

export type SpeakerNameFormRow = {
  speakerLabel: string;
  displayName: string;
};

type SpeakerNamesFormProps = {
  jobId: string;
  speakers: SpeakerNameFormRow[];
};

const initialState: SpeakerNamesActionState = {
  error: null,
  success: false,
};

export function SpeakerNamesForm({ jobId, speakers }: SpeakerNamesFormProps) {
  const [state, formAction, pending] = useActionState(
    saveSpeakerNames,
    initialState,
  );

  return (
    <section className="mt-8 border-t border-zinc-200 pt-8">
      <div>
        <h2 className="text-xl font-semibold text-zinc-950">話者名</h2>
        <p className="mt-1 text-sm text-zinc-500">
          speaker_label と表示名の対応表です。未設定の話者は元のラベルで表示します。
        </p>
      </div>

      {speakers.length === 0 ? (
        <div className="mt-5 rounded-md bg-zinc-50 p-4 text-sm text-zinc-600">
          話者ラベルはまだ検出されていません。
        </div>
      ) : (
        <form action={formAction} className="mt-6 space-y-5">
          <input type="hidden" name="jobId" value={jobId} />

          <div className="space-y-3">
            {speakers.map((speaker) => (
              <div
                key={speaker.speakerLabel}
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:items-center"
              >
                <label
                  htmlFor={`speaker-${speaker.speakerLabel}`}
                  className="break-all font-mono text-sm text-zinc-700"
                >
                  {speaker.speakerLabel}
                </label>
                <input
                  id={`speaker-${speaker.speakerLabel}`}
                  name="displayName"
                  type="text"
                  defaultValue={speaker.displayName}
                  placeholder="例: さとレックス"
                  className="min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900"
                />
                <input
                  type="hidden"
                  name="speakerLabel"
                  value={speaker.speakerLabel}
                />
              </div>
            ))}
          </div>

          {state.error ? (
            <p
              aria-live="polite"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {state.error}
            </p>
          ) : null}

          {state.success ? (
            <p className="text-sm text-emerald-700" aria-live="polite">
              話者名を保存しました。
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {pending ? "保存中..." : "話者名を保存"}
          </button>
        </form>
      )}
    </section>
  );
}
