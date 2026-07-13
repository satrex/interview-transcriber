import { NextRequest } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { resetFailedJob } from "@/lib/jobs/reset";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest, context: { params: Promise<{ projectId: string; jobId: string }> }) {
  const params = await context.params;
  const { projectId, jobId } = params;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "not_authenticated" }), { status: 401 });
  }

  // Fetch the job
  const { data: jobs, error: fetchJobErr } = await supabase
    .from("transcription_jobs")
    .select("id, project_id, user_id, status, attempt_count")
    .eq("id", jobId)
    .maybeSingle();

  if (fetchJobErr) {
    return new Response(JSON.stringify({ error: fetchJobErr.message }), { status: 500 });
  }
  if (!jobs) {
    return new Response(JSON.stringify({ error: "job_not_found" }), { status: 404 });
  }
  if (jobs.project_id !== projectId) {
    return new Response(JSON.stringify({ error: "job_project_mismatch" }), { status: 403 });
  }
  if (jobs.user_id !== user.id) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }
  if (jobs.status !== "failed") {
    return new Response(JSON.stringify({ error: "job_not_failed" }), { status: 409 });
  }

  const { error: updateErr } = await resetFailedJob(createAdminSupabaseClient(), {
    jobId,
    userId: user.id,
  });

  if (updateErr) {
    return new Response(JSON.stringify({ error: updateErr.message }), { status: 500 });
  }

  // Recompute project counts
  const { data: counts, error: countsErr } = await supabase
    .from("transcription_jobs")
    .select("status")
    .eq("project_id", projectId)
    .eq("is_project_part", true);

  if (countsErr) {
    return new Response(JSON.stringify({ error: countsErr.message }), { status: 500 });
  }

  const partStatuses = (counts || []) as Array<{ status: string }>;
  const completedParts = partStatuses.filter((j) => j.status === "completed").length;
  const failedParts = partStatuses.filter((j) => j.status === "failed").length;
  const totalParts = partStatuses.length;

  const newStatus = failedParts === 0 && completedParts === totalParts && totalParts > 0
    ? "completed"
    : partStatuses.some((j) => j.status === "processing" || j.status === "queued")
      ? "processing_parts"
      : failedParts > 0
        ? "failed"
        : "processing_parts";

  const { error: projectUpdateErr } = await supabase
    .from("transcription_projects")
    .update({
      completed_parts: completedParts,
      failed_parts: failedParts,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId)
    .eq("user_id", user.id);

  if (projectUpdateErr) {
    return new Response(JSON.stringify({ error: projectUpdateErr.message }), { status: 500 });
  }

  // Return updated project and job
  const { data: project } = await supabase
    .from("transcription_projects")
    .select("id, status, total_parts, completed_parts, failed_parts, error_message, error_code, updated_at")
    .eq("id", projectId)
    .maybeSingle();

  const { data: job } = await supabase
    .from("transcription_jobs")
    .select("id, status, progress, error_message, error_code, attempt_count, locked_at, updated_at")
    .eq("id", jobId)
    .maybeSingle();

  return new Response(JSON.stringify({ project, job }), { status: 200 });
}
