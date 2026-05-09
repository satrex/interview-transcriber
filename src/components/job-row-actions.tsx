"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  deleteTranscriptionJob,
  retryTranscriptionJob,
  type DeleteJobActionState,
  type RetryJobActionState,
} from "@/app/actions";

const initialDeleteState: DeleteJobActionState = {
  error: null,
  success: false,
};

const initialRetryState: RetryJobActionState = {
  error: null,
  success: false,
};

type JobRowActionsProps = {
  canOpenEditor: boolean;
  jobId: string;
  jobTitle: string;
  status: string;
};

export function JobRowActions({
  canOpenEditor,
  jobId,
  jobTitle,
  status,
}: JobRowActionsProps) {
  const router = useRouter();
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteTranscriptionJob,
    initialDeleteState,
  );
  const [retryState, retryAction, isRetrying] = useActionState(
    retryTranscriptionJob,
    initialRetryState,
  );

  useEffect(() => {
    if (deleteState.success || retryState.success) {
      router.refresh();
    }
  }, [deleteState.success, retryState.success, router]);

  return (
    <div className="flex min-w-36 flex-col gap-2">
      <a
        href={`/jobs/${jobId}`}
        aria-disabled={!canOpenEditor}
        className={
          canOpenEditor
            ? "inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
            : "inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 px-4 text-sm font-semibold text-zinc-500"
        }
        onClick={(event) => {
          if (!canOpenEditor) {
            event.preventDefault();
          }
        }}
      >
        開く
      </a>

      {status === "failed" ? (
        <form action={retryAction}>
          <input type="hidden" name="jobId" value={jobId} />
          <button
            type="submit"
            disabled={isRetrying}
            className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
          >
            {isRetrying ? "再実行中..." : "再実行"}
          </button>
        </form>
      ) : null}

      <form
        action={deleteAction}
        onSubmit={(event) => {
          const confirmed = window.confirm(
            `「${jobTitle}」を削除します。DB上のjob、segments、editsと元音声ファイルを削除します。よろしいですか？`,
          );

          if (!confirmed) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="jobId" value={jobId} />
        <button
          type="submit"
          disabled={isDeleting}
          className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
        >
          {isDeleting ? "削除中..." : "削除"}
        </button>
      </form>

      {retryState.error ? (
        <p aria-live="polite" className="text-xs leading-5 text-red-700">
          {retryState.error}
        </p>
      ) : null}

      {deleteState.error ? (
        <p aria-live="polite" className="text-xs leading-5 text-red-700">
          {deleteState.error}
        </p>
      ) : null}
    </div>
  );
}
