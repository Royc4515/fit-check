-- Referrals (Roy, 2026-11-25): a user who brings in a new user gets a bonus on their monthly allowance
-- (supabase/functions/_shared/quota.ts), for a limited number of referrals. One code per user; a user can be
-- referred once. Only the `referral` Edge Function writes (service role); users read their own rows.

create table referral_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique check (code ~ '^[a-z0-9]{8}$'),
  created_at timestamptz not null default now()
);
alter table referral_codes enable row level security;
create policy "read own referral code" on referral_codes for select using (auth.uid() = user_id);

create table referrals (
  -- The new user. Primary key, so a second claim for the same user fails instead of counting twice.
  user_id uuid primary key references auth.users (id) on delete cascade,
  referrer_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_id <> referrer_id)
);
create index referrals_referrer on referrals (referrer_id);
alter table referrals enable row level security;
create policy "read own referrals" on referrals for select using (auth.uid() = user_id or auth.uid() = referrer_id);
