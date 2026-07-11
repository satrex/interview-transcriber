# 実装指示書: 相槌による会話分断・語尾かぶり混入の対策

対象リポジトリ: interview-transcriber(このリポジトリのルートで作業すること)
作業前に `AGENTS.md` を必ず読み、その制約(TypeScript strict、シンプルで堅牢なコード、workerロジックをNext.jsに混ぜない、環境変数の文書化)に従うこと。
前提として `docs/speaker-diarization-improvement.md`(パンベースリラベリング/known_speaker_references)は実装済みであり、本書はその上に積む。

---

## 1. 背景と問題定義

相槌(「うん」「はい」「なるほど」等)が原因で、編集者の工数が2つの形で発生している。

### 問題① 会話の分断(fragmentation)

話者Aの長い発話の途中に話者Bの相槌が挟まると、`src/lib/transcript.ts` の `buildTranscriptBlocks()`(31〜60行)は**連続する同一話者セグメントしか結合しない**ため、ブロックが A → B(うん)→ A と3つに割れる。雑誌原稿ではAの発話は一続きであるべきで、編集者が手作業で繋ぎ直している。

```
[12:03] **田中**：それでですね、この作品を作ったきっかけというのが
[12:08] **佐藤**：うん
[12:09] **田中**：学生時代に読んだ小説でして…
```

### 問題② 語尾かぶりによるテキスト混入(tail overlap)

Bの相槌がAの**語尾に重なる**と、diarizeモデル(`gpt-4o-transcribe-diarize`)が重なり発話を分離できず、**1セグメントに二人分のテキストが混ざる**(例: 「〜だと思うんですよね、**うんうん**」がAのセグメントとして返る)。話者ラベルの振り直しでは解決できず、テキスト自体の分離が必要。現状は編集者が全文を読みながら発見・分離しており、発見コストが特に高い。

### 利用できる資産

- **話者ごとに別チャンネル**(発注者確認済みの前提)。`worker/src/pan.ts` に 0.25秒窓のパン包絡線抽出(`extractPanEnvelope`)・クラスタリング(`clusterPans`)・セグメント単位のパン計算(`computeSegmentPan`)が実装済み。現状はセグメント単位のラベル振り直しにしか使っていないが、**セグメント内部の時系列**を見れば「語尾だけ別話者のエネルギーが乗っている」ことを物理量で検出できる。
- 相槌テキストの判定パターン `FILLER_PATTERNS` が `src/lib/speaker-analysis.ts`(27〜42行)に実装済み。
- セグメント編集基盤(`transcription_segment_edits`: `edited_text` / `edited_speaker_label` / `is_skipped`)と、セグメント単位の音声再生(`src/components/segment-audio-player.tsx`)が実装済み。

## 2. 解決方針(3段構え)

| Phase | 層 | 解決する問題 | コスト |
|---|---|---|---|
| A: 相槌の吸収表示 | フロントエンドのみ | ①分断 | 小。既存ジョブにも即効く |
| B: 語尾かぶり検出 | worker + DB + UI | ②の**発見コスト** | 中。パン資産の再利用 |
| C: チャンネル別再文字起こし | worker | ②の**分離作業そのもの** | 中。フラグで段階投入 |

A → B → C の順で実装すること。各Phase完了時点でビルドが通り単独でデプロイ可能であること。B・Cはステレオ分離ゲート合格(`relabelSegmentsByPan` が `applied: true`)が前提条件で、モノラル音源では自動的にスキップされる。Phase Aはモノラルでも効く。

---

## 3. Phase A: 相槌の吸収表示・エクスポート(フロントエンドのみ)

### 3.1 新規ファイル `src/lib/backchannel.ts`

`FILLER_PATTERNS` を `speaker-analysis.ts` からこのモジュールへ移動し(speaker-analysis側はimportに変更)、雑誌インタビューで頻出の相槌を追加する: `なるほど`、`そうですね`、`そうなんですね`、`ですよね`、`たしかに`、`へえ+`、`ほう+`、`ふ+ん+`。

```ts
export type BackchannelMode = "keep" | "inline" | "hide";

export function classifyBackchannels(
  segments: TranscriptSegment[],
  segmentEdits: SegmentEditMap,
): Set<string>  // 相槌と判定した segment id の集合
```

判定条件(**すべて**満たすこと。取りこぼしより誤判定を嫌う設計):

1. 継続時間 ≤ `BACKCHANNEL_MAX_DURATION_SEC = 2.0`
2. テキスト(句読点・空白除去後)≤ `BACKCHANNEL_MAX_CHARS = 8` 文字、かつ全トークンが相槌パターンに一致(`isFillerOnlyText` 相当のロジックを流用)
3. **サンドイッチ条件**: 直前・直後の(スキップされていない)セグメントが同一話者で、かつ本セグメントと別話者
4. 時間的連続性: `next.startSec − prev.endSec ≤ 15` 秒(話題の切れ目で偶然サンドイッチになるケースを除外)
5. そのセグメントに `editedText` または `speakerOverride` が付いていない(編集者が手を入れたものは対象外)

しきい値はモジュール定数(環境変数にしない)。

### 3.2 変更 `src/lib/transcript.ts`

`buildTranscriptBlocks(segments, speakerNames, options?)` に `options.backchannelIds?: Set<string>` と `options.backchannelMode?: BackchannelMode` を追加。

- `"hide"`: 相槌セグメントを読み飛ばす → 前後のAブロックが1ブロックに結合される(既存の連続結合ロジックがそのまま働く)
- `"inline"`: 読み飛ばして結合した上で、`TranscriptBlock` に `absorbedBackchannels: Array<{ speakerName: string; text: string; startSec: number }>` を持たせる(表示用)
- `"keep"` / options未指定: 完全に従来挙動(後方互換。既存呼び出し元は無変更で通ること)

### 3.3 変更 `src/components/transcript-markdown.tsx`

- ツールバーに表示モード切替(3択: 通常/相槌をインライン表示/相槌を隠す)を追加。デフォルトは `"inline"`。選択は `localStorage` に保存(DB不要)
- `"inline"` 時、吸収した相槌はブロック本文の末尾に淡色の小さな注記(例: `(佐藤: うん)`)で表示し、クリックで該当セグメントの編集UIへジャンプできること(誤判定の救済経路)
- プレビュー側のセグメント一覧では相槌判定セグメントに「相槌」チップを表示し、既存のスキップトグルをそのまま使えること
- Markdown/テキストのコピー・エクスポートは**そのとき選択中のモード**に従う。`"inline"` の場合エクスポートには相槌注記を含めない(hideと同じ出力)

### 3.4 変更 `src/lib/project-export.ts`(78行付近)

`buildTranscriptBlocks` 呼び出しに相槌分類を渡す。エクスポートオプションに `backchannelMode` を追加し、デフォルト `"hide"`(雑誌原稿用途では相槌は落とすのが基本)。

### 3.5 DB変更: なし

判定は表示時に決定的に再計算する。`is_skipped` への自動書き込みは行わない(非破壊。モデル出力やしきい値が変わっても巻き戻し不要)。

---

## 4. Phase B: パン時系列による語尾かぶり検出

### 4.1 新規関数 `worker/src/pan.ts` に追加

```ts
export type MixSuspect = {
  boundarySec: number;        // 混入が始まる推定絶対時刻
  intruderClusterIndex: number;
};

export function detectTailMix(options: {
  envelope: PanEnvelope;
  startSec: number;
  endSec: number;
  ownClusterIndex: number;
  centers: number[];
}): MixSuspect | null
```

アルゴリズム: セグメント区間の各窓(energy下位パーセンタイル床以上のもののみ)を最近傍クラスタに分類し、**セグメント末尾に連続する別クラスタ窓のラン**を探す。以下を両方満たすとき suspect:

- ランの長さ ≥ `MIN_MIX_RUN_SEC = 0.5`(2窓)
- ラン区間の総エネルギーがセグメント総エネルギーの ≥ `MIX_MIN_ENERGY_RATIO = 0.15`

先頭側のラン(発話頭かぶり)も同条件で検出し、`boundarySec` はラン開始時刻とする。しきい値はモジュール定数。`worker/scripts/analyze-pan.ts` にセグメント区間を与えて窓分類列を出力するモードを追加し、実録音でしきい値検証できるようにすること。

### 4.2 DB変更: migration `supabase/migrations/0025_segment_mix_suspects.sql`

```sql
alter table public.transcription_segments
  add column mix_suspect_boundary_sec numeric(12, 3),
  add column mix_suspect_speaker_label text;
```

両方nullable。null = 混入疑いなし。RLSポリシー変更は不要(既存の行単位ポリシーがカラムにも適用される)。

### 4.3 変更 `worker/src/processor.ts` / `worker/src/segments.ts`

- `relabelSegmentsByPan` が `applied: true` を返した後、各セグメントに `detectTailMix` を実行し、suspectなら再保存対象に含める(既存のリラベル後再保存フローに相乗り。`saveSegments` のupsertカラムに2列追加)
- `intruderClusterIndex` はリラベル時のクラスタ→表示ラベル対応で `mix_suspect_speaker_label` に変換する
- 全体を既存のリラベルtry/catchの内側に置く。検出失敗でジョブを失敗させてはならない

### 4.4 UI: `src/components/transcript-markdown.tsx` / `speaker-analysis-panel.tsx`

- `fetchAllSegments`(`src/lib/transcript-segments.ts`)のselectに2カラム追加し `TranscriptSegment` 型を拡張
- suspectセグメントに「⚠ 語尾かぶり疑い(混入話者: B / 0:12:08〜)」バッジを表示。既存のセグメント音声再生でその場で確認 → 既存の編集UI(`edited_text` で分離、または相槌部分を削除)で修正
- `SpeakerAnalysisPanel` に「語尾かぶり疑い n件」のサマリと、疑いセグメントへ順にジャンプできる一覧を追加(全文を読んで探す作業をなくすのが目的)

---

## 5. Phase C: 疑いセグメントのチャンネル別再文字起こし(自動分離)

Phase Bで検出したセグメントに限り、**元のステレオ音源から当該区間をチャンネル別に切り出して個別に再文字起こし**し、混ざったテキストを自動分離する。話者ごとに別チャンネルという前提を最大限使う本命策だが、API再呼び出しを伴うため**フラグで段階投入**する。

### 5.1 変更 `worker/src/config.ts` / `.env.example` / `README.md`

`mixResplitEnabled: boolean`(env `SPEAKER_MIX_RESPLIT_ENABLED`、**デフォルト `false`**)。Phase Bの検出精度を実運用で確認してから `true` に切り替える運用とし、READMEにその旨を明記。

### 5.2 新規ファイル `worker/src/mix-resplit.ts`

suspectセグメントごとに:

1. 元音源(ジョブ終了まで `jobTmpDir` に残っている)から `[startSec − 0.2, endSec + 0.2]` を切り出し、`pan=mono|c0=FL` / `pan=mono|c0=FR` フィルタでL/R各モノラルWAV(16kHz s16le)を生成。ffmpeg呼び出しは `ffmpeg.ts` のspawn・タイムアウト・エラー処理スタイルを踏襲
2. **主話者チャンネル**(リラベル時のクラスタ中心の符号で判定)を `gpt-4o-transcribe`(diarizeなし、language="ja"、temperature=0)で再文字起こし → 結果でセグメントの `text` を**上書き**(混入した相槌テキストが消える)
3. **混入側チャンネル**の `[boundarySec − 0.2, endSec + 0.2]` を同様に再文字起こし。結果が非空なら混入話者のセグメントとして**新規insert**(相槌とは限らず食い気味の返答の可能性があるため捨てない。相槌ならPhase Aが表示側で吸収する)
4. 処理済みセグメントは `mix_suspect_boundary_sec` をnullに更新(UIの⚠を消す)

コスト目安: suspect1件あたり数秒の音声 × 2チャンネル。2時間音源で数十件あっても合計数分ぶんであり無視できる。1ジョブあたりの上限 `MIX_RESPLIT_MAX_SEGMENTS = 100` を設け、超過分は検出フラグのみ残す(暴走ガード)。

### 5.3 セグメント挿入の整合性

- 新規セグメントは同じ `chunk_index`、`segment_index = そのチャンクの既存最大値 + 連番` でinsertする(upsert一意制約 `job_id,chunk_index,segment_index` と衝突しない)
- これにより `segment_index` 順と時刻順が一致しなくなるため、`fetchAllSegments`(`src/lib/transcript-segments.ts` 43〜54行)のorderを `start_sec → end_sec → chunk_index → segment_index` に変更する。既存データは時刻順とindex順が一致しているため表示順は変わらない(リグレッションなし)
- 既存セグメントのidは保持されるため `transcription_segment_edits` のFKは壊れない。ただし**編集者が既に `edited_text` を付けたセグメントは再分離の対象外**とすること(編集を上書きしない)

### 5.4 エラーハンドリング

切り出し失敗・API失敗・分類失敗はいずれもwarnログして当該セグメントをスキップ(⚠フラグが残るのでUIフォールバックが効く)。リトライは既存 `createTranscriptionWithRetry` を流用。**この機能が原因でジョブが失敗することは絶対にあってはならない。**

---

## 6. 検討して不採用にした案

- **全編チャンネル別文字起こし**(diarize廃止、L/Rを別々に全文転写して時刻でマージ): 重なり問題を根本解決するが、(a) マイクのかぶり(bleed)で相手の声が両チャンネルに薄く転写され重複テキストが大量発生、(b) API費用が約2倍、(c) パイプライン全面書き換え。疑い区間限定のPhase Cで同じ効果を1〜2%のコストで得られるため不採用。将来bleedゲート付きで再検討の余地はある
- **diarizeモデルへのprompt調整**で重なり分離を促す: 出力が非決定的で検証不能。不採用
- **相槌の `is_skipped` 自動書き込み**: 判定ロジック変更時に巻き戻せない。表示時の非破壊分類(Phase A)で同じUXを実現できるため不採用

---

## 7. エラーハンドリング要件(必須)

| 障害 | 要求挙動 |
|---|---|
| 相槌誤判定(Phase A) | 非破壊なのでデータ影響なし。インライン注記クリック→編集UIで個別に「相槌扱いしない」= `speakerOverride`/`editedText` を付ければ以後自動判定から除外される |
| 分離ゲート不合格(モノラル等) | Phase B/C を丸ごとスキップ。Phase Aのみ有効 |
| detectTailMix の例外 | warnして検出なし扱い。ジョブは完了 |
| 再分離の切り出し/API失敗 | 当該セグメントをスキップ、⚠フラグ残存。ジョブは完了 |
| 再分離が編集済みセグメントに遭遇 | 対象外としてスキップ(編集を上書きしない) |

---

## 8. 検証手順(Definition of Done)

1. **ビルド/型チェック**: ルートと `worker/` 両方で build・TypeScript strict が通ること
2. **Phase A 単体**: `buildTranscriptBlocks` にサンドイッチ相槌を含むフィクスチャを与え、`hide`/`inline` で前後ブロックが結合されること・`keep` で従来と完全一致することのユニットテスト。エクスポートMarkdownに相槌が出ないこと
3. **Phase B 合成素材**: `docs/speaker-diarization-improvement.md` §5 の合成ステレオ手順を流用し、`adelay` でBの短い発話をAの語尾に重ねた素材を作成 → `analyze-pan.ts` の新モードで窓分類列を確認し、E2Eで該当セグメントに `mix_suspect_boundary_sec` が入りUIに⚠が出ること。**重なりのない素材で誤検出ゼロ**であること
4. **Phase C E2E**: 同素材で `SPEAKER_MIX_RESPLIT_ENABLED=true` → 混入テキストが主話者セグメントから消え、混入話者の新規セグメントが正しい位置に挿入され、⚠が消えること。`false` ではPhase Bの挙動のみであること
5. **リグレッション**: 既存ジョブの表示・エクスポートが `keep` モードで完全に従来どおりであること。モノラル音源で B/C がスキップされること
6. **環境変数の文書化**: `SPEAKER_MIX_RESPLIT_ENABLED` が `worker/README.md` と `worker/.env.example` に記載されていること。シークレットのコミットがないこと
