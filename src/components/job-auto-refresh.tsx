"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type JobAutoRefreshProps = {
  status: string;
};

const POLLING_INTERVAL_MS = 5_000;

export function JobAutoRefresh({ status }: JobAutoRefreshProps) {
  const router = useRouter();
  const shouldPoll = status === "queued" || status === "processing";

  useEffect(() => {
    if (!shouldPoll) {
      return;
    }

    const intervalId = window.setInterval(() => {
      router.refresh();
    }, POLLING_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [router, shouldPoll]);

  if (!shouldPoll) {
    return null;
  }

  return (
    <p className="mt-3 text-sm text-zinc-500" aria-live="polite">
      処理中です。自動更新されます。
    </p>
  );
}
