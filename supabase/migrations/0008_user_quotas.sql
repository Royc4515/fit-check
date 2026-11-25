-- Per-user monthly allowances (Roy, 2026-11-25). Every user but the owner gets a lean default allowance, set in
-- supabase/functions/_shared/quota.ts; a row here is what the owner granted on top of it, through the mcp
-- quota_set tool. No row means the defaults.

create table user_quotas (
  user_id uuid primary key references auth.users (id) on delete cascade,
  extra_usd numeric(6, 2) not null default 0 check (extra_usd >= 0 and extra_usd <= 50),
  extra_cutouts int not null default 0 check (extra_cutouts >= 0 and extra_cutouts <= 2000),
  note text check (char_length(note) <= 200),
  updated_at timestamptz not null default now()
);

alter table user_quotas enable row level security;
-- A user may see their own grant (the usage screen); nobody but the service role writes, so no insert, update or
-- delete policy: a client must never be able to raise its own allowance.
create policy "read own quota" on user_quotas for select using (auth.uid() = user_id);

-- Every allowance check sums one user's ai_calls for the month; without this index that is a scan of every call.
create index ai_calls_user_created on ai_calls (user_id, created_at desc);
