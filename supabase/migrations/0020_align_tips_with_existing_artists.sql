alter table public.tips
add column if not exists artist_id text;

alter table public.tips
alter column artist_id type text using artist_id::text;

alter table public.tips
alter column artist_id drop not null;

update public.tips
set artist_id = null
where artist_id = 'uncategorized';

update public.tips
set artist_id = null
where artist_id is not null
  and not exists (
    select 1
    from public.artists
    where artists.id = tips.artist_id
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tips_artist_id_fkey'
      and conrelid = 'public.tips'::regclass
  ) then
    alter table public.tips
    add constraint tips_artist_id_fkey
    foreign key (artist_id)
    references public.artists(id)
    on update cascade
    on delete set null;
  end if;
end;
$$;

drop policy if exists "Admins can select artists"
on public.artists;

drop policy if exists "Admins can manage artists"
on public.artists;

drop policy if exists "Admins can insert artists"
on public.artists;

drop policy if exists "Admins can update artists"
on public.artists;

create policy "Admins can select artists"
on public.artists
for select
to authenticated
using (public.is_current_user_admin());

create policy "Admins can insert artists"
on public.artists
for insert
to authenticated
with check (public.is_current_user_admin());

create policy "Admins can update artists"
on public.artists
for update
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

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
  with monthly_totals as (
    select
      tips.artist_id,
      tips.payout_month,
      tips.currency,
      sum(tips.amount)::integer as gross_amount,
      floor(sum(tips.amount) * p_fee_bps / 10000.0)::integer as fee_amount
    from public.tips
    where tips.payout_month = date_trunc('month', p_payout_month)::date
      and tips.status = 'paid'
      and tips.artist_id is not null
    group by tips.artist_id, tips.payout_month, tips.currency
  ),
  upserted as (
    insert into public.monthly_artist_payouts (
      artist_id,
      payout_month,
      gross_amount,
      fee_amount,
      net_amount,
      currency
    )
    select
      monthly_totals.artist_id,
      monthly_totals.payout_month,
      monthly_totals.gross_amount,
      monthly_totals.fee_amount,
      greatest(monthly_totals.gross_amount - monthly_totals.fee_amount, 0),
      monthly_totals.currency
    from monthly_totals
    on conflict (artist_id, payout_month, currency)
    do update set
      gross_amount = excluded.gross_amount,
      fee_amount = excluded.fee_amount,
      net_amount = excluded.net_amount,
      updated_at = now()
    where monthly_artist_payouts.payout_status <> 'paid'
    returning
      monthly_artist_payouts.artist_id,
      monthly_artist_payouts.payout_month,
      monthly_artist_payouts.gross_amount,
      monthly_artist_payouts.fee_amount,
      monthly_artist_payouts.net_amount,
      monthly_artist_payouts.currency,
      monthly_artist_payouts.payout_status
  )
  select *
  from upserted
  order by artist_id, currency;
end;
$$;
