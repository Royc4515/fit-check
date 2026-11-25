-- Contact requests (Roy, 2026-11-25): the in-app "contact Roy" form. Every request is kept here, so nothing is lost
-- when the email to Roy cannot be sent; Roy reads and closes them through the mcp contact_requests tool.

create table contact_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('more_quota', 'problem', 'idea', 'other')),
  message text not null check (char_length(message) between 1 and 1000),
  emailed boolean not null default false,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index contact_requests_user_created on contact_requests (user_id, created_at desc);
create index contact_requests_open on contact_requests (created_at desc) where handled_at is null;

alter table contact_requests enable row level security;
-- A user sees what they sent; only the contact function (service role) writes, so the daily limits cannot be skipped.
create policy "read own contact requests" on contact_requests for select using (auth.uid() = user_id);
