# Auth / RLS Test Plan

この手順は Supabase Auth を前提に、`test-user-a` と `test-user-b` の 2 ユーザーで権限分離を確認するためのものです。

## 目的

- `transcription_jobs` は job owner だけが見えることを確認する。
- `transcription_segments` は owner の job に紐づく segment だけが見えることを確認する。
- Supabase Storage の `audio` は browser / authenticated user から直接読めないことを確認する。
- worker は `service_role` で `queued` job を claim / update できることを確認する。
- `SUPABASE_SERVICE_ROLE_KEY` が server / worker 側だけで使われ、browser に露出しないことを確認する。

`public.profiles` テーブルはこの検証には不要です。権限は `auth.users.id` と各 table の `user_id` で判定します。

## 実施チェックリスト

- [ ] Supabase Dashboard で `test-user-a` と `test-user-b` を作成する。
- [ ] SQL で `test-user-a` / `test-user-b` の `user_id` を確認する。
- [ ] A / B それぞれの job と segment のテストデータを作成する。
- [ ] A として `transcription_jobs` を select し、A の job だけ見えることを確認する。
- [ ] B として `transcription_jobs` を select し、B の job だけ見えることを確認する。
- [ ] B として A の job を id 指定で select し、0 rows になることを確認する。
- [ ] B として A の segment を job_id 指定で select し、0 rows になることを確認する。
- [ ] `authenticated` role では `claim_next_transcription_job` を実行できないことを確認する。
- [ ] service role / SQL Editor 管理者権限では `claim_next_transcription_job` で queued job を claim できることを確認する。
- [ ] worker が `SUPABASE_SERVICE_ROLE_KEY` で queued job を claim / update できることを確認する。
- [ ] authenticated user では Storage `audio` の object 一覧が見えないことを確認する。
- [ ] `SUPABASE_SERVICE_ROLE_KEY` が browser に露出していないことを確認する。

## 前提

- Supabase migrations `0001` から `0005` が適用済みであること。
- Supabase Dashboard で test user を作成できること。
- root `.env.local` と `worker/.env` が設定済みであること。
- `SUPABASE_SERVICE_ROLE_KEY` は `.env.local` と `worker/.env` にのみ置き、`NEXT_PUBLIC_` prefix を付けないこと。

## 1. テストユーザーを作成

Supabase Dashboard の `Authentication` -> `Users` から 2 人作成します。

| label | email 例 | password 例 |
| --- | --- | --- |
| test-user-a | `test-user-a@example.com` | 任意の強いパスワード |
| test-user-b | `test-user-b@example.com` | 任意の強いパスワード |

作成後、それぞれの User UID を控えます。

SQL Editor で email から user_id を確認する場合は、管理者権限で以下を実行します。

```sql
select id, email, created_at
from auth.users
where email in (
  'test-user-a@example.com',
  'test-user-b@example.com'
)
order by email;
```

```txt
USER_A_ID=
USER_B_ID=
```

以降の SQL では、この 2 つを実際の UUID に置き換えてください。

## 2. テストデータを作成

Supabase Dashboard の SQL Editor で実行します。

```sql
insert into public.transcription_jobs (
  id,
  user_id,
  original_filename,
  storage_bucket,
  storage_path,
  status,
  progress
)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'USER_A_ID',
    'a-private-test.m4a',
    'audio',
    'jobs/11111111-1111-1111-1111-111111111111/source/a-private-test.m4a',
    'completed',
    100
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'USER_B_ID',
    'b-private-test.m4a',
    'audio',
    'jobs/22222222-2222-2222-2222-222222222222/source/b-private-test.m4a',
    'completed',
    100
  )
on conflict (id) do nothing;

insert into public.transcription_segments (
  job_id,
  speaker_label,
  start_sec,
  end_sec,
  text,
  chunk_index
)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'speaker_0',
    0,
    5,
    'A user transcript segment',
    0
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'speaker_0',
    0,
    5,
    'B user transcript segment',
    0
  );
```

Storage の RLS 確認用に、Dashboard の Storage 画面から `audio` bucket に以下の path で小さな dummy file を置きます。

```txt
jobs/11111111-1111-1111-1111-111111111111/source/a-private-test.m4a
jobs/22222222-2222-2222-2222-222222222222/source/b-private-test.m4a
```

## 3. A と B の RLS を SQL で確認

SQL Editor では管理者権限で実行されるため、RLS 検証時は transaction 内で `authenticated` role と JWT subject を明示します。

### A として確認

```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'USER_A_ID';

select id, user_id, original_filename
from public.transcription_jobs
order by id;

select job_id, text
from public.transcription_segments
order by job_id;

rollback;
```

期待結果:

- `transcription_jobs` は `11111111-1111-1111-1111-111111111111` だけ見える。
- `transcription_segments` は `A user transcript segment` だけ見える。
- B の job / segment は 0 件扱いで見えない。

### B として確認

```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'USER_B_ID';

select id, user_id, original_filename
from public.transcription_jobs
order by id;

select job_id, text
from public.transcription_segments
order by job_id;

rollback;
```

期待結果:

- `transcription_jobs` は `22222222-2222-2222-2222-222222222222` だけ見える。
- `transcription_segments` は `B user transcript segment` だけ見える。
- A の job / segment は 0 件扱いで見えない。

## 4. A の job が B から見えないことを明示確認

`transcription_jobs` の owner 分離を直接確認します。

```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'USER_B_ID';

select id, original_filename
from public.transcription_jobs
where id = '11111111-1111-1111-1111-111111111111';

select job_id, text
from public.transcription_segments
where job_id = '11111111-1111-1111-1111-111111111111';

rollback;
```

期待結果:

- どちらも 0 rows。
- permission error ではなく、RLS により存在しないように見える。

segments だけを分けて確認したい場合は、B として A の job に紐づく segment を select します。

```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'USER_B_ID';

select id, job_id, speaker_label, text
from public.transcription_segments
where job_id = '11111111-1111-1111-1111-111111111111'
order by chunk_index, start_sec;

rollback;
```

期待結果:

- 0 rows。

## 5. Storage RLS を確認

現在の設計では、source audio は browser から直接読ませません。`audio` bucket は private で、`storage.objects` に authenticated user 向け policy を作っていないため、ユーザーは object 一覧も download もできない想定です。

```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'USER_A_ID';

select bucket_id, name
from storage.objects
where bucket_id = 'audio'
order by name;

rollback;
```

期待結果:

- 0 rows。

B でも同じです。

```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'USER_B_ID';

select bucket_id, name
from storage.objects
where bucket_id = 'audio'
order by name;

rollback;
```

期待結果:

- 0 rows。

補足:

- Dashboard は管理者として Storage を表示するため、Dashboard で見えること自体は問題ありません。
- Web app で audio を扱う処理は server action が `SUPABASE_SERVICE_ROLE_KEY` で Storage に upload します。
- 将来 browser から Supabase Storage へ直接 upload する場合は、user-scoped path と Storage RLS policy を追加してから再検証してください。

## 6. worker が service role で queued job を処理できることを確認

queued job を 1 件作成します。

```sql
insert into public.transcription_jobs (
  id,
  user_id,
  original_filename,
  storage_bucket,
  storage_path,
  status,
  progress
)
values (
  '33333333-3333-3333-3333-333333333333',
  'USER_A_ID',
  'worker-claim-test.m4a',
  'audio',
  'jobs/33333333-3333-3333-3333-333333333333/source/worker-claim-test.m4a',
  'queued',
  0
)
on conflict (id) do update
set
  status = 'queued',
  progress = 0,
  worker_id = null,
  locked_at = null,
  attempt_count = 0,
  error_message = null,
  completed_at = null,
  failed_at = null;
```

authenticated user では claim function を実行できないことを確認します。

```sql
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'USER_A_ID';

select *
from public.claim_next_transcription_job('auth-user-should-fail', 30, 3);

rollback;
```

期待結果:

- permission denied になる。

service role / 管理者では claim できることを確認します。

```sql
select id, status, worker_id, attempt_count
from public.claim_next_transcription_job('rls-test-worker', 30, 3);
```

期待結果:

- `33333333-3333-3333-3333-333333333333` が返る。
- `status = processing`
- `worker_id = rls-test-worker`
- `attempt_count = 1`

worker 実行で確認する場合は、`worker/.env` に `SUPABASE_SERVICE_ROLE_KEY` を設定し、次を実行します。

```bash
cd worker
npm run dev
```

音声実体が Storage にない場合、worker は download で失敗し、job を retry または failed に更新します。この挙動でも service role で queued job を claim / update できていることは確認できます。実処理完走まで確認したい場合は、`storage_path` に対応する実音声を Storage に置いてから実行します。

## 7. service role key が browser に露出していないことを確認

root `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_AUDIO_BUCKET=audio
MAX_UPLOAD_SIZE_MB=1024
```

worker `.env`:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_AUDIO_BUCKET=audio
```

確認事項:

- `SUPABASE_SERVICE_ROLE_KEY` に `NEXT_PUBLIC_` prefix を付けない。
- browser client で使うのは `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` のみ。
- `src/lib/supabase/admin.ts` は server-only module で、service role client は server 側だけで作成される。
- `worker/src/supabase.ts` は `worker/.env` の service role key を使う。
- Git に `.env.local` や `worker/.env` を commit しない。

## 8. 後片付け

検証データを消す場合は SQL Editor で実行します。

```sql
delete from public.transcription_jobs
where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
);
```

Storage の dummy file は Dashboard の Storage 画面から削除します。
