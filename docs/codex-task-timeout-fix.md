# 実装指示書: 文字起こしワーカーの "Request Timed Out" 対策

## 背景(必読)

このリポジトリは Next.js アプリ(`src/`)とは別に、Sakura VPS 上で動く文字起こしワーカーが `worker/` にある(Node.js/TypeScript)。ワーカーは Supabase からジョブを取得し、音声を ffmpeg で分割して OpenAI の `gpt-4o-transcribe-diarize` に送る。

**障害:** ジョブが "Request timed out." で失敗する。

**原因(調査済み・確定):**

- このメッセージは OpenAI Node SDK の `APIConnectionTimeoutError` のデフォルト文言。`worker/src/transcribe.ts` の `createOpenAIClient()`(66-72行)で設定するクライアントタイムアウトが発火している。
- タイムアウト値は env `OPENAI_TRANSCRIPTION_TIMEOUT_SECONDS`(`worker/src/config.ts` 42-46行)。**`worker/.env` に未設定のためデフォルト 1200 秒(20分)**。
- チャンクは `AUDIO_CHUNK_SECONDS=600`(10分)、ffmpeg 出力はモノラル 16kHz PCM WAV(`worker/src/ffmpeg.ts` 40-46行)で **1チャンク約19MB**。diarize モデルの処理時間 + VPS からのアップロードで 20 分を超えることがある。
- タイムアウト時のリトライは 1 回のみ・固定 5 秒待機(`worker/src/transcribe.ts` の `classifyOpenAITranscriptionError`、233-243行)で、同条件再送のため再失敗しやすい。

## 実施タスク

### タスク1: 設定変更

`worker/.env` に追記・変更(このファイルは gitignore 済み。コミットしない):

```dotenv
AUDIO_CHUNK_SECONDS=300
OPENAI_TRANSCRIPTION_TIMEOUT_SECONDS=1800
```

あわせて `worker/.env.example` の両変数の値・コメントを上記推奨値に更新し、`worker/README.md` のタイムアウト説明(72-82行付近)も推奨値 300 / 1800 に合わせて更新する。

### タスク2: タイムアウトリトライの強化

`worker/src/transcribe.ts` の `classifyOpenAITranscriptionError` 内、`APIConnectionTimeoutError` / `"request timed out"` の分岐(233-243行)を変更:

- `maxAttempts: 2` → `3`
- `delayMs: () => 5_000` → `delayMs: (attempt) => attempt * 15_000`(15秒、30秒のバックオフ)

### タスク3: チャンクごとの計測ログ

`worker/src/transcribe.ts` の `createTranscriptionWithRetry` 内、`openai.audio.transcriptions.create()` 呼び出し(156-158行)の前後で `Date.now()` により経過時間を計測し:

- 成功時: `[worker] chunk ${chunkIndex} transcribed in ${seconds}s (${bytes} bytes)` を `console.log`
- 失敗時: 既存の `console.warn`(170-172行)のメッセージに経過秒数を追加

チャンクサイズは `options.chunk.bytes`(`AudioChunk` 型に既存フィールド)を使う。目的は、再発時に「アップロードが遅い/処理が遅い」を切り分けられるようにすること。

### タスク4: 25MB 超チャンクの事前チェック

`worker/src/processor.ts` のチャンク処理ループ(214行付近、`transcribeChunkWithOptionalReferences` 呼び出しの前)で、`chunk.bytes` が 25MB(OpenAI のファイル上限、`25 * 1024 * 1024`)を超える場合は API を呼ばずに `FinalJobFailure`(同ファイル 52行に定義済み)を throw する。エラーメッセージには「AUDIO_CHUNK_SECONDS を下げてください」という対処方法を含めること。既存のエラーコード体系(`job-errors.ts`)は変更しない。

## 変更してはいけないもの

- ffmpeg の出力フォーマット(WAV のまま)
- ジョブテーブルのスキーマ、`job-errors.ts` のエラーコード体系
- Next.js 側のコード(本障害はワーカー起点で Vercel は無関係)
- `worker/.env` の秘密情報をコミットしないこと

## 受け入れ条件・検証

1. `cd worker && npx tsc --noEmit` が通る(TypeScript strict)。
2. ワーカーをローカル起動し(`worker/README.md` 参照)、テスト音源で 1 ジョブ完走:
   - チャンクが 300 秒単位で分割される
   - 各チャンクの経過時間・バイト数がログに出る
   - ジョブが `completed` になる
3. `OPENAI_TRANSCRIPTION_TIMEOUT_SECONDS=1` で一時起動し、`openai_timeout` として 15s/30s バックオフで最大 3 回試行後に失敗記録されることをログで確認(確認後に値を戻す)。
