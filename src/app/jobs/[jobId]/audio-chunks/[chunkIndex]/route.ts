import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  buildJobAudioChunkStoragePath,
  createAudioSignedUrl,
  getAudioBucketName,
} from "@/lib/storage";

export async function GET(
  _request: NextRequest,
  context: {
    params: Promise<{
      chunkIndex: string;
      jobId: string;
    }>;
  },
) {
  const { chunkIndex: rawChunkIndex, jobId } = await context.params;
  const chunkIndex = Number.parseInt(rawChunkIndex, 10);

  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return NextResponse.json({ error: "Invalid chunk index." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: job, error } = await supabase
    .from("transcription_jobs")
    .select("id, audio_chunk_duration_sec")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    console.error("[audio chunk] failed to load job", {
      error: error.message,
      jobId,
    });
    return NextResponse.json({ error: "Failed to load job." }, { status: 500 });
  }

  if (!job) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const chunkDurationSec = toPositiveNumber(job.audio_chunk_duration_sec);

  if (chunkDurationSec === null) {
    return NextResponse.json(
      { error: "Audio chunks are not available for this job." },
      { status: 404 },
    );
  }

  const chunkPath = buildJobAudioChunkStoragePath(job.id, chunkIndex);
  console.debug("[audio chunk] resolved chunk path", {
    chunkIndex,
    chunkPath,
    jobId,
  });

  try {
    const adminSupabase = createAdminSupabaseClient();
    const signedUrl = await createAudioSignedUrl({
      bucket: getAudioBucketName(),
      path: chunkPath,
      storage: adminSupabase.storage,
    });

    return NextResponse.json({
      chunkDurationSec,
      chunkIndex,
      chunkPath,
      signedUrl,
    });
  } catch (error) {
    console.warn("[audio chunk] failed to create signed URL", {
      chunkIndex,
      chunkPath,
      error: error instanceof Error ? error.message : String(error),
      jobId,
    });
    return NextResponse.json(
      { error: "Audio chunk is not available." },
      { status: 404 },
    );
  }
}

function toPositiveNumber(value: number | string | null) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}
