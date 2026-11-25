# CLAUDE.md - Fit Check

Personal wardrobe and styling app for Roy. Single user now, multi-user-ready schema. Read `docs/PRD.md` for scope and data model, `docs/DESIGN.md` for everything visual. Both are the spec; this file is how we work.

## Stack

- App: Expo (latest SDK), Expo Router, TypeScript strict, NativeWind v4 (Tailwind, with the tokens from DESIGN.md as the only palette), Reanimated 4 + Gesture Handler, expo-notifications, expo-haptics, expo-image.
- Web target: same code via react-native-web, deployed to Vercel. Animations use Reanimated + Gesture Handler on every platform, one code path (the `motion` split was never built; DESIGN.md section 5).
- Backend: Supabase (Postgres + pgvector, Auth with Google, Storage, Edge Functions in Deno, pg_cron).
- Garment images: Cloudflare R2 (bucket `fit-check-cutouts`, public read), because serving them from Supabase Storage got the project restricted for egress (42.77 GB of a 5 GB quota, 2026-11; Roy moved them on 2026-11-22). Edge Functions read and write them only through `supabase/functions/_shared/objects.ts` (R2 first, the Supabase `cutouts` bucket as fallback); the app reads `EXPO_PUBLIC_R2_PUBLIC_URL` first. Supabase Storage still holds what the app uploads itself (pending photos, crops, originals) and try-on images.
- Background removal (`_shared/ai/background.ts`, called only from Edge Functions): first the Cloudflare Worker `fit-check-cutout` (`worker/cloudflare`, Cloudflare Images `segment: "foreground"`, BiRefNet run by Cloudflare), free up to 5,000 transformations a month (2 per cutout; capped in code at 2,400 cutouts); it does not drop clothes hanging behind the garment. Fallback: the Python service on Modal exposing `/cutout` (BiRefNet via rembg, SAM 2.1 to keep the front garment), on Modal's $1 monthly credit without a card (Roy: no card on file), so it scales to zero 20 s after the last call. `intake-cutout` allows 80 a day. Embeddings will come from `gemini-embedding-2`, not the worker (`docs/TASKS.md` 5.5); the unused `/embed` endpoint was removed 2026-11-25.
- AI providers, called only from Edge Functions, each behind one function in `supabase/functions/_shared/ai/`:
  - `separateGarments(image)` → Gemini 2.5 Flash Image
  - `tagItem(cutout)` → Claude Haiku, structured output, schema in `packages/schema/item-tags.ts`
  - `styleOutfit(candidates, context)` → Claude Sonnet, schema in `packages/schema/stylist.ts`
  - `extractReceipt(text)` → Claude Haiku (v2)
  - `renderOutfit(garments, figure)` → Nano Banana 2.1 (stage 5.3; not built yet)
- i18n: `i18next` + `react-i18next`, files in `apps/mobile/locales/{he,en}.json`. Default `he`, RTL via `I18nManager` on native and `dir` on web.

## Repo layout (monorepo, pnpm + turbo)

```
apps/mobile/          Expo app (also builds web)
packages/schema/      zod schemas shared by app and Edge Functions (item tags, stylist I/O, context rules)
packages/engine/      pure TypeScript: filters, scoring, candidate generation. No I/O. 100% unit-tested.
supabase/migrations/  SQL, one file per change, never edited after merge
supabase/functions/   Edge Functions: intake-separate, intake-cutout, intake-tag, style-outfit, tryon, mcp, design-preview, import-sheet; generate-daily and precheck are stubs
worker/               background removal: the Modal app (Python) and the Cloudflare Worker (worker/cloudflare)
design/screens/       dated screenshots of every screen
docs/                 the spec (PRD.md, DESIGN.md), live status (TASKS.md), CHANGELOG.md, plans and checklists
scripts/              one-off tools (sheet import CSV, seed)
```

## Commands

```
pnpm dev              # expo start (mobile + web)
pnpm test             # vitest for packages/*, apps/mobile and scripts
pnpm test:functions   # deno test for supabase/functions (needs Deno 2)
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
- Money rule (Roy, 2026-11-19): everything runs free or inside the credits his subscriptions give him each month. Nothing may bill him out of pocket. So: every paid provider has a monthly cap in code set below that provider's monthly credit (`_shared/ai/budget.ts` for Google); when a cap is reached the feature says so and stops, it never falls back to another paid path; where there is a choice of provider, use the one with more unused credit (today Anthropic); a new paid call, provider or plan needs Roy's go with the monthly cost stated against the credit that covers it.
- Secrets only in Supabase function env and Modal secrets. The app bundle contains the Supabase anon key and nothing else.
- i18n: no string literal in JSX. `t('today.title')`. Dates via `Intl` with the active locale; Hebrew dates from Hebcal, not computed locally.
- RTL: logical properties only (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`). Never `ml-`/`mr-`. Directional icons come from the icon set's RTL variants.
- Migrations: forward only. Every table has `user_id` and an RLS policy from the first migration, even with one user.

## Design rules

- `docs/DESIGN.md` section 1 ("אסור") is a hard constraint. Before committing a screen, re-read it.
- Build and get approval on the "Today" screen before any other screen.
- The redesign follows `docs/REDESIGN_PLAN.md`; live status is in `docs/TASKS.md`.
- Animations: Reanimated shared values only; no React state on the animation path. Load the `animate-expo` skill before animation work and `hebrew-rtl-best-practices` before layout work.
- Save a screenshot of every new or changed screen to `design/screens/YYYY-MM-DD-<screen>.png`.

## Workflow

1. Before writing code for a feature: read the relevant PRD section, state the plan in 5-10 lines, list the files you will touch. Wait for a go only when the plan changes schema or spends money (AI calls in a loop, new provider).
2. Small commits with imperative messages. No force-push to main.
   - One thing per push and per merge (Roy, 2026-11-19: "every push and merge is one specific, isolated thing, not many scattered things"). A pull request holds one feature, one fix or one rule, with its own spec edit, tests, `docs/TASKS.md` row and `docs/CHANGELOG.md` entry, and nothing else. A note about something unrelated goes in its own pull request.
   - Branches are named `claude/<topic>` (Roy allowed topic branches the same day), one per thing, cut from `main`. When one thing needs another that is not merged yet, its branch is cut from that other branch and its pull request is based on it, so each pull request still shows only its own change; they merge in order.
   - Each pull request is checked on its own before it merges: lint, typecheck and tests on that branch, and the independent check for anything a user can see.
3. Tests before the Edge Function wiring: engine logic is tested with fixtures in `packages/engine/__fixtures__/wardrobe.json` (an anonymized export of the real wardrobe).
4. After finishing a task, append a short entry to `docs/CHANGELOG.md`: date, what changed, what to look at.
5. If something in `docs/PRD.md` or `docs/DESIGN.md` turns out wrong while building, say so and propose the edit; do not silently diverge.

## Do not

- Do not add a UI library (shadcn, Tamagui, Paper). Components are ours, in `apps/mobile/src/components/ui/`, styled from the tokens. A screen never styles a one-off view; a missing component is added to the library (DESIGN.md section 4).
- Do not add a vector DB, queue, or second backend. Supabase does all of it at this scale.
- Do not call remove.bg (API shuts down 2026-12-01). Cutouts come from the Cloudflare Worker, with the Modal worker as fallback.
- Do not implement Gmail import or price tracking in the MVP, even if tempting. Tables for them exist and stay empty. Virtual try-on: Roy lifted the ban on 2026-11-19; it proceeds only as `docs/REDESIGN_PLAN.md` stage 5.3 says (one generated image of the whole outfit, on demand; the first slice is the test and is removed if Roy rejects it), under the money rule above.
- Do not store the wardrobe in the app bundle or in local-only storage; Supabase is the source of truth, local is cache.
