"use client";

import { useActionState } from "react";
import {
  createTranscriptionJob,
  type UploadActionState,
} from "@/app/actions";

const initialState: UploadActionState = {
  error: null,
};

export function UploadForm() {
  const [state, formAction, pending] = useActionState(
    createTranscriptionJob,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <label
          htmlFor="audio"
          className="block text-sm font-medium text-zinc-800"
        >
          音声ファイル
        </label>
        <input
          id="audio"
          name="audio"
          type="file"
          accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav,audio/x-wav"
          required
          className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />
        <p className="text-sm text-zinc-500">mp3, m4a, wav / 最大 500MB</p>
      </div>

      {state.error ? (
        <p
          aria-live="polite"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {pending ? "アップロード中..." : "文字起こしジョブを作成"}
      </button>
    </form>
  );
}
