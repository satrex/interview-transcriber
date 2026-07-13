# 実装指示書: diarize モデルのコンテンツ起因 500 に対するフォールバック

## 背景(必読・実験で確定済み)

ジョブ f2836771 のチャンク1(元音声 part_000.m4a の 300〜600 秒区間)が、VPS・ローカルの両環境で **`gpt-4o-transcribe-diarize` に対して再現性 100% で HTTP 500** を返す。OpenAI のステータスページに障害情報は無い。切り分け実験の結果(2026-07-13 実施):

| 入力 | モデル / 設定 | 結果 |
| --- | --- | --- |
| 300秒 (300-600s) | diarize, temp=0 | **500**(約4分後。VPS でも6回以上再現) |
| 150秒 (300-450s) | diarize, temp=0 | **500**(約2分後) |
| 150秒 (300-450s) | diarize, temp=0.2 | **500**(temperature では回避不可) |
| 75秒 (300-375s) | diarize, temp=0 | 200(ただし出力が繰り返し気味に劣化) |
| 150秒 (300-450s) | `gpt-4o-transcribe`(非diarize), json | **200(9秒)**、テキスト正常 |
| 150秒 (300-450s) | `whisper-1`, verbose_json | **200(11秒)**、タイムスタンプ付き72セグメント |

結論: この区間の音声内容(相槌・発話の重なりが多い)で diarize モデルが生成ループに陥り、サーバー内部で失敗して 500 を返している。**リトライやバックオフでは解決しない**ため、チャンク単位のフォールバック機構を実装する。

## タスク1: 5xx 判定情報をエラーに載せる

対象: `worker/src/transcribe.ts`

- `OpenAITranscriptionError` に `status?: number` を追加し、throw 時に `extractOpenAIStatus(error)` の値を渡す。エラーコード体系(`errorCode` の値)は変更しない。
- これにより processor 側で「5xx を使い果たして失敗した」ことを判別できるようにする。

## タスク2: チャンク単位のフォールバック機構

対象: `worker/src/processor.ts`(チャンクループ、214行付近)、`worker/src/ffmpeg.ts`(分割の再利用)

チャンクの転写が **5xx リトライを使い果たして失敗**した場合(タスク1の `status >= 500`)、ジョブを失敗させる前に以下の順で自動フォールバックする:

### 第1段: サブチャンク分割で diarize を維持

1. 失敗したチャンクの WAV を、さらに `DIARIZE_FALLBACK_SUBCHUNK_SECONDS`(新設 env、デフォルト **75**)秒のサブチャンクに ffmpeg で再分割する(既存の `splitAudioIntoChunks` を chunkSeconds 指定で再利用。出力先はジョブ一時ディレクトリ配下の `fallback/` 等)。
2. 各サブチャンクを従来と同じ diarize モデル・パラメータで転写する(通常のリトライ分類が適用される)。`chunkStartSec` はサブチャンクのオフセットを加算する。
3. **known_speaker_references はフォールバック経路では送らない**(問題を単純化するため。話者ラベルは新規話者の通常割当てに任せる)。
4. 全サブチャンクのセグメントを結合し、`chunkIndex` は**元のチャンク番号のまま**、`segmentIndex` は結合後に 0 から連番で振り直す(upsert キー `job_id,chunk_index,segment_index` の一意性を保つため。ここが最重要)。
5. ログ: `[worker] chunk N failed with 5xx; falling back to Ms sub-chunks`

### 第2段: whisper-1 で最低限の転写を確保

サブチャンクも 5xx リトライを使い果たした場合、**そのサブチャンクのみ** `whisper-1` + `response_format: "verbose_json"` で転写する:

- whisper-1 は prompt が使えるので、既存の `buildTranscriptionPrompt()` を渡してよい。
- verbose_json の `segments`(start/end/text)を既存の `normalizeSegment` 経路に流す。話者情報は無いので、新規話者として通常のラベル割当て(`assignDisplayLabels`)に任せる。
- ログ: `[worker] sub-chunk fell back to whisper-1 (no diarization); speaker labels need manual review`
- whisper-1 も失敗した場合のみ、従来どおりエラーを伝播してジョブを再キューさせる。

### 設定

- `DIARIZE_FALLBACK_SUBCHUNK_SECONDS=75` を `config.ts` / `worker/.env.example` / `worker/README.md` に追加。
- フォールバックの有効/無効フラグは作らない(常時有効。500 が出なければ発動しないため無害)。

## タスク3: 話者リファレンスの長さ上限バグ修正

対象: `worker/src/speaker-references.ts`(リファレンス候補の長さ決定箇所)

実ログで、レジューム時に再構築したリファレンスがちょうど 10.0 秒になり、OpenAI に拒否された:

```txt
[worker] added known speaker reference S2->A from 89.172s-99.172s
400 Known speaker references has duration {duration_s} seconds, but must be between 1.2 and 10.0 seconds
```

API の許容範囲は 1.2〜10.0 秒だが境界値で弾かれるため、生成するクリップ長を **1.3〜9.5 秒にクランプ**する。既存のフォールバック(リファレンス無しで再試行+以降無効化)は正しく動いているので変更しない。

## 変更してはいけないもの

- `transcription_segments` / `transcription_jobs` のスキーマ
- `job-errors.ts` のエラーコード体系(DB に入る `error_code` の値を増やさない)
- upsert の `onConflict` キー
- 正常系(500 が出ない場合)の処理経路・リクエスト内容

## 受け入れ条件・検証

1. `cd worker && npx tsc --noEmit` が通る。
2. **実ジョブでの通し確認(これが本命):** ジョブ f2836771-0107-4b4e-8462-59e5feff839e を再実行し、チャンク1がフォールバック経由で保存され、ジョブが `completed` になること。ログに第1段(必要なら第2段)の発動が記録されること。
3. `select chunk_index, count(*), min(segment_index), max(segment_index) from transcription_segments where job_id='f2836771-0107-4b4e-8462-59e5feff839e' group by 1 order by 1;` で chunk_index=1 の segment_index が 0 からの連番で重複しないこと。
4. 正常な音源のジョブでフォールバックが発動せず、従来と同じ結果になること(退行確認)。
5. リファレンスクリップ長: レジューム・通常処理の両方で、生成されるリファレンスが 9.5 秒以下になること(ログの `added known speaker reference ... from Xs-Ys` で確認)。
