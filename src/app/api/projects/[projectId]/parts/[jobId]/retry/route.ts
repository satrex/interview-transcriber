import { NextRequest } from "next/server";
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

  // Check for existing transcription_segments for this job. If any exist, refuse retry to avoid conflicts.
  const { data: segs, error: segErr } = await supabase
    .from("transcription_segments")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);

  if (segErr) {
    return new Response(JSON.stringify({ error: segErr.message }), { status: 500 });
  }
  if (segs && (segs as any).count && (segs as any).count > 0) {
    return new Response(JSON.stringify({ error: "segments_exist", message: "このジョブには既に部分的なセグメントがあります。再実行前に管理者に確認してください。" }), { status: 400 });
  }

  // Perform the update: set job back to queued and reset fields
  const { error: updateErr } = await supabase
    .from("transcription_jobs")
    .update({
      status: "queued",
      progress: 0,
      error_code: null,
      error_message: null,
      failed_at: null,
      started_at: null,
      completed_at: null,
      locked_at: null,
      worker_id: null,
      attempt_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .eq("status", "failed");

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

  const completedParts = (counts || []).filter((j: any) => j.status === "completed").length;
  const failedParts = (counts || []).filter((j: any) => j.status === "failed").length;
  const totalParts = (counts || []).length;

  const newStatus = failedParts === 0 && completedParts === totalParts && totalParts > 0
    ? "completed"
    : (counts || []).some((j: any) => j.status === "processing" || j.status === "queued")
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
