# 実装指示書: 話者識別精度の改善(パン位置活用 + 既知話者リファレンス)

対象リポジトリ: interview-transcriber(このリポジトリのルートで作業すること)
作業前に `AGENTS.md` を必ず読み、その制約(TypeScript strict、シンプルで堅牢なコード、workerロジックをNext.jsに混ぜない、環境変数の文書化)に従うこと。

---

## 1. 背景と目的

本アプリは約2時間のインタビュー音源を `worker/`(Sakura VPS上のNode/TypeScriptワーカー)で処理する。現状のパイプライン:

1. `worker/src/processor.ts` の `processJob()`(75〜266行付近)が司令塔。ダウンロード → ffprobe → 分割 → チャンク毎に文字起こし → セグメント保存
2. `worker/src/ffmpeg.ts` の `splitAudioIntoChunks()`(14〜58行)が ffmpeg を `-vn -map 0:a:0 -ac 1 -ar 16000 -c:a pcm_s16le -f segment -segment_time 600 -reset_timestamps 1` で実行 → **モノラル16kHz WAV・10分チャンク・オーバーラップなし**
3. `worker/src/transcribe.ts`(117〜163行)が OpenAI `audio.transcriptions.create` を model=`gpt-4o-transcribe-diarize`、language="ja"、response_format="diarized_json"、temperature=0、chunking_strategy="auto" で呼ぶ。レスポンスは `{ segments: [{ speaker, start, end, text }] }`。`normalizeSegment`(275〜297行)が `chunkStartSec` を足してチャンク相対→絶対時刻に変換
4. `worker/src/segments.ts` の `saveSegments()`(19〜82行)が `transcription_segments` に upsert(onConflict: `job_id,chunk_index,segment_index`)。`speaker_label` はAPIが返した文字列をそのまま保存

**問題: チャンク間で話者ラベルを照合する仕組みが一切ない。** 各10分チャンクは独立に話者識別されるため、チャンク0の "A" とチャンク1の "A" が同一人物である保証がなく、2時間で12回の独立識別が無検証で連結される。これが話者識別精度の最大の問題。

**前提条件(発注者確認済み)**: 対象の録音は**話者ごとに別チャンネル**(ピンマイク等でL/R分離。ミキサー経由で2〜4名が異なるパン位置に定位するケースあり)。話者数は通常2〜4名。

**解決方針(2段構え)**:

- **Phase 1(本命)**: APIにはモノラルを送り続けたまま、**元のステレオ音源から各セグメントのL/Rエネルギー比(パン)を計算し、全チャンク横断で話者ラベルを振り直す**。パンは物理量なのでチャンク間一貫性の問題を同時に解決する。
  - 注意: APIへの入力をステレオにする案は不採用。diarizeモデルはパンを識別に使わず、10分のステレオ16kHz PCMは約38MBでOpenAIの25MBファイル制限を超えるため。
- **Phase 2(フォールバック)**: OpenAI APIの `known_speaker_names[]` / `known_speaker_references[]`(2〜10秒の参照音声data URL、最大4名)をチャンク2以降に渡し、モノラル音源・ステレオ分離が弱い音源でもラベルをチャンク間で安定させる。
  - SDKサポート確認済み: `worker/node_modules/openai/resources/audio/transcriptions.d.ts` の547行・555行に型付きパラメータが存在(openai ^6.36.0)。extra_body等のハックは不要。
  - 参照が与えられた場合、レスポンスの `speaker` は一致すれば与えた名前、新規話者なら "A","B",... の連番大文字を返す。

Phase 1 → Phase 2 の順で実装すること。各Phase完了時点でビルドが通り単独でデプロイ可能であること。

---

## 2. Phase 1: パンベース話者リラベリング

### 2.1 新規ファイル `worker/src/pan.ts`

既存の `worker/src/ffmpeg.ts` のspawn・タイムアウト・エラー処理スタイルを踏襲すること。しきい値はモジュール定数として定義(環境変数にしない)。

```ts
export type PanEnvelope = {
  windowSec: number;   // 0.25 固定
  left: Float64Array;  // 窓ごとのLチャンネル二乗和エネルギー
  right: Float64Array; // 窓ごとのRチャンネル二乗和エネルギー
};

export async function extractPanEnvelope(options: {
  ffmpegPath: string;
  inputPath: string;   // 元のアップロード音源(ダウンロード済みローカルパス)
  timeoutMs: number;
}): Promise<PanEnvelope>
```

実装: `spawn(ffmpegPath, ["-hide_banner","-loglevel","error","-i",input,"-vn","-map","0:a:0","-ac","2","-ar","8000","-c:a","pcm_s16le","-f","s16le","-"])` でstdoutにrawストリーム出力させ、逐次読み取りながらインターリーブされたint16のL/Rペアを0.25秒窓(8000Hz × 0.25s = 2000フレーム/窓)に集計する。
- **Bufferチャンク境界でフレーム(4バイト=L2+R2)が分断される**ので、端数バイト(最大3バイト)を次チャンクに持ち越すこと
- PCM全体(2時間で約230MB)は絶対にメモリ保持しない。窓集計のみ(2時間で約29,000窓 × Float64Array 2本 ≈ 460KB)
- 非ゼロexit・タイムアウト時はSIGKILLしてreject

```ts
export type SegmentPan = { pan: number; energyPerSec: number };
export function computeSegmentPan(env: PanEnvelope, startSec: number, endSec: number): SegmentPan
```
`[startSec, endSec)` の窓エネルギーを合算し `pan = (√R − √L) / (√R + √L)` ∈ [-1, 1]。両チャンネルほぼゼロなら `{ pan: 0, energyPerSec: 0 }` を返す(ゼロ除算ガード)。

```ts
export function clusterPans(
  items: Array<{ pan: number; weightSec: number }>,
  k: number,
): { centers: number[]; separated: boolean }
```
継続時間重み付き1次元k-means。初期中心は分位点で決定的に配置、最大50反復。
**ステレオ分離ゲート** — 以下を両方満たすとき `separated: true`:
- 隣接クラスタ中心の最小間隔 ≥ `MIN_CENTER_GAP = 0.25`
- 各クラスタの重み合計 ≥ 全体の `MIN_CLUSTER_WEIGHT_RATIO = 0.1`

デュアルモノ・センターミックス録音は全パンが0付近に集まり中心が収束してゲート不合格になる(これが意図した安全弁)。

```ts
export function relabelSegmentsByPan(options: {
  segments: NormalizedSegment[];       // 全チャンク分・絶対時刻
  envelope: PanEnvelope;
  expectedSpeakerCount: number | null;
}): { segments: NormalizedSegment[]; applied: boolean; summary: string }
```
アルゴリズム:
1. 各セグメントの `SegmentPan` を計算。**クラスタリング入力**は「継続 ≥ 0.8秒 かつ energyPerSec が全セグメントの下位パーセンタイル床以上」のもの(呼吸音・無音アーティファクトを除外)
2. `k = clamp(expectedSpeakerCount ?? 2, 2, 4)`
3. `clusterPans` 実行。`separated: false` なら **無変更で** `{ applied: false }` を返す
4. 割当: 各セグメントを最近傍中心へ。「**曖昧**」= 第2近傍中心とのマージンが局所中心間距離の35%未満、またはステップ1のフィルタ落ち(短い相槌・クロストークが該当)
5. 曖昧セグメントの解決: 同一 `chunkIndex` 内で同じAPIラベルを持つ確信セグメント群の多数決クラスタを継承する(重なり発話ではAPIのチャンク内識別を活かす)。多数決不能なら最近傍中心のまま
6. 最終ラベル: クラスタを確信セグメントの初出時刻順に並べ "A","B","C","D" と命名(既存のリネームUI `transcription_job_speaker_names`・セグメント上書き `transcription_segment_edits` と同じ名前空間なのでDB変更不要)
7. `summary`: クラスタ中心、クラスタ別発話時間、変更セグメント数、曖昧数を1行文字列で返す(ログ用)

### 2.2 変更 `worker/src/processor.ts`

- ffprobe完了後(102〜111行付近): `audioInfo.streams` から音声ストリームの `channels === 2`(v1では厳密に2。3ch以上はログして対象外)かつ `config.panRelabelEnabled` のとき、`extractPanEnvelope(downloaded.localPath)` を実行。**try/catchで包み、失敗時は warn ログして envelope = null**(パンは強化機能。ジョブを失敗させてはならない)。元音源は `jobTmpDir` にジョブ終了まで残っている(cleanupは finally、261行付近)ので参照可能
- チャンクループ(167行〜)内: 各チャンクの正規化済みセグメントをジョブレベルの `allSegments: NormalizedSegment[]` に蓄積。**既存のチャンク毎incremental save(進捗UX)はそのまま維持する**
- ループ後・`markJobCompleted`(233行付近)の前: envelope があれば `relabelSegmentsByPan` を実行。`applied` なら変更のあったセグメントを `chunkIndex` ごとにまとめて既存 `saveSegments` で再保存(upsertで冪等。segment idは保持されるため `transcription_segment_edits` のFK参照は壊れない)。全体をtry/catchで包み、失敗時はwarnしてAPIラベルのまま完了。summaryをログ出力
- ワーカーリトライ時は既存の `clearJobSegments`(161行)が全消しするので追加対応不要

### 2.3 変更 `worker/src/supabase.ts`

`TranscriptionJob` 型(4〜25行)に `expected_speaker_count: number | null;` を追加。claim RPC(`supabase/migrations/0009_*.sql`)は `setof transcription_jobs` を返すため値は既にワーカーに届いており、クエリ変更は不要。

### 2.4 変更 `worker/src/config.ts`

`panRelabelEnabled: boolean` を追加。env `SPEAKER_PAN_RELABEL_ENABLED`、デフォルト `true`、`"false"` で無効化。既存パーサ群のスタイルに合わせた `parseBoolean(value, fallback, name)` ヘルパーを追加すること。`worker/.env.example` にも追記。

### 2.5 変更 `worker/src/projects.ts`(283〜290行付近)

プロジェクト音源のパート分割が現在 `-ac 1`(モノラル64k AAC)でステレオを破壊している。ソースが2chの場合は `-ac 2 -b:a 96k` に切り替え(それ以外は現状維持)、パート化ジョブでもPhase 1が機能するようにする。ソースのチャンネル数は同フロー内の既存ffprobe結果を使う。

### 2.6 変更 `worker/README.md`

`SPEAKER_PAN_RELABEL_ENABLED` を環境変数一覧に追加し、「話者識別(Speaker identity)」節を新設してパンリラベルの仕組み・分離ゲート・フォールバック挙動を簡潔に説明。

### 2.7 新規devスクリプト `worker/scripts/analyze-pan.ts`

`npx tsx scripts/analyze-pan.ts <audio-file>` で実行し、チャンネル数、包絡線統計、粗いパンヒストグラム、k=2..4 それぞれのクラスタ中心と `separated` 判定を表示する。API呼び出しなしで実録音に対するしきい値検証を可能にするためのもの。

### 2.8 DB変更: なし

`speaker_label` カラムを再利用する。パン値・識別手法メタデータの保存はスコープ外(将来ログで不足が判明した場合のみ)。

---

## 3. Phase 2: known_speaker_references によるチャンク間一貫性

### 3.1 新規ファイル `worker/src/speaker-references.ts`

```ts
export type KnownSpeaker = {
  name: string;          // 内部名 "S1".."S4" — 意図的に大文字A-Dと分離した名前空間
  displayLabel: string;  // DBに保存する "A".."D"
  dataUrl: string;       // "data:audio/wav;base64,..."
};

export function selectReferenceCandidates(
  chunkSegments: NormalizedSegment[],
  knownDisplayLabels: Set<string>,
  segmentPans?: Map<number, SegmentPan>,  // Phase 1のパンデータがあれば渡す
): Array<{ apiLabel: string; startInChunkSec: number; endInChunkSec: number }>
```
チャンク内の**新出**話者ラベルごとに参照候補を1つ選ぶ:
- 継続3〜10秒(10秒超は先頭10秒に切り詰め)
- **他話者セグメントと時間重複がない**こと
- パンデータがあれば |pan| が大きいもの優先(クリーンな単一チャンネル発話)
- 同条件なら長いもの優先
- 適格候補がなければその話者は今回スキップ(次チャンクで再挑戦)
- 既知話者は合計4名でハードキャップ

**注意**: `NormalizedSegment` の時刻は絶対時刻(`chunkStartSec` 加算済み、`transcribe.ts:292-293`)。切り出し位置は `chunkStartSec` を引いてチャンク相対に変換すること。

```ts
export async function buildSpeakerReferenceDataUrl(options: {
  ffmpegPath: string; chunkPath: string;
  startSec: number; durationSec: number; timeoutMs: number; outDir: string;
}): Promise<string>
```
`ffmpeg -ss <start> -t <dur> -i chunk.wav -c:a pcm_s16le ref.wav` で切り出し → ファイルを読んで `"data:audio/wav;base64," + buf.toString("base64")`。サイズ目安: 10秒モノラル16kHz s16 ≈ 320KB → base64約427KB、4名で約1.7MB/リクエスト(許容範囲)。

### 3.2 変更 `worker/src/transcribe.ts`

- `transcribeChunk` / `createTranscriptionWithRetry` にオプション `knownSpeakers?: Array<{ name: string; dataUrl: string }>` を追加。非空なら `request.known_speaker_names` / `request.known_speaker_references` にセット(SDK型付き、キャスト不要)
- `normalizeSegment` にラベルマッピングを追加: レスポンス `speaker` が内部名("S1"…)に一致すれば対応する `displayLabel` へ変換。素の大文字1文字は**新規話者**を意味するので、呼び出し側(processor)が次の空き表示ラベルを割り当てる。内部名をA-Dと分けているのは「返ってきた 'A' が一致なのか新規連番なのか」の曖昧さを排除するため
- エラー分類 `classifyOpenAITranscriptionError`(169〜240行)に `invalid_speaker_reference` を追加: メッセージがspeaker reference起因を示す400エラー。transcribe層では非リトライ扱いにするが、**processor側で捕捉して「そのチャンクを参照なしで1回だけ再試行し、以降のチャンクでは参照機能を無効化(warnログ)」**する。参照機能が原因でジョブが失敗することは絶対にあってはならない

### 3.3 変更 `worker/src/processor.ts`

チャンクループの状態として `knownSpeakers: KnownSpeaker[]` と表示ラベルアロケータを保持。各チャンクのセグメント正規化後に `selectReferenceCandidates` + `buildSpeakerReferenceDataUrl` で新出話者の参照を追加(ソフトキャップ = `expected_speaker_count`、ハードキャップ4)し、**次チャンク以降**のリクエストに渡す。チャンク0は参照なしで送る。

### 3.4 変更 `worker/src/config.ts` / `worker/README.md` / `worker/.env.example`

`speakerReferencesEnabled: boolean`(env `SPEAKER_REFERENCES_ENABLED`、デフォルト `true`)を追加し文書化。

---

## 4. エラーハンドリング要件(必須)

| 障害 | 要求挙動 |
|---|---|
| 包絡線抽出のffmpeg失敗/タイムアウト | warnしてパン処理をスキップ。APIラベル維持でジョブは完了 |
| 分離ゲート不合格(モノ/デュアルモノ/センターミックス) | `applied: false`、理由をログ。無変更 |
| リラベル・再保存中の例外 | warn。チャンク毎に保存済みのAPIラベルが残りジョブは完了 |
| 参照クリップ切り出し失敗 | その話者は今回スキップ、次チャンクで再挑戦 |
| APIが参照を400拒否 | 当該チャンクを参照なしで再試行、以降のチャンクは参照無効化 |

原則: **Phase 1・Phase 2はいずれも「強化機能」であり、これらの障害で従来なら成功していたジョブが失敗してはならない。**

---

## 5. 検証手順(Definition of Done)

1. **ビルド/型チェック**: `cd worker && npm run build` が通ること(TypeScript strict)
2. **合成ステレオ素材の作成**(macOS `say` で日本語2声):
   ```bash
   say -v Kyoko -o /tmp/va.aiff "こんにちは。本日はインタビューよろしくお願いします。最初の質問です。"
   say -v Otoya -o /tmp/vb.aiff "はい、こちらこそよろしくお願いします。ええと、そうですね。"
   ffmpeg -stream_loop 20 -i /tmp/va.aiff -stream_loop 20 -i /tmp/vb.aiff -filter_complex \
     "[0:a]aformat=sample_rates=16000:channel_layouts=mono[a];\
      [1:a]aformat=sample_rates=16000:channel_layouts=mono,adelay=5000[b];\
      [a][b]join=inputs=2:channel_layout=stereo[out]" \
     -map "[out]" -t 180 /tmp/test_stereo.wav
   ```
3. **オフライン検証**: `npx tsx worker/scripts/analyze-pan.ts /tmp/test_stereo.wav` → 中心が±0.9付近の2クラスタ・`separated: true`。モノラル/デュアルモノ素材ではゲート不合格になること
4. **クロスチャンクE2E**: `worker/.env` で `AUDIO_CHUNK_SECONDS=60` にし、3分素材(=3チャンク)を話者数2でWebアプリからアップロード。確認事項: (a) ログに包絡線抽出と "pan relabel applied"+summary が出る (b) `transcription_segments` でKyoko声のセグメントが全 `chunk_index` で同一ラベル、Otoya声がもう一方のラベルになる (c) トランスクリプト画面の話者グルーピングが正しい
5. **リグレッション**: モノラル素材でゲートスキップされ従来と同一挙動になること。`SPEAKER_PAN_RELABEL_ENABLED=false` で機能全体が無効化されること
6. **Phase 2 E2E**: 同素材を `-ac 1` でモノラル化してアップロード → チャンク1以降のリクエストに既知話者が付与され(ログで名前を確認)、ラベルがチャンク間で安定すること
7. **環境変数の文書化**: 新規envが `worker/README.md` と `worker/.env.example` に記載されていること。シークレットのコミットがないこと
