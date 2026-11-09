-- What the tagger proposed versus what Roy saved, one row per confirmed garment (Roy, 2026-11-09).
-- Two uses: the latest corrections go back into the tagging prompt as examples, so the tagger learns this wardrobe's
-- fabrics and shades; and per-field accuracy can be measured per model before choosing one.
-- Rows with an empty `changed` are kept on purpose: they are the "model was right" half of that measurement.
create table tag_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid references items (id) on delete set null,
  model text not null,
  proposed jsonb not null,
  final jsonb not null,
  changed text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index tag_corrections_user_recent on tag_corrections (user_id, created_at desc);

alter table tag_corrections enable row level security;
create policy "own tag corrections" on tag_corrections for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
