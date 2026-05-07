"use client";

import { useActionState } from "react";
import {
  saveExpectedSpeakerCount,
  type ExpectedSpeakerCountActionState,
} from "@/app/actions";

type ExpectedSpeakerCountFormProps = {
  expectedSpeakerCount: number;
  jobId: string;
};

const initialState: ExpectedSpeakerCountActionState = {
  error: null,
  success: false,
};

export function ExpectedSpeakerCountForm({
  expectedSpeakerCount,
  jobId,
}: ExpectedSpeakerCountFormProps) {
  const [state, formAction, pending] = useActionState(
    saveExpectedSpeakerCount,
    initialState,
  );

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="jobId" value={jobId} />
      <div className="space-y-2">
        <label
          htmlFor="expectedSpeakerCount"
          className="block text-sm font-medium text-zinc-800"
        >
          想定話者数
        </label>
        <input
          id="expectedSpeakerCount"
          name="expectedSpeakerCount"
          type="number"
          min={1}
          max={20}
          defaultValue={expectedSpeakerCount}
          className="min-h-10 w-28 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
      >
        {pending ? "保存中..." : "保存"}
      </button>

      {state.error ? (
        <p className="text-sm text-red-700" aria-live="polite">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="text-sm text-emerald-700" aria-live="polite">
          保存しました。
        </p>
      ) : null}
    </form>
  );
}
