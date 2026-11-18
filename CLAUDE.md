# CLAUDE.md - Fit Check

Personal wardrobe and styling app for Roy. Single user now, multi-user-ready schema. Read `PRD.md` for scope and data model, `DESIGN.md` for everything visual. Both are the spec; this file is how we work.

## Stack

- App: Expo (latest SDK), Expo Router, TypeScript strict, NativeWind v4 (Tailwind, with the tokens from DESIGN.md as the only palette), Reanimated 4 + Gesture Handler, expo-notifications, expo-haptics, expo-image.
- Web target: same code via react-native-web, deployed to Vercel. Animations use Reanimated + Gesture Handler on every platform, one code path (the `motion` split was never built; DESIGN.md section 5).
- Backend: Supabase (Postgres + pgvector, Auth with Google, Storage, Edge Functions in Deno, pg_cron).
- ML worker: Python service on Modal exposing `/cutout` (BiRefNet via rembg) and `/embed` (FashionCLIP, 512-d). Called only from Edge Functions.
- AI providers, called only from Edge Functions, each behind one function in `supabase/functions/_shared/ai/`:
  - `separateGarments(image)` → Gemini 2.5 Flash Image
  - `tagItem(cutout)` → Claude Haiku, structured output, schema in `packages/schema/item-tags.ts`
  - `styleOutfit(candidates, context)` → Claude Sonnet, schema in `packages/schema/stylist.ts`
  - `extractReceipt(text)` → Claude Haiku (v2)
- i18n: `i18next` + `react-i18next`, files in `apps/mobile/locales/{he,en}.json`. Default `he`, RTL via `I18nManager` on native and `dir` on web.

## Repo layout (monorepo, pnpm + turbo)

```
apps/mobile/          Expo app (also builds web)
packages/schema/      zod schemas shared by app and Edge Functions (item tags, stylist I/O, context rules)
packages/engine/      pure TypeScript: filters, scoring, candidate generation. No I/O. 100% unit-tested.
supabase/migrations/  SQL, one file per change, never edited after merge
supabase/functions/   Edge Functions: intake-separate, intake-cutout, intake-tag, generate-daily, precheck, import-sheet
worker/               Modal app (Python): cutout + embed
design/screens/       dated screenshots of every screen
scripts/              one-off tools (sheet import CSV, seed)
```

## Commands

```
pnpm dev              # expo start (mobile + web)
pnpm test             # vitest for packages/*, deno test for functions
pnpm lint             # eslint + tsc --noEmit
pnpm db:push          # supabase db push (migrations)
pnpm db:types         # regenerate Supabase types into packages/schema
pnpm functions:serve  # supabase functions serve
pnpm build:android    # eas build --platform android --profile preview (APK)
```

## Code rules

- Comments explain WHY, never what. A reader can see what the code does.
- Any line that is counterintuitive, load-bearing, or hides a past bug gets `// don't touch / <reason>` directly above it. Comments are the spec layer closest to execution.
- TSDoc on every exported function and every Edge Function entry: purpose, inputs, failure modes.
- Edge cases and input validation first. Every Edge Function validates its input with zod and returns a typed error; no `any`, no `as unknown as`.
- The engine (`packages/engine`) is pure: no Supabase, no fetch, no Date.now() inside. Time and data come in as arguments so tests are deterministic.
- Scoring weights live in `packages/engine/config.ts`, not inline. Changing a weight is a config change, not a code change.
- The item tag schema (`item-tags.ts`) is frozen after the first real import. Adding a field is a migration plus a re-tag job, never a silent default.
- The LLM never sees the whole wardrobe. `styleOutfit` receives at most 8 candidate outfits. If you find yourself passing more, the bug is upstream in filtering.
- All AI output is JSON validated by zod before use. A parse failure logs to `ai_calls` and falls back to the top-scored candidate without explanation.
- Every AI call writes a row to `ai_calls` (provider, model, tokens or images, cost estimate, latency). Cost visibility is a feature.
- Secrets only in Supabase function env and Modal secrets. The app bundle contains the Supabase anon key and nothing else.
- i18n: no string literal in JSX. `t('today.title')`. Dates via `Intl` with the active locale; Hebrew dates from Hebcal, not computed locally.
- RTL: logical properties only (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`). Never `ml-`/`mr-`. Directional icons come from the icon set's RTL variants.
- Migrations: forward only. Every table has `user_id` and an RLS policy from the first migration, even with one user.

## Design rules

- `DESIGN.md` section 1 ("אסור") is a hard constraint. Before committing a screen, re-read it.
- Build and get approval on the "Today" screen before any other screen.
- The redesign follows `docs/REDESIGN_PLAN.md`; live status is in `TASKS.md`.
- Animations: Reanimated shared values only; no React state on the animation path. Load the `animate-expo` skill before animation work and `hebrew-rtl-best-practices` before layout work.
- Save a screenshot of every new or changed screen to `design/screens/YYYY-MM-DD-<screen>.png`.

## Workflow

1. Before writing code for a feature: read the relevant PRD section, state the plan in 5-10 lines, list the files you will touch. Wait for a go only when the plan changes schema or spends money (AI calls in a loop, new provider).
2. Small commits with imperative messages. One feature per branch. No force-push to main.
3. Tests before the Edge Function wiring: engine logic is tested with fixtures in `packages/engine/__fixtures__/wardrobe.json` (an anonymized export of the real wardrobe).
4. After finishing a task, append a short entry to `CHANGELOG.md`: date, what changed, what to look at.
5. If something in PRD.md or DESIGN.md turns out wrong while building, say so and propose the edit; do not silently diverge.

## Do not

- Do not add a UI library (shadcn, Tamagui, Paper). Components are ours, in `apps/mobile/src/components/ui/`, styled from the tokens. A screen never styles a one-off view; a missing component is added to the library (DESIGN.md section 4).
- Do not add a vector DB, queue, or second backend. Supabase does all of it at this scale.
- Do not call remove.bg (API shuts down 2026-12-01). Cutouts come from the Modal worker.
- Do not implement virtual try-on, Gmail import, or price tracking in the MVP, even if tempting. Tables for them exist and stay empty.
- Do not store the wardrobe in the app bundle or in local-only storage; Supabase is the source of truth, local is cache.
