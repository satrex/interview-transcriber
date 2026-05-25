"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  deleteFailedProject,
  type DeleteProjectActionState,
} from "@/app/actions";

const initialState: DeleteProjectActionState = {
  error: null,
  success: false,
};

type FailedProjectDeleteButtonProps = {
  mode: "detail" | "list";
  projectId: string;
  projectTitle: string;
};

export function FailedProjectDeleteButton({
  mode,
  projectId,
  projectTitle,
}: FailedProjectDeleteButtonProps) {
  const router = useRouter();
  const [state, action, isDeleting] = useActionState(
    deleteFailedProject,
    initialState,
  );

  useEffect(() => {
    if (!state.success) {
      return;
    }

    if (mode === "detail") {
      router.push("/projects");
      return;
    }

    router.refresh();
  }, [mode, router, state.success]);

  return (
    <div className="flex flex-col gap-2">
      <form
        action={action}
        onSubmit={(event) => {
          const confirmed = window.confirm(
            `「${projectTitle}」を削除します。この失敗したプロジェクトを削除します。関連する文字起こしデータも削除されます。よろしいですか？`,
          );

          if (!confirmed) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="projectId" value={projectId} />
        <button
          type="submit"
          disabled={isDeleting}
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
        >
          {isDeleting ? "削除中..." : "削除"}
        </button>
      </form>

      {state.error ? (
        <p role="alert" className="max-w-sm text-sm leading-5 text-red-700">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
