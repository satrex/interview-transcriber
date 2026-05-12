# Test Plan

このドキュメントは、現在の Interview Transcriber 実装を 30 秒から 2 時間音声まで段階的に検証するための手順です。機能追加は行わず、既存の Web アプリ、Supabase、worker、OpenAI transcription、ffmpeg の結合状態を確認します。

現在の worker は 1 回の起動で claim 可能な job を 1 件だけ処理して終了します。claim 可能な job は `queued`、または `locked_at` が `WORKER_LOCK_TIMEOUT_MINUTES` より古い stale な `processing` で、かつ `attempt_count < WORKER_MAX_ATTEMPTS` のものです。

## 前提

- Supabase migrations が適用済みであること。
- Supabase Auth にログイン可能な test user があること。
- root `.env.local` と `worker/.env` が設定済みであること。
- `ffmpeg` と `ffprobe` が利用可能であること。
- OpenAI API key が transcription 利用可能であること。
- test audio はローカルまたは検証用 Storage に置き、リポジトリへ commit しないこと。
- 2 時間テストはコストと時間が大きいため、30 秒、3-5 分、15 分が成功してから実施すること。

Root `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MAX_UPLOAD_SIZE_MB=1024
```

Worker `worker/.env`:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

WORKER_ID=local-worker
WORKER_LOCK_TIMEOUT_MINUTES=30
WORKER_MAX_ATTEMPTS=3
WORKER_TMP_DIR=/tmp/interview-transcriber
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
AUDIO_CHUNK_SECONDS=600

OPENAI_API_KEY=
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize
```

## 事前確認

依存関係と build を確認します。

```bash
npm install
npm run lint
npm run build
cd worker
npm install
npm run build
cd ..
```

audio tool を確認します。

```bash
ffmpeg -version
ffprobe -version
```

Supabase Storage bucket を確認します。

- bucket: `audio`
- public: false
- allowed MIME types: `audio/mpeg`, `audio/m4a`, `audio/mp4`, `audio/x-m4a`, `audio/wav`, `audio/x-wav`
- file size limit: 1 GB

2 時間音声は WAV だと 1 GB を超えやすいため、まず mp3 または m4a で検証します。

## 共通フロー

1. Web app を起動します。

```bash
npm run dev
```

2. `http://localhost:3000` を開き、Supabase Auth user でログインします。
3. `/` から音声ファイルを upload します。
4. redirect 先の `/jobs/{job_id}` から `job_id` を控えます。
5. DB の job が `queued`、Storage に source file があることを確認します。
6. worker を 1 回起動します。

```bash
cd worker
npm run dev
```

7. worker が終了したら、DB、Storage、worker log、job detail page を確認します。
8. job detail page は realtime 更新ではないため、処理後に browser refresh して確認します。

## 段階的テスト

### 1. 30 秒音声の最小 E2E テスト

目的:

- upload から job 作成、worker 処理、segments 保存、Markdown 表示までの最小経路を確認する。
- chunk 分割なし、または 1 chunk の基本動作を確認する。

test audio:

- 長さ: 30 秒前後
- 形式: `mp3`, `m4a`, または `wav`
- 内容: 1 人または 2 人の短い会話
- 推奨ファイル名: `e2e-30s.mp3`

期待結果:

- upload 後、`transcription_jobs.status = 'queued'`
- worker claim 後、`processing` を経て `completed`
- `progress = 100`
- `attempt_count = 1`
- `transcription_segments` に 1 件以上保存される
- `chunk_index = 0` のみ
- job detail page に speaker grouped transcript と Markdown textarea が表示される
- Markdown copy button が成功する
- Markdown と txt の保存ボタンで display name 反映済みの transcript を保存できる
- 長い同一話者発言が自然に結合され、長すぎる場合は段落分けされる
- job detail page の品質メモに録音環境、誤変換、話者識別ミス、タイムスタンプずれを保存できる
- job detail page の話者名に `speaker_0 -> さとレックス` のような対応表を保存できる

合格基準:

- source file が Storage に残っている
- worker temporary directory が削除されている
- `error_message` が null
- transcript text が音声内容と大きく乖離していない
- `transcription_job_quality_notes` に job ごとの品質メモが 1 行で保存され、画面 refresh 後も表示される
- `transcription_job_speaker_names` の display name が transcript 表示と Markdown 出力に反映され、未設定の話者は元の `speaker_label` で表示される
- タイムスタンプ toggle の状態がコピー内容、Markdown 保存、txt 保存すべてに反映される

### 2. 3-5 分の複数話者テスト

目的:

- diarization により複数話者が分かれることを確認する。
- 同一話者の連続 segment が画面上で結合表示されることを確認する。
- timestamps が概ね単調増加することを確認する。

test audio:

- 長さ: 3-5 分
- 形式: `mp3` または `m4a`
- 内容: 2-3 人の会話。話者交代が複数回あるもの。
- 推奨ファイル名: `multi-speaker-5m.m4a`

期待結果:

- `transcription_segments.speaker_label` に 2 種類以上の値が入る
- `start_sec` / `end_sec` が音声の時系列に沿って並ぶ
- `chunk_index = 0` のみ
- job detail page では未設定の speaker label が元の label のまま表示され、話者名保存後は display name に置き換わる
- timestamps toggle の ON/OFF で Markdown 表示が切り替わる

合格基準:

- 主要な話者交代が segment に反映されている
- `speaker_label = 'unknown'` だけになっていない
- 文字起こし本文に空文字 segment がない

### 3. 15 分音声の chunk 分割・結合テスト

目的:

- `AUDIO_CHUNK_SECONDS=600` の既定値で 10 分ごとの chunk 分割が行われることを確認する。
- chunk ごとの transcription 結果が global timestamp に補正され、DB と UI で結合表示できることを確認する。

test audio:

- 長さ: 15 分前後
- 形式: `mp3` または `m4a`
- 内容: 1-2 人の会話。10 分境界付近に発話があるとよい。
- 推奨ファイル名: `chunk-15m.m4a`

期待結果:

- worker log に `splitting audio into 600s chunks`
- worker log に chunk 0 と chunk 1 が出る
- `transcription_segments.chunk_index` が `0`, `1` になる
- chunk 1 の `start_sec` は 600 秒以降になる
- aggregate check で chunk 0 と chunk 1 の row が確認できる
- job detail page では chunk をまたいだ transcript が時系列で表示される

合格基準:

- `chunk_index = 1` の最小 `start_sec` が 600 秒以上
- `max(end_sec)` が音声長に近い
- chunk 0 と chunk 1 の間で timestamp が逆行しない
- worker temporary chunk files が処理後に残っていない

### 4. 2 時間音声の耐久テスト

目的:

- 長時間音声で worker が heartbeat を更新しながら完走することを確認する。
- 12 chunk 程度の連続 transcription、progress 更新、DB insert、tmp cleanup が耐えられることを確認する。
- Vercel app が長時間処理を直接行わず、job 状態の表示だけを行うことを確認する。

test audio:

- 長さ: 2 時間前後
- 形式: `mp3` または `m4a`
- サイズ: 1 GB 未満
- 内容: 実 interview に近い長尺会話
- 推奨ファイル名: `durability-2h.m4a`

期待結果:

- upload は Vercel/Next.js 側で source file を Storage に保存し、job を `queued` で作成する
- worker log に chunk 0 から chunk 11 前後が出る
- `progress` が chunk ごとに増え、最後に 100 になる
- 処理中に `locked_at` が定期的に更新される
- `attempt_count = 1` で完走する
- `completed_at` が入り、`failed_at` は null
- tmp directory が削除される

合格基準:

- `status = 'completed'`
- `transcription_segments` が全 chunk に存在する
- `max(end_sec)` が 7200 秒前後
- 途中 chunk の失敗、重複 insert、timestamp 逆行がない
- worker process が異常終了しない

## DB 確認

Job record:

```sql
select
  id,
  user_id,
  original_filename,
  storage_bucket,
  storage_path,
  status,
  progress,
  attempt_count,
  worker_id,
  locked_at,
  started_at,
  completed_at,
  failed_at,
  error_message,
  created_at,
  updated_at
from transcription_jobs
where id = '<job-id>';
```

成功時の期待値:

- `status = 'completed'`
- `progress = 100`
- `attempt_count = 1`
- `worker_id` が設定されている
- `locked_at` が設定されている
- `started_at` が設定されている
- `completed_at` が設定されている
- `failed_at is null`
- `error_message is null`
- `storage_bucket = 'audio'`
- `storage_path` が `jobs/{job_id}/source/` で始まる

Segment records:

```sql
select
  id,
  job_id,
  speaker_label,
  start_sec,
  end_sec,
  text,
  chunk_index,
  created_at,
  updated_at
from transcription_segments
where job_id = '<job-id>'
order by chunk_index asc, start_sec asc;
```

segment の期待値:

- すべての row が対象 `job_id`
- `speaker_label` が空でない
- `start_sec >= 0`
- `end_sec >= start_sec`
- `text` が空でない
- `chunk_index >= 0`
- multi-chunk では後続 chunk の timestamp が global offset 済み

Aggregate checks:

```sql
select
  chunk_index,
  count(*) as segment_count,
  min(start_sec) as first_start_sec,
  max(end_sec) as last_end_sec
from transcription_segments
where job_id = '<job-id>'
group by chunk_index
order by chunk_index asc;
```

speaker check:

```sql
select
  speaker_label,
  count(*) as segment_count,
  min(start_sec) as first_start_sec,
  max(end_sec) as last_end_sec
from transcription_segments
where job_id = '<job-id>'
group by speaker_label
order by segment_count desc;
```

timestamp order check:

```sql
with ordered as (
  select
    id,
    chunk_index,
    start_sec,
    end_sec,
    lag(end_sec) over (order by chunk_index asc, start_sec asc) as previous_end_sec
  from transcription_segments
  where job_id = '<job-id>'
)
select *
from ordered
where previous_end_sec is not null
  and start_sec < previous_end_sec - 5
order by chunk_index asc, start_sec asc;
```

この query は chunk 境界や diarization の重なりを考慮して 5 秒以上の大きな逆行だけを検出します。結果が 0 件なら合格目安です。

## Storage 確認

Supabase Storage:

- bucket: `audio`
- expected source path: `jobs/{job_id}/source/{safe_original_filename}`

確認ポイント:

- upload 直後に source file が存在する
- `transcription_jobs.storage_path` と実際の Storage path が一致する
- source file は worker 完了後も残る
- worker chunk file は Supabase Storage には upload されない
- failed job でも source file は残り、再試行可能である

worker local tmp:

- root: `WORKER_TMP_DIR`
- job tmp dir: `{WORKER_TMP_DIR}/{job_id}`
- chunk dir: `{WORKER_TMP_DIR}/{job_id}/chunks`
- chunk file: `{job_id}_chunk_000.wav`, `{job_id}_chunk_001.wav`, ...

確認ポイント:

- 処理中は local chunk file が存在する
- 処理終了後、成功・失敗どちらでも `{WORKER_TMP_DIR}/{job_id}` が削除される

## Worker log 確認

成功時に見る順序:

```txt
[worker] starting ...
[worker] node version: ...
[worker] max concurrent jobs: 1
[worker] poll interval: 10000ms
[worker] claimed job {job_id} attempt 1/3
[worker] downloading job {job_id}: jobs/{job_id}/source/...
[worker] downloaded ... bytes to ...
[worker] ffprobe audio info:
[worker] splitting audio into 600s chunks
[worker] created N chunk file(s):
[worker] chunk 0: .../{job_id}_chunk_000.wav (... bytes)
[worker] transcribing chunk 0 starting at 0s
[worker] saved N segment(s) for chunk 0; progress P%
[worker] completed job {job_id}
[worker] cleaned temporary directory /tmp/interview-transcriber/{job_id}
```

multi-chunk で見るポイント:

- chunk file が連番で出る
- `transcribing chunk 1 starting at 600s` のように offset が付く
- 2 時間音声では default chunk size ならおおむね 12 chunk
- chunk ごとに `saved N segment(s)` が出る
- 長時間処理中に stale claim されない

失敗時に見るポイント:

- `job {job_id} failed: ...` の error message
- `attempt X/3 failed; requeued.` または `failed after X/3 attempts.`
- `cleaned temporary directory ...` が失敗時にも出ているか
- OpenAI error、ffmpeg error、Storage download error、DB insert error のどこで止まったか

## 失敗時の切り分け手順

### 1. Upload で失敗する

確認:

- file extension が `mp3`, `m4a`, `wav` のいずれか
- file size が `MAX_UPLOAD_SIZE_MB` 以下
- `.env.local` の `SUPABASE_SERVICE_ROLE_KEY` が正しい
- Storage bucket `audio` が存在する
- Storage MIME type 制限に合っている

DB / Storage:

- Storage に source file があるが job record がない場合、job insert に失敗している。実装上は upload 済み file を remove するため、Storage に残っていないかも確認する。
- job record があるが Storage file がない場合、`storage_path` と bucket を確認する。

### 2. Worker が job を claim しない

確認 SQL:

```sql
select id, status, attempt_count, worker_id, locked_at, created_at, error_message
from transcription_jobs
order by created_at desc
limit 20;
```

確認:

- 対象 job が `queued` か
- `attempt_count < WORKER_MAX_ATTEMPTS` か
- stale `processing` の場合、`locked_at` が timeout より古いか
- `claim_next_transcription_job` migration が適用されているか
- worker が service role key で接続しているか

### 3. Storage download で失敗する

確認:

- `transcription_jobs.storage_bucket` が `audio`
- `transcription_jobs.storage_path` が実 Storage path と一致
- service role key が worker に設定されている
- source file が削除されていない

### 4. ffprobe / ffmpeg で失敗する

確認:

- `ffprobe -version` と `ffmpeg -version` が worker 環境で通る
- `FFMPEG_PATH` / `FFPROBE_PATH` が正しい
- input file が音声として読める
- audio stream が `0:a:0` に存在する
- file が破損していない

必要ならローカルで手動確認します。

```bash
ffprobe path/to/audio.m4a
ffmpeg -hide_banner -i path/to/audio.m4a -vn -map 0:a:0 -ac 1 -ar 16000 -c:a pcm_s16le -f segment -segment_time 600 /tmp/chunk_%03d.wav
```

### 5. OpenAI transcription で失敗する

確認:

- `OPENAI_API_KEY` が worker に設定されている
- `OPENAI_TRANSCRIPTION_MODEL` が利用可能な transcription model か
- API rate limit、quota、file size、timeout の error message
- chunk wav が生成されているか
- 30 秒 test が成功し、長時間だけ失敗するなら chunk ごとの failure point

### 6. Segment 保存で失敗する

確認:

- `transcription_segments` migration が適用済み
- service role key で insert している
- OpenAI response に `segments` がある
- `start`, `end`, `text` が欠落していない
- `end_sec >= start_sec` の constraint に違反していない

### 7. UI に transcript が出ない

確認:

- job detail page を refresh したか
- ログイン中 user が job owner か
- `transcription_segments` に row が存在するか
- RLS policy で owner が segments を select できるか
- query が `chunk_index asc, start_sec asc` で返っているか

### 8. 途中失敗後に再試行したい

同じ job を再実行する場合:

```sql
update transcription_jobs
set status = 'queued',
    progress = 0,
    attempt_count = 0,
    worker_id = null,
    locked_at = null,
    started_at = null,
    completed_at = null,
    failed_at = null,
    error_message = null
where id = '<job-id>';

delete from transcription_segments
where job_id = '<job-id>';
```

worker を再度 1 回起動します。

```bash
cd worker
npm run dev
```

## 記録テンプレート

各 test run で以下を記録します。

```txt
date:
tester:
environment:
audio file:
duration:
file size:
format:
job_id:
worker_id:
AUDIO_CHUNK_SECONDS:
expected chunk count:
actual chunk count:
final status:
progress:
attempt_count:
segment count:
speaker labels:
max end_sec:
storage source exists:
tmp cleaned:
result:
notes:
```
