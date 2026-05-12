"use client";

import type { KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { JobRowActions } from "@/components/job-row-actions";
import { getJobErrorDisplayMessage } from "@/lib/job-errors";

type JobListRowProps = {
  createdAt: string;
  durationLabel: string;
  errorCode: string | null;
  id: string;
  originalFilename: string;
  progress: number;
  segmentCountLabel: string;
  status: "queued" | "processing" | "completed" | "failed";
  updatedAt: string;
};

export function JobListRow({
  createdAt,
  durationLabel,
  errorCode,
  id,
  originalFilename,
  progress,
  segmentCountLabel,
  status,
  updatedAt,
}: JobListRowProps) {
  const router = useRouter();
  const href = `/jobs/${id}`;

  function openJob() {
    router.push(href);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openJob();
  }

  return (
    <tr
      tabIndex={0}
      role="link"
      aria-label={`${originalFilename} の詳細を開く`}
      onClick={openJob}
      onKeyDown={handleKeyDown}
      className="cursor-pointer align-top transition hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-400"
    >
      <td className="max-w-72 px-4 py-4">
        <p className="wrap-break-word font-medium text-zinc-950">
          {originalFilename}
        </p>
        {status === "failed" ? (
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-red-700">
            {getJobErrorDisplayMessage(errorCode || "unknown")}
          </p>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-zinc-700">{createdAt}</td>
      <td className="whitespace-nowrap px-4 py-4 text-zinc-700">{updatedAt}</td>
      <td className="px-4 py-4">
        <StatusBadge status={status} />
      </td>
      <td className="px-4 py-4">
        <ProgressValue progress={progress} showBar={status === "processing"} />
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-zinc-700">
        {durationLabel}
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-zinc-700">
        {segmentCountLabel}
      </td>
      <td
        className="px-4 py-4"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <JobRowActions
          canOpenEditor={true}
          jobId={id}
          jobTitle={originalFilename}
          status={status}
        />
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: JobListRowProps["status"] }) {
  const classNameByStatus = {
    completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
    failed: "border-red-200 bg-red-50 text-red-800",
    processing: "border-amber-200 bg-amber-50 text-amber-800",
    queued: "border-zinc-200 bg-zinc-50 text-zinc-700",
  };

  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-md border px-2.5 text-xs font-semibold ${classNameByStatus[status]}`}
    >
      {status}
    </span>
  );
}

function ProgressValue({
  progress,
  showBar,
}: {
  progress: number;
  showBar: boolean;
}) {
  const normalizedProgress = Math.min(100, Math.max(0, Number(progress) || 0));

  if (!showBar) {
    return <span className="font-medium text-zinc-800">{normalizedProgress}%</span>;
  }

  return (
    <div className="w-32 space-y-2">
      <div className="flex items-center justify-between text-xs text-zinc-600">
        <span>処理中</span>
        <span>{normalizedProgress}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-200">
        <div
          className="h-full rounded-full bg-zinc-950 transition-all"
          style={{ width: `${normalizedProgress}%` }}
        />
      </div>
    </div>
  );
}
