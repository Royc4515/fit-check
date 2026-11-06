# Changelog

## 2026-11-06

- Repo scaffolded: monorepo (pnpm + turbo), `packages/schema`, `packages/engine` with tests on the real wardrobe fixture, first Supabase migration, Edge Function stubs, Modal worker stub, Expo app skeleton with i18n (he/en) and design tokens.
- Wardrobe sheet exported to `scripts/data/wardrobe.csv` (109 items) and converted to `packages/engine/__fixtures__/wardrobe.json` by `scripts/import-sheet.ts`.
- Look at: `packages/engine/src/engine.test.ts` for what the engine already guarantees; `supabase/migrations/0001_init.sql` for the schema.
- Not done yet: the "Today" screen (session 1 of Claude Code builds it), any AI call, any Supabase deploy.
