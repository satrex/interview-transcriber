export type RetryOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  operation: string;
};

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 30_000;

export async function retryTransientOperation<T>(
  options: RetryOptions,
  operation: () => PromiseLike<T>,
) {
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs || DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs || DEFAULT_MAX_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientError(error) || attempt >= maxAttempts) {
        throw error;
      }

      const delayMs = calculateBackoffMs(attempt, baseDelayMs, maxDelayMs);
      console.warn(
        `[worker] transient Supabase communication error during ${options.operation}; retrying attempt ${attempt + 1}/${maxAttempts} in ${delayMs}ms: ${formatErrorMessage(error)}`,
      );
      await sleep(delayMs);
    }
  }

  throw new Error(`Retry loop exhausted for ${options.operation}.`);
}

export function isTransientError(error: unknown) {
  const message = formatErrorMessage(error).toLowerCase();
  const errorName = error instanceof Error ? error.name : "";

  return (
    error instanceof TypeError ||
    errorName === "TimeoutError" ||
    message.includes("fetch failed") ||
    message.includes("connection error") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("econnrefused") ||
    message.includes("socket hang up") ||
    message.includes("terminated")
  );
}

export function formatErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function calculateBackoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
) {
  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  const jitterMs = Math.floor(Math.random() * Math.min(1_000, exponentialDelay));

  return exponentialDelay + jitterMs;
}

function sleep(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
