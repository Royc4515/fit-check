-- The "keeps Shabbat and holidays" setting moves from the device to the profile (Roy, 2026-11-19; PRD 7.1, DESIGN 4.1 item 10).
-- Why: the app kept it in local storage, so the MCP server (outfit_today, context_get) could not honour it and
-- planned a Shabbat look for someone who had switched Shabbat handling off. On the profile both read the same value.
-- Default true is the behaviour before this column existed, so every existing row, and any row created later by
-- code that does not know the column, keeps planning Shabbat and holidays exactly as today.
-- Forward only. Covered by the existing "own profile" RLS policy (own row only); no new policy needed.
alter table profile add column observes_shabbat boolean not null default true;
