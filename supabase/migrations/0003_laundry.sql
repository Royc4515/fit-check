-- Laundry by wear count (docs/PLAN.md A6): each kind of garment goes to the wash after a set number of wears
-- (packages/engine/config.ts LAUNDRY_AFTER_WEARS). The count is derived, never stored: wears since `washed_at`.
-- A stored counter would drift on every undo; counting the wears table cannot.

-- Existing rows start "just washed": no wears exist before this migration, so nothing is due on day one.
alter table items add column washed_at timestamptz not null default now();

-- Worn wears per item since that item's last wash. SECURITY INVOKER (the default) so RLS on items, outfits,
-- outfit_items and wears applies: a caller only ever counts their own rows.
-- don't touch / compares wears.created_at (when "wearing" was tapped) with washed_at, not worn_on (a date):
-- washing in the morning and wearing the same day must count that wear.
create function wear_counts_since_wash(p_item_ids uuid[])
returns table (item_id uuid, wears int)
language sql stable
set search_path = public
as $$
  select i.id, count(w.id)::int
  from items i
  left join outfit_items oi on oi.item_id = i.id
  left join wears w on w.outfit_id = oi.outfit_id and w.feedback = 'worn' and w.created_at > i.washed_at
  where i.id = any (p_item_ids)
  group by i.id
$$;
