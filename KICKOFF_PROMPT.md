# פרומפט פתיחה לסשן הראשון ב-Claude Code

השלד כבר בריפו (ראה CHANGELOG.md): סכמות, מנוע עם 11 בדיקות על הארון האמיתי, מיגרציה, stubs לפונקציות, worker, ואפליקציית Expo שמתקמפלת. הסשן הראשון לא מתחיל מאפס; הוא בונה את המסך הראשון על השלד הזה.

לפני הסשן, פעם אחת:
1. `git clone https://github.com/Royc4515/fit-check && cd fit-check && pnpm install`.
2. פרויקט Supabase חדש (Free): `supabase link --project-ref <ref>` ואז `pnpm db:push`. להעתיק URL ו-anon key ל-`apps/mobile/.env.local` לפי `.env.example`.
3. חשבון Modal: `pip install modal && modal token new`, ואז לפי `worker/README.md`.
4. מפתחות: Anthropic Console (לקשר את קרדיטי Max 5x ב-Settings > Billing ב-claude.ai), Google AI Studio (Gemini). `supabase secrets set ANTHROPIC_API_KEY=... GEMINI_API_KEY=... MODAL_WORKER_URL=... MODAL_WORKER_TOKEN=...`.
5. בתוך Claude Code: `npx skills add skills-il/localization --skill hebrew-rtl-best-practices --agent claude-code` ו-`npx skills add emilkowalski/skills --skill animate-expo --agent claude-code`.
6. Android Studio עם אמולטור, או הטלפון עם USB debugging, כדי לראות את המסך.

---

Read CLAUDE.md, PRD.md, DESIGN.md and CHANGELOG.md in full before doing anything. They are the spec and the current state.

This is session 1. The scaffold exists and passes `pnpm typecheck`, `pnpm test` and a web export. Do not re-scaffold anything. The goal of this session is ONE approved screen.

1. Run `pnpm install`, `pnpm typecheck`, `pnpm test` and `cd apps/mobile && npx expo-doctor`. If anything fails, fix it first and tell me what was wrong.
2. Read `apps/mobile/src/theme/tokens.base.js` and `DESIGN.md` section 3 ("היום"). Then build the "Today" screen in `apps/mobile/src/app/index.tsx`, replacing the placeholder, with mock data taken from `packages/engine/__fixtures__/wardrobe.json` run through `generateCandidates` from `@fit-check/engine` (weekday context, 16-24C). No Supabase and no AI calls in this session.
   - Ivory background, Frank Ruhl Libre heading with the Hebrew and Gregorian date (hardcode today's Hebrew date as mock for now), asymmetric outfit composition (top large on the start side, bottom and shoes staggered on the end side, 8px overlap), explanation in body text, weather line in Plex Mono, bottom action sheet with the five actions from `locales/he.json`.
   - Hebrew by default, RTL, every string through `t()`. Switching the device to English must render LTR without layout bugs.
   - The sheet is a Reanimated 4 shared value with a Gesture Handler pan and the spring from `tokens.ts` `motion.spring`. Nothing animates on the JS thread.
   - Item images do not exist yet: render a placeholder block in `--ivory-deep` with the item name in `meta` size, same proportions a cutout would have.
3. Re-read DESIGN.md section 1 ("אסור") and list, item by item, that the screen violates none of it.
4. Take a screenshot on an Android emulator and save it to `design/screens/<YYYY-MM-DD>-today.png`. Append a CHANGELOG.md entry. Commit.
5. Stop and ask me to review the screenshot before building anything else.

Before you start step 2, write a 10-line plan listing the files you will create or change and wait for my go. Hebrew for anything user-facing, English for code, comments and commit messages. Comments explain why; flag anything load-bearing with `// don't touch / reason`.
