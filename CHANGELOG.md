# Changelog

## 2026-11-06

- Repo scaffolded: monorepo (pnpm + turbo), `packages/schema`, `packages/engine` with tests on the real wardrobe fixture, first Supabase migration, Edge Function stubs, Modal worker stub, Expo app skeleton with i18n (he/en) and design tokens.
- Wardrobe sheet exported to `scripts/data/wardrobe.csv` (109 items) and converted to `packages/engine/__fixtures__/wardrobe.json` by `scripts/import-sheet.ts`.
- Look at: `packages/engine/src/engine.test.ts` for what the engine already guarantees; `supabase/migrations/0001_init.sql` for the schema.
- Not done yet: the "Today" screen (session 1 of Claude Code builds it), any AI call, any Supabase deploy.

## 2026-11-06 (review)

- Supabase project `ftjerbwrzjprfikxkukj` (eu-central-1) created; migrations 0001 and 0002 applied; security advisor clean.
- Engine review fixes: never-worn ordering was non-deterministic (NaN comparator), virtual items could not reach the pre-purchase check, disliked pairs lost their sign, navy was treated as a colored hue, layer formality had no upper bound, an accessory anchor dropped itself. 5 tests added (16 total).
- Open (needs a go, schema change): `match_items()` uses `auth.uid()` and returns nothing when called with the service role from an Edge Function; proposed 0003 adds a `p_user_id` parameter. Same migration could turn the duplicated hot columns on `items` into generated columns from `tags` to prevent drift.
