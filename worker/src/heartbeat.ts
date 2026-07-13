import { formatErrorMessage } from "./retry.js";

export function startLockHeartbeat(options: {
  label: string;
  lockTimeoutMinutes: number;
  maxFailures: number;
  touch: () => Promise<void>;
}) {
  const intervalMs = Math.max(
    30_000,
    Math.min(60_000, (options.lockTimeoutMinutes * 60_000) / 2),
  );
  let consecutiveFailures = 0;
  let fatalError: Error | null = null;
  let isRefreshing = false;

  const interval = setInterval(() => {
    if (isRefreshing || fatalError) {
      return;
    }

    isRefreshing = true;
    options
      .touch()
      .then(() => {
        consecutiveFailures = 0;
      })
      .catch((error) => {
        consecutiveFailures += 1;
        console.error(
          `[worker] Supabase lock refresh failed for ${options.label} (${consecutiveFailures}/${options.maxFailures} consecutive refresh operation failures): ${formatErrorMessage(error)}`,
        );

        if (consecutiveFailures >= options.maxFailures) {
          fatalError = new Error(
            `Supabase lock refresh failed ${consecutiveFailures} consecutive time(s): ${formatErrorMessage(error)}`,
          );
        }
      })
      .finally(() => {
        isRefreshing = false;
      });
  }, intervalMs);

  return {
    assertHealthy() {
      if (fatalError) {
        throw fatalError;
      }
    },
    stop() {
      clearInterval(interval);
    },
  };
}
