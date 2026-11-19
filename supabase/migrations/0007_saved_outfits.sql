-- Saved outfits (DESIGN.md "שלב 5.2", approved by Roy 2026-11-19). A saved outfit is one `outfits` row with
-- `saved_at`; a wear of it is a `wears` row pointing at that same row, never a copy. Why each column exists:
--   name        an optional label the user gives a saved outfit ("ליום שישי"). Null = no name; the screens then
--               list the garment types. The data layer trims and turns an empty name into null before writing,
--               so the check below rejects anything else instead of storing padding or an empty label.
--   is_favorite the favourites tab, and a larger pair-weight bonus in the engine later (spec item 8).
--   saved_at    membership of the collection and its order (newest first). Null = an outfit that was only
--               proposed or worn. Removing an outfit that has wears sets it back to null so history stays intact.
-- Every column is nullable or has a default, so existing rows (all unsaved: none of them has saved_at) and code
-- that does not know the columns (the MCP server's outfit_log, generate-daily) keep working unchanged.
-- Forward only. Covered by the existing "own outfits" RLS policy (for all, user_id = auth.uid() on read and
-- write) and, for outfit_items, "own outfit items" (through the parent outfit); no new policy needed.

alter table outfits add column name text;
alter table outfits add column is_favorite boolean not null default false;
alter table outfits add column saved_at timestamptz;

-- don't touch / the name must already be trimmed (btrim strips spaces only; the app's trim strips all whitespace,
-- which is stricter, so a name it writes always passes). char_length counts characters (code points), the same
-- unit as the app's 40-character limit, not bytes.
alter table outfits add constraint outfits_name_check
  check (name is null or (name = btrim(name) and char_length(name) between 1 and 40));

-- A favourite outside the collection would be invisible on every screen and could never be un-favourited.
alter table outfits add constraint outfits_favorite_is_saved check (not is_favorite or saved_at is not null);

-- The collection screen's one query: own saved outfits, newest first. Partial, because almost every row is an
-- unsaved daily suggestion that this list never reads.
create index outfits_user_saved on outfits (user_id, saved_at desc) where saved_at is not null;
