"use client";

import { useActionState } from "react";
import {
  saveQualityNotes,
  type QualityNotesActionState,
} from "@/app/actions";

export type QualityNotesFormValues = {
  recordingEnvironment: string;
  misrecognitionNotes: string;
  speakerMisidentificationNotes: string;
  timestampOffsetNotes: string;
  generalQualityNotes: string;
};

type QualityNotesFormProps = {
  jobId: string;
  initialValues: QualityNotesFormValues;
};

const initialState: QualityNotesActionState = {
  error: null,
  success: false,
};

const recordingEnvironmentExamples = [
  "ピンマイク",
  "iPhone直録り",
  "騒音あり",
  "複数人同時発話あり",
];

export function QualityNotesForm({
  jobId,
  initialValues,
}: QualityNotesFormProps) {
  const [state, formAction, pending] = useActionState(
    saveQualityNotes,
    initialState,
  );

  return (
    <section className="mt-8 border-t border-zinc-200 pt-8">
      <div>
        <h2 className="text-xl font-semibold text-zinc-950">品質メモ</h2>
        <p className="mt-1 text-sm text-zinc-500">
          実音源での精度改善に使う観察メモです。自動評価はまだ行いません。
        </p>
      </div>

      <form action={formAction} className="mt-6 space-y-5">
        <input type="hidden" name="jobId" value={jobId} />

        <div className="space-y-2">
          <label
            htmlFor="recordingEnvironment"
            className="block text-sm font-medium text-zinc-800"
          >
            録音環境メモ
          </label>
          <textarea
            id="recordingEnvironment"
            name="recordingEnvironment"
            defaultValue={initialValues.recordingEnvironment}
            rows={3}
            placeholder="例: ピンマイク / iPhone直録り / 騒音あり / 複数人同時発話あり"
            className="w-full rounded-md border border-zinc-300 bg-white p-3 text-sm leading-6 text-zinc-900"
          />
          <div className="flex flex-wrap gap-2">
            {recordingEnvironmentExamples.map((example) => (
              <span
                key={example}
                className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-600"
              >
                {example}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <TextareaField
            id="misrecognitionNotes"
            label="誤変換"
            name="misrecognitionNotes"
            defaultValue={initialValues.misrecognitionNotes}
            placeholder="固有名詞、専門用語、語尾などの誤変換"
          />
          <TextareaField
            id="speakerMisidentificationNotes"
            label="話者識別ミス"
            name="speakerMisidentificationNotes"
            defaultValue={initialValues.speakerMisidentificationNotes}
            placeholder="話者A/Bの入れ替わり、同時発話での混線など"
          />
          <TextareaField
            id="timestampOffsetNotes"
            label="タイムスタンプずれ"
            name="timestampOffsetNotes"
            defaultValue={initialValues.timestampOffsetNotes}
            placeholder="全体的なずれ、チャンク境界付近のずれなど"
          />
          <TextareaField
            id="generalQualityNotes"
            label="その他の品質メモ"
            name="generalQualityNotes"
            defaultValue={initialValues.generalQualityNotes}
            placeholder="編集時に気づいた傾向、次回検証したい条件など"
          />
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
            品質メモを保存しました。
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {pending ? "保存中..." : "品質メモを保存"}
        </button>
      </form>
    </section>
  );
}

type TextareaFieldProps = {
  defaultValue: string;
  id: string;
  label: string;
  name: string;
  placeholder: string;
};

function TextareaField({
  defaultValue,
  id,
  label,
  name,
  placeholder,
}: TextareaFieldProps) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-zinc-800">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        defaultValue={defaultValue}
        rows={5}
        placeholder={placeholder}
        className="w-full rounded-md border border-zinc-300 bg-white p-3 text-sm leading-6 text-zinc-900"
      />
    </div>
  );
}
