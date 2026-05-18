import { NextResponse } from "next/server";
import {
  buildProjectMarkdownExport,
  ProjectExportError,
  sanitizeMarkdownFileName,
} from "@/lib/project-export";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: "ログインが必要です。" },
      { status: 401 },
    );
  }

  try {
    const exported = await buildProjectMarkdownExport({
      projectId,
      supabase,
      userId: user.id,
    });
    const filename = `${sanitizeMarkdownFileName(exported.fileBaseName)}.md`;

    return new NextResponse(exported.markdown, {
      headers: {
        "Content-Disposition": buildContentDisposition(filename),
        "Content-Type": "text/markdown; charset=utf-8",
      },
    });
  } catch (error) {
    const status = error instanceof ProjectExportError ? error.status : 500;
    const message =
      error instanceof Error
        ? error.message
        : "Markdownの生成に失敗しました。";

    return NextResponse.json({ error: message }, { status });
  }
}

function buildContentDisposition(filename: string) {
  const asciiFallback =
    filename
      .replace(/[^\x20-\x7E]+/g, "-")
      .replace(/["\\]/g, "_")
      .replace(/^-+|-+$/g, "") || "transcript.md";

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(
    filename,
  )}`;
}
