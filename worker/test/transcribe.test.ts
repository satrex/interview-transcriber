import assert from "node:assert/strict";
import test from "node:test";
import { classifyOpenAITranscriptionError } from "../src/transcribe.js";

test("classifies HTTP 5xx errors with the long backoff", () => {
  const classification = classifyOpenAITranscriptionError({
    status: 500,
    message: "Internal server error",
  });

  assert.equal(classification.errorCode, "openai_error");
  assert.equal(classification.retryable, true);
  assert.equal(classification.maxAttempts, 5);
  assert.deepEqual(
    [1, 2, 3, 4].map((attempt) => classification.delayMs(attempt)),
    [30_000, 60_000, 90_000, 120_000],
  );
});

test("classifies the server-error message as a 5xx-style failure", () => {
  const classification = classifyOpenAITranscriptionError(
    new Error("The server had an error while processing the request."),
  );

  assert.equal(classification.errorCode, "openai_error");
  assert.equal(classification.maxAttempts, 5);
  assert.equal(classification.delayMs(1), 30_000);
});
