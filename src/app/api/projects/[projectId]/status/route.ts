import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const params = await context.params;
  const projectId = params.projectId;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "not_authenticated" }), { status: 401 });
  }

  const { data: project } = await supabase
    .from("transcription_projects")
    .select("id, title, status, total_duration_sec, part_duration_sec, total_parts, completed_parts, failed_parts, error_message, error_code, created_at, updated_at")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  }

  const { data: parts } = await supabase
    .from("transcription_jobs")
    .select("id, project_id, part_index, part_start_sec, part_end_sec, status, progress, error_message, error_code, started_at, completed_at, failed_at, updated_at")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .eq("is_project_part", true)
    .order("part_index");

  return new Response(JSON.stringify({ project, parts: parts || [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
