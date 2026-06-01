create type public.tip_status as enum (
  'paid',
  'failed',
  'refunded'
);

create type public.payout_notification_status as enum (
  'pending',
  'notified'
);

create type public.artist_payout_status as enum (
  'pending',
  'paid'
);

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.tips (
  id uuid primary key default gen_random_uuid(),
  stripe_checkout_session_id text not null,
  stripe_payment_intent_id text,
  artist_id text,
  tip_type text not null default 'tip',
  amount integer not null check (amount >= 0),
  currency text not null,
  status public.tip_status not null,
  paid_at timestamptz,
  payout_month date not null,
  stripe_description text,
  stripe_customer_email text,
  stripe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.monthly_artist_payouts (
  id uuid primary key default gen_random_uuid(),
  artist_id text not null,
  payout_month date not null,
  gross_amount integer not null default 0 check (gross_amount >= 0),
  fee_amount integer not null default 0 check (fee_amount >= 0),
  net_amount integer not null default 0 check (net_amount >= 0),
  currency text not null default 'jpy',
  notification_status public.payout_notification_status not null default 'pending',
  payout_status public.artist_payout_status not null default 'pending',
  notified_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_id, payout_month, currency)
);

create unique index if not exists tips_stripe_checkout_session_id_key
  on public.tips (stripe_checkout_session_id);

create unique index if not exists tips_stripe_payment_intent_id_key
  on public.tips (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index if not exists tips_payout_month_artist_status_idx
  on public.tips (payout_month, artist_id, status);

create index if not exists monthly_artist_payouts_month_status_idx
  on public.monthly_artist_payouts (payout_month, payout_status, artist_id);

drop trigger if exists set_monthly_artist_payouts_updated_at
on public.monthly_artist_payouts;

create trigger set_monthly_artist_payouts_updated_at
before update on public.monthly_artist_payouts
for each row
execute function public.set_updated_at();

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_admins
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_current_user_admin()
from public, anon;

grant execute on function public.is_current_user_admin()
to authenticated;

alter table public.app_admins enable row level security;
alter table public.artists enable row level security;
alter table public.tips enable row level security;
alter table public.monthly_artist_payouts enable row level security;

drop policy if exists "Admins can select app admins"
on public.app_admins;

create policy "Admins can select app admins"
on public.app_admins
for select
to authenticated
using (public.is_current_user_admin());

drop policy if exists "Admins can manage artists"
on public.artists;

drop policy if exists "Admins can select artists"
on public.artists;

create policy "Admins can select artists"
on public.artists
for select
to authenticated
using (public.is_current_user_admin());

drop policy if exists "Admins can manage tips"
on public.tips;

create policy "Admins can manage tips"
on public.tips
for all
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

drop policy if exists "Admins can manage monthly artist payouts"
on public.monthly_artist_payouts;

create policy "Admins can manage monthly artist payouts"
on public.monthly_artist_payouts
for all
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

revoke all on function public.close_monthly_artist_payouts(date, integer)
from public, anon;

grant execute on function public.close_monthly_artist_payouts(date, integer)
to authenticated;

comment on table public.tips is
  'Stripe Checkout tip payments keyed by Checkout Session and artist metadata.';

comment on table public.monthly_artist_payouts is
  'Manual monthly payout task records for artist tip settlements.';

comment on column public.tips.amount is
  'Gross tip amount in the currency minor unit used by Stripe.';

comment on column public.tips.stripe_metadata is
  'Merged metadata from Stripe Checkout Session, PaymentIntent, and Charge for admin classification.';

comment on column public.monthly_artist_payouts.fee_amount is
  'Deducted fee amount in the same currency minor unit. Calculated during monthly close.';
