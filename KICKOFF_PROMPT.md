# פרומפט פתיחה לסשן הראשון ב-Claude Code

העתק את הטקסט שמתחת לקו לסשן הראשון, אחרי שהריפו מכיל את CLAUDE.md, PRD.md ו-DESIGN.md בשורש.

לפני הסשן:
1. `gh repo create Royc4515/fit-check --private --clone`, להעתיק את שלושת הקבצים, commit ראשון.
2. פרויקט Supabase חדש (Free), להעתיק URL ו-anon key ל-`.env.local`.
3. חשבון Modal (free tier) ו-`modal token new`.
4. מפתחות: Anthropic Console (לקשר את קרדיטי Max 5x ב-Settings > Billing ב-claude.ai), Google AI Studio (Gemini).
5. בתוך Claude Code: `npx skills add skills-il/localization --skill hebrew-rtl-best-practices --agent claude-code` ו-`npx skills add emilkowalski/skills --skill animate-expo --agent claude-code`.

---

Read CLAUDE.md, PRD.md and DESIGN.md in full before doing anything. They are the spec.

This is session 1. The goal of this session is a walking skeleton, not features:

1. Scaffold the monorepo exactly as described in CLAUDE.md (pnpm + turbo, apps/mobile with Expo Router + NativeWind + Reanimated 4, packages/schema, packages/engine, supabase/, worker/). TypeScript strict everywhere. Add the commands from CLAUDE.md to the root package.json.
2. Write the first Supabase migration: every table in PRD.md section 6.1, with user_id and RLS policies, pgvector extension and an HNSW index on item_vectors.embedding, and the ai_calls table. Forward-only, one file.
3. Write packages/schema/item-tags.ts as a zod schema matching PRD.md section 6.2 exactly, and packages/schema/stylist.ts for the styleOutfit input and output. Export inferred types.
4. Write scripts/import-sheet.ts that reads the CSV export of "Roy's Wardrobe Database" (columns: ID, Item Name, Category, Style/Usage, Primary Color, Formality (1-10), Season, Notes) and produces rows for items and initial pair_weights per PRD.md section 6.3. Dry-run mode by default; print a summary table. Save an anonymized copy of the output as packages/engine/__fixtures__/wardrobe.json.
5. Implement packages/engine with the hard filter and the scoring function from PRD.md section 5, config in config.ts, pure functions, and unit tests on the fixture that prove: shabbat context never returns sneakers or jeans; recency penalty applies; the function is deterministic given the same inputs.
6. Build ONE screen: "Today", per DESIGN.md section 3, with mock data from the fixture. Ivory background, Frank Ruhl Libre heading with Hebrew and Gregorian date, asymmetric outfit composition, body explanation, weather line in Plex Mono, bottom action sheet. Hebrew by default, RTL, with i18n wired and an en.json that works. Reanimated for the sheet. Nothing else on screen.
7. Take a screenshot of the Today screen on an Android emulator and save it to design/screens/<date>-today.png. Then stop and ask me to review it before building anything else.

Before you start step 1, write a 10-line plan listing the files you will create and wait for my go. Use Hebrew for anything user-facing, English for code, comments and commit messages. Comments explain why; flag anything load-bearing with `// don't touch / reason`.
