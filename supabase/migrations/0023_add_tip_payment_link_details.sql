alter table public.tips
add column if not exists stripe_payment_link_id text,
add column if not exists stripe_payment_link_name text,
add column if not exists stripe_payment_link_url text,
add column if not exists stripe_payment_link_metadata jsonb,
add column if not exists stripe_product_name text;

comment on column public.tips.stripe_payment_link_id is
  'Stripe Payment Link ID used by the Checkout Session, when available.';

comment on column public.tips.stripe_payment_link_name is
  'Human-readable Payment Link name when exposed by Stripe; may be null.';

comment on column public.tips.stripe_payment_link_url is
  'Stripe-hosted Payment Link URL, when available.';

comment on column public.tips.stripe_payment_link_metadata is
  'Metadata stored on the Stripe Payment Link.';

comment on column public.tips.stripe_product_name is
  'Best-effort product name from Checkout Session or Payment Link line items.';
