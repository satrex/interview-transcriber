# Stripe 投げ銭月次管理

## 環境変数

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_TIP_SUCCESS_URL=https://example.com/
STRIPE_TIP_CANCEL_URL=https://example.com/
TIP_PAYOUT_FEE_BPS=0
```

- `TIP_PAYOUT_FEE_BPS` は月次締め時に gross から控除する手数料率です。100 = 1%。
- 金額は Stripe と同じ最小通貨単位で保存します。JPY は 1 円単位、USD は cents。
- `STRIPE_TIP_SUCCESS_URL` / `STRIPE_TIP_CANCEL_URL` は任意です。未設定の場合は既存の `/` に戻します。投げ銭専用の成功・キャンセルページは作りません。

## Supabase 初期設定

1. `supabase/migrations/0018_stripe_tips_and_payouts.sql` を適用します。
2. 管理者ユーザーを登録します。

```sql
insert into public.app_admins (user_id)
values ('AUTH_USER_ID_HERE')
on conflict (user_id) do nothing;
```

`tips` と `monthly_artist_payouts` は RLS で管理者のみ閲覧・操作可能です。Stripe Webhook は service role client で `tips` に保存します。

未分類 tips を画面上で紐づけるため、既存の `public.artists` テーブルから候補を読み込みます。候補の検索・表示には `artists.display_name` を使い、保存時は `artists.id` を `tips.artist_id` に保存します。

## Checkout Session 作成

`POST /api/tips/checkout`

```json
{
  "artistId": "artist_001",
  "tipType": "tip",
  "amount": 1000,
  "currency": "jpy"
}
```

レスポンスの `url` にリダイレクトします。Checkout Session と PaymentIntent の両方に次の metadata を付与します。

- `artist_id`
- `tip_type`

この API は既存の投げ銭導線から呼ばれる想定です。今回の実装では、お客さん向けの新しい成功ページ・失敗ページは追加しません。

## Stripe Webhook 設定

Stripe Dashboard で Webhook endpoint を追加します。

Endpoint URL:

```text
https://YOUR_DOMAIN/api/stripe/webhook
```

購読イベント:

- `checkout.session.completed`
- `checkout.session.async_payment_failed`
- `payment_intent.payment_failed`
- `charge.refunded`

Stripe は Webhook 署名を `Stripe-Signature` header に付与します。このアプリは Stripe SDK の `constructEvent` に raw body と `STRIPE_WEBHOOK_SECRET` を渡して検証します。

## 管理画面

`/admin/tips`

- 「Stripeから取り込み」で、選択月の Checkout Session を Stripe から読み直し、既存の投げ銭を `tips` に保存します。
- 取り込み時は Checkout Session、PaymentIntent、Charge の metadata を参照し、`artist_id` / `tip_type` を拾います。
- metadata が不足している決済は `artist_id = null` として保存します。
- 未分類の投げ銭は管理画面でアーティスト名から検索し、表示名で選んで紐づけられます。
- 対象月を選択して、月別投げ銭一覧を確認できます。
- アーティスト別集計では `paid` だけを支払対象額として見ます。`failed` / `refunded` は集計から除外されます。
- 月次締めでは `artist_id is null` の投げ銭を支払タスクから除外します。先に紐づけてから締めます。
- 「月次締め」は冪等です。同じ月を再実行しても同じ artist/month/currency のレコードを二重作成しません。
- 既存レコードが未支払なら再集計で更新します。
- 支払済みレコードは再集計で上書きしません。
- 「告知文生成」で手動連絡用の文面を表示します。
- 「告知済みにする」「支払済みにする」で月次タスクの状態を更新します。

## テスト手順

1. ローカルで `npm run dev` を起動します。
2. Stripe CLI で Webhook を転送します。

```sh
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

3. CLI が表示する `whsec_...` を `STRIPE_WEBHOOK_SECRET` に設定します。
4. Checkout Session を作成します。

```sh
curl -X POST http://localhost:3000/api/tips/checkout \
  -H 'Content-Type: application/json' \
  -d '{"artistId":"artist_001","tipType":"tip","amount":1000,"currency":"jpy"}'
```

5. レスポンスの `url` を開き、Stripe のテストカード `4242 4242 4242 4242` で支払います。決済後は既存の戻り先URLに戻ります。
6. Supabase の `tips` に1件だけ保存されることを確認します。同じ Webhook を再送しても `stripe_checkout_session_id` の unique 制約により二重登録されません。
7. `/admin/tips?month=YYYY-MM` を開き、「Stripeから取り込み」を実行します。すでに保存済みの決済は upsert され、二重登録されません。
8. metadata がない Checkout Session を取り込んだ場合、未分類エリアに表示されることを確認します。
9. 未分類の artist_id を選択して「紐づけ」を実行します。
10. 「月次締め」を実行します。
11. `monthly_artist_payouts` に artist/month/currency 単位で支払タスクが作成されることを確認します。
12. 同じ月で再度「月次締め」を実行し、未支払レコードは更新されるが二重作成されないことを確認します。
13. 「支払済みにする」後に再度「月次締め」を実行し、そのレコードが上書きされないことを確認します。
