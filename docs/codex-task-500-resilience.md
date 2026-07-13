# 実装指示書: OpenAI 500 エラー耐性の強化(バックオフ延長 + チャンク単位レジューム)

## 背景(必読)

`worker/` の文字起こしワーカー(Sakura VPS 上で稼働)で、OpenAI `gpt-4o-transcribe-diarize` が 500(サーバー内部エラー)を断続的に返し、ジョブが失敗している。実ログの挙動:

- チャンク単体の成功時は 189〜276 秒で完了しており、タイムアウト問題は解決済み。
- 500 発生時、現行のリトライは `worker/src/transcribe.ts` の `classifyOpenAITranscriptionError` の汎用 `openai_error` 分岐(約258-267行)で処理され、待機が 2.5秒→4.8秒→8.8秒(上限10秒+ジッタ)の計4試行。OpenAI 側の不調が数分続くと全滅する。
- チャンクリトライが尽きるとジョブは再キューされるが、`worker/src/processor.ts` 204行の `clearJobSegments()` が保存済みセグメントを全削除し、**成功済みチャンクも最初から再転写される**(API費用と時間の無駄)。

この2点を改善する。

## タスク1: 5xx エラー専用のバックオフ分岐を追加

対象: `worker/src/transcribe.ts` の `classifyOpenAITranscriptionError`(183-268行)

- レートリミット分岐(245-256行)の後、汎用フォールバック(258-267行)の前に、**HTTP 5xx 専用の分岐**を追加する:
  - 条件: `extractOpenAIStatus(error)`(既存関数)が 500 以上、または message に `"the server had an error"` を含む
  - `errorCode: "openai_error"`(エラーコード体系は変更しない。`job-errors.ts` は触らない)
  - `maxAttempts: 5`
  - `delayMs: (attempt) => attempt * 30_000`(30秒→60秒→90秒→120秒。合計待機約5分)
- 待機中のジョブロックは既存のハートビート機構が `locked_at` を更新し続けるため追加対応不要(`WORKER_LOCK_TIMEOUT_MINUTES=30` に対し十分短い)。
- `worker/README.md` のエラー分類の説明(74-78行付近)に 5xx の挙動を追記する。

## タスク2: ジョブ再試行時のチャンク単位レジューム

対象: `worker/src/processor.ts`(主に 204-306行)、必要なら `worker/src/segments.ts`

### 現状の仕組み(前提知識)

- セグメント保存は `saveSegments()`(`segments.ts:19`)で、`onConflict: "job_id,chunk_index,segment_index"` の upsert。1チャンク分が1回の upsert で保存されるため、チャンク単位で原子的とみなせる。
- 処理は逐次(チャンク0→1→2...)。失敗するとループが中断するため、**保存済み chunk_index の最大値より後のチャンクは未処理**と保証できる(途中の歯抜けは「セグメント0件で完了したチャンク」のみで、再転写しても upsert なので無害)。
- ジョブ行には `audio_chunk_duration_sec`(`supabase.ts:13`、`updateJobAudioChunkDuration()` で保存)があり、前回の分割チャンク長が分かる。

### 実装内容

1. **無条件の `clearJobSegments()`(204行)を条件付きに変更:**
   - ジョブの `transcription_segments` から保存済みの distinct `chunk_index` を取得する(`segments.ts` に取得関数を追加)。
   - **全消去して最初から**にする条件: 保存済みセグメントが無い / `job.audio_chunk_duration_sec` が現在の `config.audioChunkSeconds` と不一致(チャンク境界が変わるため)。
   - それ以外は**レジューム**: `resumeFromChunkIndex = max(保存済みchunk_index) + 1` とし、`clearJobSegments()` は呼ばない。ログに `[worker] resuming job <id> from chunk N (M chunk(s) already saved)` を出す。

2. **チャンクループ(214行〜)で `chunk.chunkIndex < resumeFromChunkIndex` のチャンクは転写をスキップ。** ただし ffmpeg 分割・チャンクファイル生成(160-179行)は従来どおり全チャンク分行う(下記の話者状態再構築で使うため)。

3. **話者状態の再構築(重要):** スキップしたチャンク分の状態を復元しないと、再開後のチャンクで話者ラベルが破綻する。
   - 保存済みセグメントを DB から読み(`chunk_index, segment_index` 順)、`NormalizedSegment` 形(speakerLabel / startSec / endSec / text / chunkIndex / segmentIndex)に詰め直して `allSegments` に投入する(後段の処理が全文セグメントを前提にしているため)。
   - **使用済み表示ラベルの引き継ぎ:** 保存済みセグメントに出現する speaker_label(例: A, C, E)を「使用済み」として `assignDisplayLabels()`(506-537行)に認識させ、再開後に新規話者へ既存ラベルが再割当てされないようにする。実装は `assignDisplayLabels` がジョブレベルの `usedLabels: Set<string>` を受け取る形へのリファクタを推奨(現在は呼び出しごとに再計算している)。
   - **`knownSpeakers`(話者リファレンス)の再構築:** `speakerReferencesEnabled` が有効な場合、スキップ対象の各チャンクについて、ローカルに再生成済みのチャンクファイルと DB から読んだ該当チャンクのセグメントを使い、既存の `addSpeakerReferencesFromChunk()`(539行〜)を呼んで復元する(通常処理と同じ順序・同じ上限ロジックで)。
   - `apiNewLabelToDisplayLabel` は API リクエスト単位のラベル対応なので空のままでよい(known_speaker_references が話者の同一性を担い、新規話者は使用済みラベルを避けて採番される)。

4. **進捗の初期化:** レジューム時は 205行の `updateJobProgress(supabase, job, job.progress, 0)` で進捗を巻き戻さず、`resumeFromChunkIndex` 相当の進捗(`calculateProgress(resumeFromChunkIndex, chunks.length)`)から開始する。`totalSkippedSegmentsCount` は復元不能なので 0 から数え直しでよい(既知の制限としてコメントを残す)。

5. `worker/README.md` の「Resetting a Job」節(183行〜)に、レジューム挙動の説明と「完全に最初からやり直す場合は segments の delete も実行する」旨を追記する。

## タスク3: 失敗ジョブ再実行の自動リセット(手動SQL撤廃・再実行ボタン修理)

### 背景(タスク3)

現在、失敗ジョブの再実行には `worker/README.md` の「Resetting a Job」の SQL を Supabase で手動実行している。UI の再実行ボタンは2経路あるが、片方が壊れている:

- ジョブ一覧の再実行ボタン → `retryTranscriptionJob` サーバーアクション(`src/app/actions.ts:630-698`)。リセット内容は README の update 文と同等で正しい。
- プロジェクトのパーツ再実行 → `src/app/api/projects/[projectId]/parts/[jobId]/retry/route.ts`。**40-51行に「transcription_segments が1件でも存在したら 400 (`segments_exist`) で拒否」するガードがあり、これが再実行が常に失敗する原因**。ワーカーはチャンクごとにセグメントを保存するため、途中失敗したジョブはほぼ必ず部分セグメントを持つ。

### 実装内容(タスク3)

1. **リセット処理を共通モジュールに抽出する**(コーディング規約「server-side Supabase logic は専用モジュールに」に従う): 例 `src/lib/jobs/reset.ts` に `resetFailedJob(adminSupabase, { jobId, userId })` を作り、README の update 文と同内容(status='queued', progress=0, error_code/error_message/failed_at/started_at/completed_at/locked_at/worker_id=null, attempt_count=0, processed_audio_seconds=null, updated_at=now)を実行する。所有権チェック(user_id 一致・status='failed')は呼び出し側で従来どおり行う。
2. `retryTranscriptionJob`(actions.ts)と retry ルートの両方をこの共通関数を使う形に置き換える。retry ルートの現行 update は `processed_audio_seconds: null` が漏れているので、共通化で自然に直る。
3. **retry ルートの `segments_exist` ガード(40-51行)を削除する。** セグメント数の事前チェッククエリごと不要。
4. **transcription_segments の delete は意図的に実装しない。** 理由: タスク2のレジューム機構が保存済みセグメントを再利用して成功済みチャンクをスキップするため、ここで消すとレジュームが無効になる。チャンク長設定が変わった等の不整合時はワーカー側が自動で全消去する(タスク2参照)。この設計判断を共通モジュールのコメントに1行残すこと。
5. retry ルートのプロジェクト状態再計算(79-114行)は現状のまま維持する。
6. `worker/README.md` の「Resetting a Job」節を更新し、「通常は UI の再実行ボタンで足りる。手動 SQL は開発時のデバッグ用」と位置づけを変える。

## 変更してはいけないもの

- `transcription_segments` / `transcription_jobs` のスキーマ(マイグレーション追加は不要。既存カラムだけで実現できる)
- `job-errors.ts` のエラーコード体系
- upsert の onConflict キー
- ジョブ削除ボタン(`deleteTranscriptionJob`)の挙動

## 受け入れ条件・検証

1. `cd worker && npx tsc --noEmit` が通る(TypeScript strict)。
2. **レジューム動作:** ローカルでジョブを1件完走させたあと、README の「Resetting a Job」の SQL のうち **update 文のみ実行し(delete は実行しない)**、`attempt_count` はそのまま・`status='queued'` に戻して再実行する。ログに `resuming job ... from chunk N` が出て、保存済みチャンクの転写 API が呼ばれないこと。完了後に `select chunk_index, count(*) from transcription_segments where job_id='...' group by 1` で重複がないこと。
3. **チャンク長変更時の全消去:** `AUDIO_CHUNK_SECONDS` を変えて同じ再実行をすると、レジュームせず全チャンク再転写されること。
4. **5xx バックオフ:** 500 を強制発生させるのは難しいため、5xx 分岐のユニットテスト(`classifyOpenAITranscriptionError` に status 500 のエラーオブジェクトを渡し、maxAttempts=5 と 30s/60s/90s/120s の delay を返すこと)を追加して確認する。既存のテスト構成が無い場合は、この関数を export してテスト可能にする最小限の変更は可。
5. 話者ラベル: レジューム後の再開チャンクで、既存話者(保存済みセグメントに出現するラベル)と新規話者のラベルが衝突しないことをログと DB で確認する。
6. **再実行ボタン(タスク3):** `npm run build` が通ること。部分セグメントが残った failed ジョブを用意し、(a) ジョブ一覧の再実行ボタン、(b) プロジェクトのパーツ再実行、の両方で status が `queued` に戻り、`segments_exist` エラーが出ないこと。ワーカーがそのジョブをレジュームして完走することまで通しで確認する。他ユーザーのジョブ ID を指定した場合に拒否されること(所有権チェックが共通化後も機能していること)も確認する。
