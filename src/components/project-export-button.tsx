"use client";

import { useState } from "react";

type ProjectExportButtonProps = {
  canExport: boolean;
  exportBaseName: string;
  projectId: string;
  unavailableReason: string;
};

export function ProjectExportButton({
  canExport,
  exportBaseName,
  projectId,
  unavailableReason,
}: ProjectExportButtonProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  async function exportMarkdown() {
    if (!canExport || isExporting) {
      return;
    }

    setErrorMessage(null);
    setIsExporting(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/export`, {
        method: "GET",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "Markdownの生成に失敗しました。",
        );
      }

      const markdown = await response.blob();
      downloadBlob(
        markdown,
        `${buildSafeFileName(exportBaseName || "transcript")}.md`,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Markdownの生成に失敗しました。",
      );
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={exportMarkdown}
        disabled={!canExport || isExporting}
        className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600"
      >
        {isExporting ? "生成中..." : "Markdownでエクスポート"}
      </button>
      {!canExport && (
        <p className="mt-3 text-sm text-zinc-600">{unavailableReason}</p>
      )}
      {errorMessage && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function buildSafeFileName(baseName: string) {
  const withoutExtension = baseName.replace(/\.[^/.]+$/, "");
  const safeBaseName = withoutExtension
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return safeBaseName || "transcript";
}
