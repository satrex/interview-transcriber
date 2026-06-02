do $$
begin
  if exists (
    select 1
    from public.monthly_artist_payouts as map
    group by map.artist_id, map.payout_month
    having count(*) > 1
  ) then
    raise exception
      'monthly_artist_payouts has duplicate artist_id + payout_month rows; resolve duplicates before adding the unique constraint';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint as c
    where c.conname = 'monthly_artist_payouts_artist_id_payout_month_key'
      and c.conrelid = 'public.monthly_artist_payouts'::regclass
  ) then
    alter table public.monthly_artist_payouts
    add constraint monthly_artist_payouts_artist_id_payout_month_key
    unique (artist_id, payout_month);
  end if;
end;
$$;

alter table public.monthly_artist_payouts
drop constraint if exists monthly_artist_payouts_artist_id_payout_month_currency_key;

create or replace function public.close_monthly_artist_payouts(
  p_payout_month date,
  p_fee_bps integer default 0
)
returns table (
  artist_id text,
  payout_month date,
  gross_amount integer,
  fee_amount integer,
  net_amount integer,
  currency text,
  payout_status public.artist_payout_status
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'admin privileges required';
  end if;

  if p_payout_month is null then
    raise exception 'payout month is required';
  end if;

  if p_fee_bps < 0 or p_fee_bps > 10000 then
    raise exception 'fee basis points must be between 0 and 10000';
  end if;

  return query
  with aggregated as (
    select
      t.artist_id as artist_id,
      t.payout_month as payout_month,
      sum(t.amount)::integer as gross_amount,
      floor(sum(t.amount) * p_fee_bps / 10000.0)::integer as fee_amount,
      min(t.currency) as currency
    from public.tips as t
    where t.payout_month = date_trunc('month', p_payout_month)::date
      and t.status = 'paid'::public.tip_status
      and t.artist_id is not null
    group by
      t.artist_id,
      t.payout_month
  ),
  upserted as (
    insert into public.monthly_artist_payouts (
      artist_id,
      payout_month,
      gross_amount,
      fee_amount,
      net_amount,
      currency,
      notification_status,
      payout_status
    )
    select
      aggregated.artist_id,
      aggregated.payout_month,
      aggregated.gross_amount,
      aggregated.fee_amount,
      greatest(aggregated.gross_amount - aggregated.fee_amount, 0),
      aggregated.currency,
      'pending'::public.payout_notification_status,
      'pending'::public.artist_payout_status
    from aggregated
    on conflict on constraint monthly_artist_payouts_artist_id_payout_month_key
    do update set
      gross_amount = excluded.gross_amount,
      fee_amount = excluded.fee_amount,
      net_amount = excluded.net_amount,
      currency = excluded.currency,
      updated_at = now()
    where public.monthly_artist_payouts.payout_status is distinct from 'paid'::public.artist_payout_status
    returning
      public.monthly_artist_payouts.artist_id,
      public.monthly_artist_payouts.payout_month,
      public.monthly_artist_payouts.gross_amount,
      public.monthly_artist_payouts.fee_amount,
      public.monthly_artist_payouts.net_amount,
      public.monthly_artist_payouts.currency,
      public.monthly_artist_payouts.payout_status
  )
  select
    upserted.artist_id,
    upserted.payout_month,
    upserted.gross_amount,
    upserted.fee_amount,
    upserted.net_amount,
    upserted.currency,
    upserted.payout_status
  from upserted
  order by
    upserted.artist_id,
    upserted.payout_month;
end;
$$;

revoke all on function public.close_monthly_artist_payouts(date, integer)
from public, anon;

grant execute on function public.close_monthly_artist_payouts(date, integer)
to authenticated;
