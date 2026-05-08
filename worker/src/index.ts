import { loadConfig } from "./config.js";
import { claimQueuedJob, markJobAttemptFailed } from "./jobs.js";
import { PermanentJobFailure, processJob } from "./processor.js";
import { createSupabaseClient } from "./supabase.js";

async function main() {
  const config = loadConfig();
  const supabase = createSupabaseClient(config);

  console.log(`[worker] starting ${config.workerId}`);
  console.log("[worker] looking for one claimable transcription job");

  const job = await claimQueuedJob(supabase, config.workerId, {
    lockTimeoutMinutes: config.lockTimeoutMinutes,
    maxAttempts: config.maxAttempts,
  });

  if (!job) {
    console.log("[worker] no claimable jobs found");
    return;
  }

  console.log(
    `[worker] claimed job ${job.id} attempt ${job.attempt_count}/${config.maxAttempts}`,
  );

  try {
    await processJob(supabase, config, job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    console.error(`[worker] job ${job.id} failed: ${message}`);
    const maxAttempts = error instanceof PermanentJobFailure
      ? job.attempt_count
      : config.maxAttempts;
    await markJobAttemptFailed(supabase, job, message, maxAttempts);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[worker] fatal error:", error);
  process.exitCode = 1;
});
