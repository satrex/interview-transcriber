import { loadConfig } from "./config.js";
import { claimQueuedJob, markJobAttemptFailed } from "./jobs.js";
import { processProject, claimQueuedProject, updateProjectProgress } from "./projects.js";
import { FinalJobFailure, PermanentJobFailure, processJob } from "./processor.js";
import { isTransientError } from "./retry.js";
import { createSupabaseClient } from "./supabase.js";
import type { TranscriptionJob, TranscriptionProject } from "./supabase.js";

const NO_JOB_LOG_INTERVAL_MS = 60_000;
const ERROR_SLEEP_MS = 5_000;

type ShutdownState = {
  activeJobId: string | null;
  shuttingDown: boolean;
  wakeSleep: (() => void) | null;
};

async function main() {
  const config = loadConfig();
  const supabase = createSupabaseClient(config);
  const shutdownState: ShutdownState = {
    activeJobId: null,
    shuttingDown: false,
    wakeSleep: null,
  };
  let lastNoJobLogAt = 0;

  console.log(`[worker] starting ${config.workerId}`);
  console.log("[worker] node version:", process.version);
  console.log(`[worker] max concurrent jobs: ${config.maxConcurrentJobs}`);
  console.log(`[worker] poll interval: ${config.pollIntervalMs}ms`);

  installShutdownHandlers(shutdownState);

  while (!shutdownState.shuttingDown) {
    try {
      // First, try to claim a queued project
      const project = await claimQueuedProject(supabase, config.workerId, {
        lockTimeoutMinutes: config.lockTimeoutMinutes,
      });

      if (project) {
        if (shutdownState.shuttingDown) {
          console.log(
            `[worker] claimed project ${project.id} during shutdown; current project will finish before shutdown`,
          );
        }

        shutdownState.activeJobId = `project-${project.id}`;
        await processClaimedProject(supabase, config, project, shutdownState);
        shutdownState.activeJobId = null;
        continue;
      }

      // If no project, try to claim a queued job
      const job = await claimQueuedJob(supabase, config.workerId, {
        lockTimeoutMinutes: config.lockTimeoutMinutes,
        maxAttempts: config.maxAttempts,
      });

      if (!job) {
        if (shutdownState.shuttingDown) {
          break;
        }

        const now = Date.now();

        if (now - lastNoJobLogAt >= NO_JOB_LOG_INTERVAL_MS) {
          console.log("[worker] no claimable jobs or projects found");
          lastNoJobLogAt = now;
        }

        await sleep(config.pollIntervalMs, shutdownState);
        continue;
      }

      if (shutdownState.shuttingDown) {
        console.log(
          `[worker] claimed job ${job.id} during shutdown; current job will finish before shutdown`,
        );
      }

      shutdownState.activeJobId = job.id;
      await processClaimedJob(supabase, config, job, shutdownState);
      shutdownState.activeJobId = null;
    } catch (error) {
      console.error("[worker] loop error:", error);

      if (!shutdownState.shuttingDown) {
        await sleep(ERROR_SLEEP_MS, shutdownState);
      }
    }
  }

  console.log("[worker] shutdown complete");
}

function installShutdownHandlers(shutdownState: ShutdownState) {
  const requestShutdown = (signal: NodeJS.Signals) => {
    if (shutdownState.shuttingDown) {
      console.log(`[worker] ${signal} received again; shutdown already in progress`);
      return;
    }

    shutdownState.shuttingDown = true;

    if (shutdownState.activeJobId) {
      console.log(
        `[worker] ${signal} received; current job ${shutdownState.activeJobId} will finish before shutdown`,
      );
    } else {
      console.log(`[worker] ${signal} received; no current job, shutting down`);
    }

    shutdownState.wakeSleep?.();
  };

  process.on("SIGTERM", requestShutdown);
  process.on("SIGINT", requestShutdown);
}

function sleep(ms: number, shutdownState: ShutdownState) {
  return new Promise<void>((resolve) => {
    let timeout: NodeJS.Timeout | null = null;

    const finish = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      if (shutdownState.wakeSleep === finish) {
        shutdownState.wakeSleep = null;
      }

      resolve();
    };

    timeout = setTimeout(finish, ms);
    shutdownState.wakeSleep = finish;
  });
}

async function processClaimedJob(
  supabase: ReturnType<typeof createSupabaseClient>,
  config: ReturnType<typeof loadConfig>,
  job: TranscriptionJob,
  shutdownState: ShutdownState,
) {
  shutdownState.activeJobId = job.id;

  console.log(
    `[worker] claimed job ${job.id} attempt ${job.attempt_count}/${config.maxAttempts}`,
  );
  console.log(`[worker] started job ${job.id}`);

  try {
    await processJob(supabase, config, job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    const failureType = isTransientError(error)
      ? "Supabase communication"
      : error instanceof FinalJobFailure
        ? error.errorCode
      : error instanceof PermanentJobFailure
        ? "permanent job"
        : "processing";
    console.error(`[worker] job ${job.id} failed (${failureType} failure): ${message}`);
    const isFinalFailure =
      error instanceof PermanentJobFailure || error instanceof FinalJobFailure;
    const maxAttempts = isFinalFailure
      ? job.attempt_count
      : config.maxAttempts;
    await markJobAttemptFailed(supabase, job, message, maxAttempts, {
      errorCode:
        error instanceof FinalJobFailure || error instanceof PermanentJobFailure
          ? error.errorCode
          : undefined,
      processedAudioSeconds:
        error instanceof FinalJobFailure || error instanceof PermanentJobFailure
          ? error.processedAudioSeconds
          : undefined,
    });

    // Update project progress if this is a project part
    if (job.project_id && job.is_project_part) {
      await updateProjectProgress(supabase, job.project_id);
    }
  } finally {
    shutdownState.activeJobId = null;
  }
}

async function processClaimedProject(
  supabase: ReturnType<typeof createSupabaseClient>,
  config: ReturnType<typeof loadConfig>,
  project: TranscriptionProject,
  shutdownState: ShutdownState,
) {
  try {
    await processProject(supabase, config, project);
  } catch (error) {
    console.error(`[worker] project ${project.id} processing failed:`, error);
    // Project failure is already handled in processProject
  } finally {
    shutdownState.activeJobId = null;
  }
}

main().catch((error) => {
  console.error("[worker] fatal error:", error);
  process.exit(1);
});
