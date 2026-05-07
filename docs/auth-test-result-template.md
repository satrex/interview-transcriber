# Auth / RLS Test Result

このテンプレートは [auth-test-plan.md](./auth-test-plan.md) に沿って、Supabase Auth / RLS の手動検証結果を記録するためのものです。

## 検証情報

| 項目 | 記入欄 |
| --- | --- |
| 検証日 |  |
| 検証者 |  |
| Supabase project name |  |
| Supabase project ref |  |
| App environment | local / preview / production |
| App URL |  |
| 備考 |  |

## テストユーザー

| label | email | user_id |
| --- | --- | --- |
| test-user-a | `test-user-a@example.com` |  |
| test-user-b | `test-user-b@example.com` |  |

## チェック結果

| No. | チェック項目 | PASS / FAIL | メモ |
| --- | --- | --- | --- |
| 1 | Supabase Dashboard で `test-user-a` と `test-user-b` を作成できた |  |  |
| 2 | SQL で `test-user-a` / `test-user-b` の `user_id` を確認できた |  |  |
| 3 | A / B それぞれの job と segment のテストデータを作成できた |  |  |
| 4 | A として `transcription_jobs` を select し、A の job だけ見えた |  |  |
| 5 | B として `transcription_jobs` を select し、B の job だけ見えた |  |  |
| 6 | B として A の job を id 指定で select し、0 rows になった |  |  |
| 7 | B として A の segment を job_id 指定で select し、0 rows になった |  |  |
| 8 | `authenticated` role では `claim_next_transcription_job` を実行できなかった |  |  |
| 9 | service role / SQL Editor 管理者権限では queued job を claim できた |  |  |
| 10 | worker が `SUPABASE_SERVICE_ROLE_KEY` で queued job を claim / update できた |  |  |
| 11 | authenticated user では Storage `audio-uploads` の object 一覧が見えなかった |  |  |
| 12 | `SUPABASE_SERVICE_ROLE_KEY` が browser に露出していないことを確認できた |  |  |
| 13 | `test-user-a` でログインし、画面に A の `user_id` が表示された |  |  |
| 14 | `test-user-b` でログインし、画面に B の `user_id` が表示された |  |  |
| 15 | 未ログイン時にアップロードフォームが表示されなかった |  |  |

## 発見した問題

| No. | 問題 | 影響 | 再現手順 / 証跡 | 対応方針 | ステータス |
| --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  | open / investigating / fixed / wontfix |
| 2 |  |  |  |  | open / investigating / fixed / wontfix |
| 3 |  |  |  |  | open / investigating / fixed / wontfix |

## 対応メモ

```txt

```

## 総合判定

| 項目 | 記入欄 |
| --- | --- |
| 総合結果 | PASS / FAIL |
| リリース判断 | proceed / blocked |
| 次に確認すること |  |
