# プロジェクトのロックタイムアウト付き再claim設計

## 背景

`claim_queued_project`（`supabase/migrations/0017_project_splitting.sql`）は
`status = 'queued'` のプロジェクトしかclaimしない。worker が `splitting` 中に
クラッシュ・再起動すると、そのプロジェクトは誰にも拾われず永久に `splitting` の
まま残る（真のデッドロック）。

ジョブ側には `claim_next_transcription_job`（0015で最終定義）に stale 再claim が
実装済みなので、同じパターンをプロジェクトに移植する。

現状の問題点（今回の設計で解消するもの）:

1. **stale 再claim なし**: `splitting` で固まったプロジェクトを回収する経路がない。
2. **所有権の概念がない**: `transcription_projects` に `worker_id` / `locked_at` /
   `attempt_count` カラムがなく、RPC の `p_worker_id` / `p_lock_timeout_at` 引数は
   受け取るだけで未使用。
3. **ハートビートがない**: 分割処理（2時間音源のダウンロード → ffmpeg 再エンコード
   → パートアップロード）はロックタイムアウトより長くかかり得るため、生きている
   worker から横取りされる恐れがある。ジョブ側の `touchJobLock` +
   `startHeartbeat`（`worker/src/processor.ts`）に相当する仕組みが必要。
4. **status 更新順の隙間**: `processProject` は `updateProjectWithParts`
   （status → `processing_parts`）→ `createPartJobs` の順で実行する。この間で
   worker が死ぬと「`processing_parts` なのにパートジョブ0件」となり、
   `splitting` 再claimでも救えない。順序を逆にし、パートジョブ挿入を冪等にする。
5. **RPC の権限漏れ**: 0017 の `claim_queued_project` は `security definer` なのに
   `revoke` していないため、`authenticated` ロールからも実行できてしまう
   （0015 のジョブ用RPCは `service_role` のみに絞っている）。

## 設計

### 1. スキーマ変更（新規マイグレーション 0026）

```sql
alter table public.transcription_projects
  add column if not exists worker_id text,
  add column if not exists locked_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists attempt_count integer not null default 0;

-- 再claim時のパートジョブ再挿入を冪等にする
create unique index if not exists uq_transcription_jobs_project_part
  on public.transcription_jobs (project_id, part_index)
  where is_project_part;
```

### 2. RPC を差し替え

シグネチャをジョブ側と揃える（絶対時刻ではなく分数を渡す。既存の
`p_lock_timeout_at` は絶対時刻でしかも未使用だったため互換性は気にしない）。

```sql
drop function if exists public.claim_queued_project(text, timestamptz);

create or replace function public.claim_queued_project(
  p_worker_id text,
  p_lock_timeout_minutes integer default 30,
  p_max_attempts integer default 3
)
returns setof public.transcription_projects
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'p_worker_id is required';
  end if;
  if p_lock_timeout_minutes <= 0 then
    raise exception 'p_lock_timeout_minutes must be positive';
  end if;
  if p_max_attempts <= 0 then
    raise exception 'p_max_attempts must be positive';
  end if;

  -- 試行回数を使い切って stale になった splitting プロジェクトを failed に落とす
  update public.transcription_projects
  set
    status = 'failed',
    error_message = 'Project splitting exceeded max attempts while stale.',
    error_code = 'project_split_attempts_exhausted',
    updated_at = now()
  where status = 'splitting'
    and greatest(
      coalesce(locked_at, '-infinity'::timestamptz),
      updated_at,
      coalesce(started_at, '-infinity'::timestamptz),
      created_at
    ) < now() - make_interval(mins => p_lock_timeout_minutes)
    and attempt_count >= p_max_attempts;

  -- queued または stale な splitting をclaim
  return query
  with candidate as (
    select id
    from public.transcription_projects
    where (
        status = 'queued'
        or (
          status = 'splitting'
          and greatest(
            coalesce(locked_at, '-infinity'::timestamptz),
            updated_at,
            coalesce(started_at, '-infinity'::timestamptz),
            created_at
          ) < now() - make_interval(mins => p_lock_timeout_minutes)
        )
      )
      and attempt_count < p_max_attempts
    order by created_at asc
    limit 1
    for update skip locked
  )
  update public.transcription_projects as project
  set
    status = 'splitting',
    worker_id = p_worker_id,
    locked_at = now(),
    started_at = coalesce(project.started_at, now()),
    attempt_count = project.attempt_count + 1,
    error_message = null,
    error_code = null,
    updated_at = now()
  from candidate
  where project.id = candidate.id
  returning project.*;
end;
$$;

revoke all on function public.claim_queued_project(text, integer, integer)
from public, anon, authenticated;

grant execute on function public.claim_queued_project(text, integer, integer)
to service_role;
```

戻り値は `transcription_projects[]` から `setof` に変更（ジョブ側と統一）。
supabase-js からはどちらも配列で返るので worker 側の `data?.[0]` はそのまま動く。

### 3. worker 側の変更

#### `claimQueuedProject`（`worker/src/projects.ts`）

```ts
const { data, error } = await supabase.rpc("claim_queued_project", {
  p_worker_id: workerId,
  p_lock_timeout_minutes: options.lockTimeoutMinutes,
  p_max_attempts: options.maxAttempts, // config.maxAttempts を流用
});
```

#### `touchProjectLock` を新設（`jobs.ts` の `touchJobLock` と同型）

```ts
update transcription_projects set locked_at = now()
where id = :id and status = 'splitting'
  and worker_id = :workerId and attempt_count = :attemptCount
```

0行更新なら「所有権を失った」として throw。

#### `processProject` にハートビートを追加

`processor.ts` の `startHeartbeat` をプロジェクト用に一般化して流用する
（30〜60秒間隔、`maxLockRefreshFailures` 回連続失敗で fatal）。
ffmpeg ループの各イテレーション先頭とアップロードループで
`heartbeat.assertHealthy()` を呼び、所有権喪失時は即座に中断する。
所有権を失った場合は `markProjectFailed` を呼ばない（新しい所有者の状態を
上書きしないため）。

#### 完了・失敗系の更新に所有権ガードを追加

`markProjectSplitting` / `updateProjectWithParts` / `markProjectFailed` の
`update` に `.eq("status", "splitting").eq("worker_id", workerId)
.eq("attempt_count", attemptCount)` を付け、`select("id").maybeSingle()` で
0行なら所有権喪失として扱う（`jobs.ts` と同じパターン）。
なお `markProjectSplitting` は claim RPC が既に `splitting` にするため
ロック更新（touch）に置き換えるか削除する。

`markProjectFailed` は「明示的な失敗（ffmpeg失敗・検証失敗など決定論的な
エラー）」用として現状どおり即 failed とする。クラッシュ由来の復旧のみ
attempt_count + stale 再claimで面倒を見る。ジョブ側のような「失敗時に
requeue して再試行」はプロジェクトには入れない（分割失敗はほぼ決定論的で、
リトライしても同じ結果になるため）。

#### `processProject` の順序修正 + 冪等化

1. `createPartJobs` を **先に** 実行し、`insert` を
   `upsert(partJobs, { onConflict: "project_id,part_index", ignoreDuplicates: true })`
   に変更（前回の試行で挿入済みのパートがあっても安全）。
2. その後 `updateProjectWithParts`（status → `processing_parts`）。

これで「どの時点で worker が死んでも、再claim → 再分割 → 冪等な再挿入 →
status 遷移」で必ず前に進む。パート音源のアップロードは既に
`upsert: true` かつ決定論的なパスなので再実行に安全。

### 4. 変更しないこと

- ロックタイムアウト・最大試行回数は既存の `WORKER_LOCK_TIMEOUT_MINUTES`
  （デフォルト30分）と `WORKER_MAX_ATTEMPTS`（デフォルト3）を流用し、
  新しい環境変数は増やさない。
- `processing_parts` 以降の進行管理（`updateProjectProgress`）は変更しない。
  パートジョブ側の stale 再claimが既にあるため。

## 復旧マトリクス

| worker が死ぬタイミング | 復旧経路 |
|---|---|
| claim直後〜ダウンロード中 | タイムアウト後に stale 再claim、attempt +1 で再分割 |
| ffmpeg分割・アップロード中 | 同上（アップロードは upsert なので安全） |
| `createPartJobs` の途中 | 再claim後、unique index + ignoreDuplicates で残りだけ挿入 |
| `createPartJobs` 後〜`updateProjectWithParts` 前 | 再claim後、全パート挿入済み → status を `processing_parts` へ |
| attempt_count が上限到達後に stale | claim RPC 冒頭で `failed`（`project_split_attempts_exhausted`）に自動遷移し、UI に失敗が見える |

## テスト観点

- `splitting` のまま `locked_at` を31分前に偽装 → 次のポーリングで再claimされ
  attempt_count が増えること。
- attempt_count = 3 で stale → claim RPC 実行時に failed へ落ちること。
- パートジョブが一部挿入済みの状態で再claim → 重複ジョブが増えないこと
  （unique index 違反にならず ignoreDuplicates で通ること）。
- 正常系: 2時間音源の分割がハートビートによりロックを維持し、
  並行workerに横取りされないこと（`locked_at` が定期更新されるのを確認）。
- `authenticated` ロールから `claim_queued_project` が実行できないこと。
