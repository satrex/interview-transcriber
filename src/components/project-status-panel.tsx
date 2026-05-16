"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";

type Project = {
  id: string;
  title: string;
  status: string;
  total_duration_sec: number | null;
  part_duration_sec: number;
  total_parts: number | null;
  completed_parts: number;
  failed_parts: number;
  error_message: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

type Part = {
  id: string;
  part_index: number;
  part_start_sec: number;
  part_end_sec: number;
  status: string;
  progress: number;
  error_message: string | null;
  error_code: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  failed_at?: string | null;
  updated_at?: string | null;
};

const POLL_INTERVAL_ACTIVE = 5000;
const POLL_INTERVAL_INACTIVE = 30000;

const STATUS_LABELS: Record<string, string> = {
  queued: "処理待ち",
  splitting: "音声を分割中",
  processing_parts: "文字起こし中",
  split_completed: "分割完了",
  completed: "完了",
  failed: "失敗",
  cancelled: "キャンセル済み",
};

function formatTime(seconds: number | null) {
  if (seconds === null) return "--:--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function relativeTimeLabel(dateIso: string) {
  const diff = Math.floor((Date.now() - new Date(dateIso).getTime()) / 1000);
  if (diff < 5) return "たった今";
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return new Date(dateIso).toLocaleString();
}

export default function ProjectStatusPanel({
  project: initialProject,
  parts: initialParts,
  projectId,
}: {
  project: Project;
  parts: Part[];
  projectId: string;
}) {
  const [project, setProject] = useState<Project>(initialProject);
  const [parts, setParts] = useState<Part[]>(initialParts);
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toISOString());
  const [now, setNow] = useState<number>(Date.now());
  const pollingRef = useRef<number | null>(null);

  const isActiveStatus = (s: string) => ["queued", "splitting", "processing_parts", "processing", "split_completed"].includes(s);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/status`);
      if (!res.ok) return;
      const body = await res.json();
      if (body.project) setProject(body.project);
      if (Array.isArray(body.parts)) setParts(body.parts);
      setLastUpdated(new Date().toISOString());
    } catch (e) {
      // ignore transient errors
      console.warn("Failed to fetch project status", e);
    }
  };

  useEffect(() => {
    let mounted = true;

    const doPoll = async () => {
      await fetchStatus();
      if (!mounted) return;
      const interval = isActiveStatus(project.status) ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_INACTIVE;
      pollingRef.current = window.setTimeout(() => doPoll(), interval);
    };

    doPoll();

    const onVisibility = () => {
      if (document.hidden) {
        if (pollingRef.current) {
          clearTimeout(pollingRef.current);
          pollingRef.current = null;
        }
      } else {
        doPoll();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mounted = false;
      if (pollingRef.current) clearTimeout(pollingRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const totalParts = project.total_parts ?? parts.length;
  const completedParts = project.completed_parts ?? parts.filter((p) => p.status === "completed").length;
  const processingProgressSum = parts.filter((p) => p.status === "processing").reduce((sum, p) => sum + (p.progress || 0), 0);
  const inProgressCount = parts.filter((p) => p.status === "processing").length;

  const projectProgress = totalParts > 0 ? Math.round(((completedParts + (processingProgressSum / 100)) / totalParts) * 100) : null;

  const phaseText = (() => {
    if (project.status === "queued") return "処理開始を待っています。";
    if (project.status === "splitting") return `音声を${Math.floor(project.part_duration_sec / 60)}分ごとのパートに分割しています。`;
    if (project.status === "processing_parts") return "パートごとに文字起こししています。";
    if (parts.some((p) => p.status === "processing")) {
      const p = parts.find((x) => x.status === "processing");
      if (p) return `Part ${p.part_index + 1} を文字起こし中です。`;
    }
    if (project.status === "completed") return "すべてのパートが完了しました。編集できます。";
    if (project.status === "failed") return "処理中にエラーが発生しました。";
    return "状態を確認しています。";
  })();

  // simple ETA (P1)
  const etaLabel = (() => {
    if (projectProgress === null || projectProgress < 10) return null;
    const createdAt = new Date(project.created_at).getTime();
    const elapsed = Date.now() - createdAt;
    const estimatedTotal = Math.round(elapsed / (projectProgress / 100));
    const remaining = Math.max(0, estimatedTotal - elapsed);
    const mins = Math.round(remaining / 60000);
    if (mins <= 5) return "約5分以内";
    if (mins <= 15) return "約10分";
    if (mins <= 30) return "約20〜30分";
    if (mins <= 60) return "約30〜60分";
    return "1時間以上";
  })();

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-zinc-200 bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">{project.title}</h2>
              <span className="rounded-md bg-zinc-100 px-2 py-1 text-sm font-medium text-zinc-700">
                {STATUS_LABELS[project.status] ?? "状態確認中"}
                {isActiveStatus(project.status) && <span className="ml-2 inline-block animate-spin">●</span>}
              </span>
            </div>
            <p className="mt-2 text-sm text-zinc-600">{phaseText}</p>
          </div>
          <div className="text-right text-sm text-zinc-600">
            <div>最後の更新: {relativeTimeLabel(lastUpdated)}</div>
            {etaLabel && <div>推定残り時間: {etaLabel}</div>}
            <div className="mt-2 text-xs text-zinc-500">画面を閉じても処理は続きます。</div>
          </div>
        </div>

        <div className="mt-4">
          {projectProgress === null ? (
            <div className="h-4 w-full rounded-md bg-zinc-100">
              <div className="h-4 w-1/3 animate-pulse rounded-md bg-zinc-300" />
            </div>
          ) : (
            <div className="h-4 w-full rounded-md bg-zinc-100">
              <div className="h-4 rounded-md bg-zinc-700" style={{ width: `${projectProgress}%` }} />
            </div>
          )}
          <div className="mt-2 text-sm text-zinc-600">進捗: {projectProgress === null ? "解析中..." : `${projectProgress}%`} ({completedParts}/{totalParts || "?"} 完了)</div>
        </div>
      </div>

      <div className="rounded-md border border-zinc-200 bg-white">
        <div className="border-b px-6 py-4">
          <h3 className="text-sm font-semibold">パート一覧</h3>
        </div>
        <div className="divide-y">
          {parts.length === 0 ? (
            <div className="p-6 text-sm text-zinc-600">音声を解析し、パートを準備しています...</div>
          ) : (
            parts.map((p) => (
              <div key={p.id} className={`p-4 flex items-center justify-between ${p.status === "processing" ? "bg-zinc-50" : ""}`}>
                <div>
                  <div className="text-sm font-medium">Part {p.part_index + 1} ・ {formatTime(p.part_start_sec)} - {formatTime(p.part_end_sec)}</div>
                  <div className="mt-1 text-xs text-zinc-600">ステータス: <strong>{STATUS_LABELS[p.status] ?? p.status}</strong> ・ 進捗: {p.progress}%</div>
                  {p.status === "failed" && p.error_message && (
                    <div className="mt-1 text-xs text-red-600">エラー: {p.error_message}</div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {p.status === "completed" ? (
                    <Link href={`/jobs/${p.id}`} className="inline-flex items-center rounded-md bg-zinc-900 px-3 py-2 text-sm text-white">編集する</Link>
                  ) : p.status === "processing" ? (
                    <div className="text-sm text-zinc-700">処理中 ({p.progress}%)</div>
                  ) : (
                    <div className="text-sm text-zinc-500">{p.status}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
