# 設計書: diarize 500 フォールバック + 話者リファレンス長修正

仕様書 `docs/codex-task-diarize-500-fallback.md` を現行コードに落とし込んだ設計。
仕様書の背景・実験結果・受け入れ条件はそのまま有効。本書はコード構造と、
仕様書が暗黙にしていた設計判断を確定させる。

## 設計判断（仕様書からの差分・確定事項）

| # | 論点 | 判断 | 理由 |
|---|---|---|---|
| D1 | フォールバック発動条件 | `status >= 500` **に加えて `errorCode === "openai_timeout"` も含める** | 2026-07-13 の実ログで、同一コンテンツバグが「300秒ハング→Request timed out」として顕在化した（attempt 1 は timeout で失敗し attempt を1回浪費）。真の一時障害だった場合もサブチャンクが普通に成功するだけで無害。 |
| D2 | リファレンス長上限 | `MAX_REFERENCE_SEC = 9.5`（仕様書どおり。working tree の `9.9` は `9.5` に変更する） | ffmpeg `-t` はフレーム境界で要求長を僅かに超え得るため、API 上限 10.0 に対し余裕を持たせる。`9.9` では超過リスクが残る。 |
| D3 | フォールバックで処理したチャンクからの話者リファレンス採取 | **行わない**（`addSpeakerReferencesFromChunk` をスキップ） | フォールバック経路の話者ラベルは品質保証がない（第2段は話者情報なし）。汚れたリファレンスを後続チャンクに伝播させない。 |
| D4 | 実装の置き場所 | フォールバック本体は新規 `worker/src/diarize-fallback.ts` | processor.ts は既に780行超。チャンクループからは1関数呼び出しにする。 |
| D5 | whisper-1 セグメントの話者ラベル | `speaker` が無いのでそのまま `"unknown"` になるのを許容し、`assignDisplayLabels` には流すが特別扱いしない | スキーマ・エラーコード体系を変えないという仕様書の制約に従う。ログで手動レビュー要と明示する。 |

## タスク1: OpenAITranscriptionError に status を載せる

対象: `worker/src/transcribe.ts`

```ts
export class OpenAITranscriptionError extends Error {
  readonly errorCode: OpenAITranscriptionErrorCode;
  readonly status: number | null;          // 追加

  constructor(message, options: { cause; errorCode; status?: number | null }) {
    ...
    this.status = options.status ?? null;
  }
}
```

- `createTranscriptionWithRetry` の catch（transcribe.ts:170-175）で
  `status: extractOpenAIStatus(error)` を渡す。
- transcribeChunk 冒頭の「segments 欠落」エラー（transcribe.ts:84-90）は
  `status` なし（null）でよい。
- `errorCode` の値は変更しない（DB の `error_code` 体系維持）。

判定ヘルパを export する:

```ts
export function isDiarizeContentFailure(error: unknown): boolean {
  return (
    error instanceof OpenAITranscriptionError &&
    ((error.status !== null && error.status >= 500) ||
      error.errorCode === "openai_timeout")   // D1
  );
}
```

## タスク2: チャンク単位フォールバック

### 呼び出し側（processor.ts チャンクループ、289行付近）

現在:

```ts
const transcribed = await transcribeChunkWithOptionalReferences({...})
  .catch((error) => { ...log...; throw error; });
```

変更後:

```ts
let transcribed: TranscribedChunk;
try {
  transcribed = await transcribeChunkWithOptionalReferences({...});
} catch (error) {
  if (!isDiarizeContentFailure(error)) {
    console.error(`[worker] transcription API failed for job ... chunk ...`);
    throw error;
  }
  console.warn(
    `[worker] chunk ${chunk.chunkIndex} failed with 5xx; falling back to ${config.diarizeFallbackSubchunkSeconds}s sub-chunks`,
  );
  transcribed = await transcribeChunkWithDiarizeFallback({
    openai,
    config,
    job,
    chunk,
    chunkStartSec,
    promptSuffix: termDictionaryPrompt,
    fallbackDir: `${downloaded.jobTmpDir}/fallback`,
    assertHealthy: () => heartbeat.assertHealthy(),
  });
  chunkUsedFallback = true;   // D3: このチャンクからのリファレンス採取を抑止
}
```

- 334行の `if (speakerReferencesEnabled && knownSpeakers.length < 4)` に
  `&& !chunkUsedFallback` を追加（D3）。
- それ以降（assignDisplayLabels → saveSegments →進捗更新）は無変更。
  フォールバックの結果は通常の `TranscribedChunk` として合流する。

### フォールバック本体（新規 worker/src/diarize-fallback.ts）

```ts
export async function transcribeChunkWithDiarizeFallback(options): Promise<TranscribedChunk>
```

処理:

1. `mkdir` で `<fallbackDir>/chunk_<N>/` を作成し、既存
   `splitAudioIntoChunks`（ffmpeg.ts:14）で失敗チャンクの WAV を
   `config.diarizeFallbackSubchunkSeconds`（デフォルト75秒）に再分割する。
   `jobId` には `"${job.id}_fb${chunk.chunkIndex}"` を渡してファイル名衝突を回避。
2. サブチャンク k ごとに:
   - `options.assertHealthy()` を呼んでからAPIへ（ハートビート/所有権の即時中断）。
   - 第1段: `transcribeChunk({ model: 通常と同じ diarize モデル, chunk: subChunk,
     chunkStartSec: chunkStartSec + k * subchunkSeconds, knownSpeakers: undefined })`。
     通常のリトライ分類がそのまま適用される。
   - 第1段も `isDiarizeContentFailure` で失敗した場合のみ第2段:
     `transcribeChunkWithWhisper({ ..., promptSuffix })`（下記）。
     ログ: `[worker] sub-chunk fell back to whisper-1 (no diarization); speaker labels need manual review`
   - whisper も失敗したらそのエラーを throw（従来どおり attempt 消費 → requeue）。
3. 結合: 全サブチャンクのセグメントを時刻順に連結し、
   - `chunkIndex` は**元のチャンク番号に付け替える**
   - `segmentIndex` は**結合後に 0 から連番で振り直す**
   （upsert キー `job_id, chunk_index, segment_index` の一意性維持。仕様書の最重要点）
   - `skippedSegmentsCount` / `sourceSegmentsCount` は合算
4. 一時ファイルはジョブ一時ディレクトリ配下なので、既存のジョブ終了時
   クリーンアップに任せる（個別削除は不要）。

### whisper-1 経路（transcribe.ts に追加）

`createTranscriptionWithRetry` の `useDiarization`（現在 131 行で `true` 固定）を
引数化し、次を追加する:

```ts
export async function transcribeChunkWithWhisper(options: {
  openai; chunk; chunkStartSec; promptSuffix?;
}): Promise<TranscribedChunk>
```

- リクエスト: `model: "whisper-1"`, `response_format: "verbose_json"`,
  `prompt: buildTranscriptionPrompt(promptSuffix)`（whisper は prompt 可）,
  `language / temperature` は既存定数。`known_speaker_*` は付けない。
  `chunking_strategy` は diarize 用パラメータなので付けない。
- verbose_json の `segments`(start/end/text) を既存 `normalizeSegment` に流す。
  `speaker` が無いので speakerLabel は `"unknown"` になる（D5）。
- リトライ分類は既存 `classifyOpenAITranscriptionError` を共用。

### 設定（config.ts）

```ts
diarizeFallbackSubchunkSeconds: parsePositiveInteger(
  process.env.DIARIZE_FALLBACK_SUBCHUNK_SECONDS,
  75,
  "DIARIZE_FALLBACK_SUBCHUNK_SECONDS",
),
```

`worker/.env.example` と `worker/README.md` に追記。有効/無効フラグは作らない
（仕様書どおり常時有効）。

### 時間予算の確認

最悪ケース（300秒チャンク→75秒×4サブチャンク、各5回リトライ＋whisper）でも、
既存のジョブロックハートビート（30〜60秒間隔）が生きているため、
ロックタイムアウト（30分）による横取りは起きない。サブチャンク間で
`assertHealthy()` を呼ぶことで、所有権喪失時は速やかに中断する。

## タスク3: 話者リファレンス長

対象: `worker/src/speaker-references.ts:8`

```ts
const MAX_REFERENCE_SEC = 9.5;   // API上限10.0に対しffmpeg -t の超過分の余裕を確保
```

- working tree にある `9.9` への未コミット編集はこの `9.5` に置き換える（D2）。
- `MIN_REFERENCE_SEC = 3` は API 下限 1.2 を十分上回るため変更不要。
- クランプは `selectReferenceCandidates` 内（55行・63行）で既に適用されて
  いるため、定数変更のみで通常処理・レジューム再構築の両経路に効く。
- 既存のフォールバック（400時にリファレンス無しで再試行＋以降無効化）は
  正しく動いているので変更しない。

## 変更しないもの（仕様書の制約の再確認）

- `transcription_segments` / `transcription_jobs` スキーマ
- `error_code` の値集合（`openai_error` / `openai_timeout` 等はそのまま）
- upsert の `onConflict` キー
- 正常系（500が出ない場合）のリクエスト内容・処理経路
  （タスク1の status 追加はエラーオブジェクトのみで、リクエストに影響しない）

## 検証計画

1. `cd worker && npx tsc --noEmit` および `npm test`。
2. **本命**: ジョブ f2836771 を requeue（`status='queued', attempt_count=0`）し、
   chunk 1 が第1段（必要なら第2段）経由で保存されてジョブが `completed` に
   なること。ログで発動メッセージを確認。
3. `select chunk_index, count(*), min(segment_index), max(segment_index)
   from transcription_segments where job_id='f2836771-...' group by 1 order by 1;`
   で chunk_index=1 の segment_index が0からの連番・重複なしであること。
4. 退行確認: 正常な音源のジョブでフォールバック非発動・結果不変。
5. リファレンス: ログの `added known speaker reference ... from Xs-Ys` が
   常に 9.5 秒以下であること。400 が出ないこと。
