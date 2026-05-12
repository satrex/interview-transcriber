"use client";

import { useActionState } from "react";
import {
  createTermDictionaryEntry,
  updateTermDictionary,
  updateTermDictionaryEntry,
  type TermDictionaryActionState,
} from "@/app/actions";
import type {
  TermDictionaryEntry,
  TermDictionarySummary,
} from "@/lib/term-dictionaries";

const INITIAL_STATE: TermDictionaryActionState = {
  error: null,
  success: false,
};

export function TermDictionaryMetadataForm({
  dictionary,
}: {
  dictionary: TermDictionarySummary;
}) {
  const [state, formAction, pending] = useActionState(
    updateTermDictionary,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="dictionaryId" value={dictionary.id} />
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <label className="block text-sm font-medium text-zinc-800">
          辞書名
          <input
            name="name"
            defaultValue={dictionary.name}
            required
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
        </label>
        <label className="block text-sm font-medium text-zinc-800">
          説明
          <input
            name="description"
            defaultValue={dictionary.description || ""}
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          保存
        </button>
      </div>
      <ActionMessage state={state} />
    </form>
  );
}

export function TermDictionaryEntryCreateForm({
  dictionaryId,
}: {
  dictionaryId: string;
}) {
  const [state, formAction, pending] = useActionState(
    createTermDictionaryEntry,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="dictionaryId" value={dictionaryId} />
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1.5fr_7rem_auto] lg:items-end">
        <label className="block text-sm font-medium text-zinc-800">
          用語
          <input
            name="term"
            required
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
        </label>
        <label className="block text-sm font-medium text-zinc-800">
          読み
          <input
            name="reading"
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
        </label>
        <label className="block text-sm font-medium text-zinc-800">
          種別
          <input
            name="category"
            placeholder="person / gear"
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
        </label>
        <label className="block text-sm font-medium text-zinc-800">
          表記ゆれ
          <input
            name="aliases"
            placeholder="カンマ区切り"
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
        </label>
        <label className="block text-sm font-medium text-zinc-800">
          優先度
          <input
            name="priority"
            type="number"
            defaultValue={100}
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          追加
        </button>
      </div>
      <label className="block text-sm font-medium text-zinc-800">
        説明
        <input
          name="description"
          className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
        />
      </label>
      <ActionMessage state={state} />
    </form>
  );
}

export function TermDictionaryEntryEditForm({
  entry,
}: {
  entry: TermDictionaryEntry;
}) {
  const [state, formAction, pending] = useActionState(
    updateTermDictionaryEntry,
    INITIAL_STATE,
  );
  const formId = `entry-${entry.id}`;

  return (
    <>
      <tr className="align-top">
        <td className="px-3 py-3 text-zinc-500">
          <form id={formId} action={formAction}>
            <input type="hidden" name="dictionaryId" value={entry.dictionary_id} />
            <input type="hidden" name="entryId" value={entry.id} />
          </form>
          ☰
        </td>
        <td className="px-3 py-3">
          <input
            form={formId}
            name="term"
            defaultValue={entry.term}
            required
            className="w-44 rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-900"
          />
        </td>
        <td className="px-3 py-3">
          <input
            form={formId}
            name="reading"
            defaultValue={entry.reading || ""}
            className="w-40 rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-900"
          />
        </td>
        <td className="px-3 py-3">
          <input
            form={formId}
            name="category"
            defaultValue={entry.category || ""}
            className="w-32 rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-900"
          />
        </td>
        <td className="px-3 py-3">
          <input
            form={formId}
            name="aliases"
            defaultValue={entry.aliases.join(", ")}
            className="w-56 rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-900"
          />
          <input
            form={formId}
            name="description"
            defaultValue={entry.description || ""}
            placeholder="説明"
            className="mt-2 w-56 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-900"
          />
        </td>
        <td className="px-3 py-3">
          <input
            form={formId}
            name="priority"
            type="number"
            defaultValue={entry.priority}
            className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-900"
          />
          <input
            form={formId}
            name="sortOrder"
            type="number"
            defaultValue={entry.sort_order}
            className="mt-2 w-24 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-900"
            title="sort_order"
          />
        </td>
        <td className="px-3 py-3">
          <select
            form={formId}
            name="isEnabled"
            defaultValue={entry.is_enabled ? "true" : "false"}
            className="rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-900"
          >
            <option value="true">有効</option>
            <option value="false">無効</option>
          </select>
        </td>
        <td className="space-y-2 px-3 py-3">
          <button
            form={formId}
            type="submit"
            disabled={pending}
            className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100"
          >
            保存
          </button>
          <ActionMessage state={state} compact />
        </td>
      </tr>
    </>
  );
}

function ActionMessage({
  compact = false,
  state,
}: {
  compact?: boolean;
  state: TermDictionaryActionState;
}) {
  if (state.error) {
    return (
      <p className={compact ? "text-xs text-red-700" : "text-sm text-red-700"}>
        {state.error}
      </p>
    );
  }

  if (state.success) {
    return (
      <p className={compact ? "text-xs text-emerald-700" : "text-sm text-emerald-700"}>
        保存しました。
      </p>
    );
  }

  return null;
}
