# Changelog

## 2026-11-25 (Usage bar, contact and invite screens, credit to Roy)

- Why: the screens for the allowance, referral and contact work merged earlier today; Roy asked for contact and invite as screens of their own, and for credit to him with his links.
- Profile: this month's usage under the title (the user's own bar; for Roy, the whole account per cap), rows "Invite a friend" and "Contact Roy", and "Built by Roy Carmelli" with portfolio, GitHub and LinkedIn. Sign-in: one credit line.
- `/contact` (choice of kind, message, send) and `/invite` (personal link, count, share or copy).
- Components: `Meter` (new), `TextField` `multiline`. DESIGN.md "פרופיל ותובנות" and section 4 updated.
- Look at: `design/screens/2026-11-25-profile-*`, `-contact-*`, `-invite-*`, `-sign-in-390-he.png`; on a phone, the share sheet on /invite.

## 2026-11-25 (Personal details out of the public repo's files)

- Why: the repo went public; Roy asked to remove his personal details from the spec and the repo.
- Default place is Tel Aviv (app and mcp), with the eight city-bound Hebcal fixtures re-recorded for it; the weather sample has no coordinates; the campus geocoding sample is renamed. The city is gone from every doc.
- The stylist persona and the mcp instructions describe the users, not one person.
- Deleted the real wardrobe CSV (now git-ignored) and the archived kickoff prompt.
- Not changed: git history, which still holds the old text; removing it needs a history rewrite and a force-push to main, only with Roy's explicit go.
- Look at: a device with no saved place now shows Tel Aviv on Today; Profile > Location picks another city.

## 2026-11-25 ("Contact Roy": requests stored and emailed)

- Why: Roy wants a form that emails him in a set format, with a choice of what the request is about. Resend (free) approved by Roy.
- Migration `0010_contact_requests.sql`; `contact` function: stores the request, then emails Roy through Resend (sender, email, usage this month, message; reply goes to the sender). 5 a day per user, 50 for everyone. Without RESEND_API_KEY, or when the email fails, the request is still stored.
- `mcp` tool `contact_requests` (owner only): read open requests, close them.
- To apply: `supabase db push` (0010), set `RESEND_API_KEY` (Roy), deploy `contact` and `mcp`.
- Look at: `contact/handler_test.ts` (the email's format is checked there).

## 2026-11-25 (Referral bonus on the monthly allowance)

- Why: Roy wants extra allowance for users who bring someone in, with a cap on referrals.
- Migration `0009_referrals.sql`: `referral_codes` and `referrals` (a user is referred once; never by their own code), RLS read-own.
- `referral` function: `code` (the caller's code, made on first ask, with how many they referred and the cap of 4) and `claim` (counts only an account at most 7 days old). Rule in `judgeClaim`, tested without a database.
- `_shared/quota.ts`: each counted referral adds $0.25 and 10 background removals a month.
- App: `/join/<code>` keeps the code and goes to sign-in; once signed in, the root layout claims it once. Checked in a local web build.
- To apply: `supabase db push` (0009), deploy `referral`, then the functions that read the allowance (`usage`, `intake-*`, `style-outfit`, `tryon`, `mcp`).
- Look at: `referral/handler_test.ts`, `features/referral/pendingReferral.test.ts`.

## 2026-11-25 (A personal monthly allowance for every user but Roy)

- Why: Roy wants a usage bar per user, a lean limit for others, and to raise it for whoever asks; for himself, only the whole account's percentages.
- `supabase/functions/_shared/quota.ts`: defaults $0.50 of AI and 30 background removals a month, plus Roy's grant (`user_quotas`, migration `0008_user_quotas.sql`). Roy (OWNER_USER_ID) has no personal limit; until that secret is set, nobody does. Unknown usage counts as used up.
- Checked before every AI call and background removal: `intake-separate`, `intake-tag`, `style-outfit`, `intake-cutout`, `tryon` (render; a stored image stays free) and the `mcp` redraw and cutouts. Over the allowance the answer is `user_monthly_limit` ("you've used this month's allowance", he/en); try-on shows its budget line.
- New `usage` function (`UsageResponseSchema` in packages/schema): the caller's meters; for the owner, the Google, Anthropic and background-removal caps of the whole account.
- New `mcp` tool `quota_set`, owner only: read a user's allowance by email, or set the extra on top of the defaults.
- To apply: `supabase db push` (0008), set the `OWNER_USER_ID` secret to Roy's user id, deploy `usage`, `intake-separate`, `intake-tag`, `style-outfit`, `intake-cutout`, `tryon`, `mcp`.
- Look at: `_shared/quota_test.ts`; the try-on test for a limited user.

## 2026-11-25 (Monthly cap in code for Anthropic)

- Why: the money rule asks for a cap in code below each paid provider's monthly credit; Anthropic had only daily limits. Roy: $100 of Anthropic credit a month.
- `_shared/ai/budget.ts`: `MONTHLY_ANTHROPIC_BUDGET_USD` = 80 across all users, `monthlyAnthropicSpend` (from `ai_calls`, every Anthropic model), `anthropicBudgetAllows`. `log.ts`: `sumProviderCost`.
- `intake-tag` and `style-outfit` check the cap before any work and answer `ai_monthly_limit`. Tagging shows "monthly AI limit reached" (he/en) and leaves the fields to fill by hand; the stylist falls back to the engine's top candidate, as on any stylist failure.
- Spec: PRD money rule (Anthropic line), `CLAUDE.md` money rule, `_shared/ai/README.md`.
- Look at: the Anthropic console's own spend limit (it was $5 on 2026-11-19). Set it between $80 and $100, so the code cap stops first and says why.

## 2026-11-25 (mcp function deployed with one place for both tools)

- What: `mcp` version 11 on the live project, built from `main` at the merge of PR #66 (it also carries PR #65, merged before it). Same command as the earlier deploy (`--use-api --no-verify-jwt --import-map supabase/functions/deno.json`). Versions 9 and 10 were deployed from another session in between.
- Checked: the deployed source contains `withPlace`, `OUTSIDE_ISRAEL_MESSAGE` and `dayInForce`; an unauthenticated request answers 401 with the OAuth discovery header, which answers 200. Not checked: a signed-in call from Claude.
- `docs/TASKS.md` R8 marked done.

## 2026-11-25 (MCP tools: one place for both, Israel only)

- Why: the reviews of PR #51 and #62 found that `outfit_today` took `lat`/`lon` but `outfit_log` did not, so the two could decide the day in force from different candle lighting; and that a point abroad was planned in Israel time with Israel's holiday schedule, giving wrong times without saying so.
- `supabase/functions/mcp/outfit.ts`: both inputs are built by `withPlace` (optional `lat`/`lon`, together, inside a box around Israel); `outfit_log` plans its day at that place. A point outside Israel is `invalid_input` with `OUTSIDE_ISRAEL_MESSAGE`. Tool descriptions say to pass the same place to both.
- Spec: PRD 7.1 names the two gaps left on purpose (the server has no stored calendar when Hebcal fails; without a place it uses the default city's candle lighting).
- Tests: 2 Deno tests (Paris refused by both tools with no database request; `outfit_log` asks the calendar for the place it is given).
- Look at: the next `mcp` deploy.

## 2026-11-25 (mcp function deployed: day rules, R2 images, day in force)

- What: the `mcp` Edge Function on the live project (the one created 2026-11-24) went from version 7 to version 8, built from `main` at the merge of PR #62. It carries PR #51 (the app's day rules), the R2 garment images from PR #58, and PR #62 (the day in force). Roy approved the deploy.
- How: `supabase functions deploy mcp --use-api --no-verify-jwt --import-map supabase/functions/deno.json`. Without `--import-map` the upload is refused (`jose` does not resolve), and nothing changes. JWT verification stays off, as before: the function does its own OAuth.
- Checked: the bundle from `scripts/bundle-mcp.sh` booted locally first; after the deploy an unauthenticated request answers 401 with `WWW-Authenticate` pointing to `/.well-known/oauth-protected-resource`, which answers 200.
- Not checked: a signed-in call from Claude.
- Look at: ask Claude for today's outfit; on a Friday afternoon it should be for Shabbat.

## 2026-11-25 (Background removal on Cloudflare Images, Modal as fallback)

- Why: the Modal worker stopped on 2026-11-18 (its $1 credit ran out; it resets 2026-12-01), so new garments kept the plain crop. Roy wanted it working the same day, without a card.
- Tested live first on Roy's photos with a temporary Worker (deleted): Cloudflare Images `segment: "foreground"` is BiRefNet, the model Modal ran; 2-4 s a cutout; on the coat the result matched Modal's. It keeps clothes hanging behind the garment (no SAM). One transient Images error in six calls passed on retry.
- `worker/cloudflare/index.js` + `wrangler.jsonc`: the `fit-check-cutout` Worker (Images binding; segment, trim, at most 2048 px; `?op=thumb` for the 400 px thumbnail; bearer token; quota error 9422 answered as 429). Deployed and checked live.
- `_shared/ai/cloudflare.ts` (`cutoutCloudflare`), `_shared/ai/background.ts` (`removeBackground`: Cloudflare first, Modal when Cloudflare is unset, capped or failed; every call logged to `ai_calls`, provider `cloudflare`, cost 0), `log.ts` `countModelCalls`. Cap in code: 2,400 Cloudflare cutouts a month (the free 5,000 transformations, two per cutout).
- `intake-cutout` and the `mcp` tools use `removeBackground`; `intake-cutout` allows 80 a day (was 40, sized to Modal). New reason `cutout_monthly_limit` with he/en text, not retryable.
- Isolation: no free replacement for SAM exists today (Gemini masks retired, none in 3.x; no segmentation model on Workers AI). A cutout with a neighbour's sleeve is fixed by the redraw on request.
- Docs: `CLAUDE.md` (Stack, layout, Do not), `docs/PRD.md` intake step 3, `worker/README.md`, `_shared/ai/README.md`.
- Look at: after the deploy, add a garment from a closet photo and the re-cut on an item; `ai_calls` rows with provider `cloudflare`.

## 2026-11-25 (supabase/config.toml no longer names the old project)

- Why: `project_id` still held the first project's ref (`ftjerbwrzjprfikxkukj`) after the move to a new Supabase project on 2026-11-24, so the file read as pointing at a project that is no longer live. The field only names the local stack; the remote project comes from `supabase link`.
- `supabase/config.toml`: `project_id = "fit-check"`, with a comment saying where the remote project is chosen. Older entries below keep the ref they had.
- Look at: `supabase link --project-ref <live ref>` before `pnpm db:push`.

## 2026-11-25 (The MCP server records on the day in force, as the app)

- Why: from three hours before candle lighting the app records a wear on Shabbat's or the holiday's date, but `outfit_today` and `outfit_log` without a date used the civil date. "I'm wearing it" told to Claude at 16:00 on a Friday was logged as Friday's weekday wear, so the Shabbat look stayed unworn. Found by the independent review of PR #51.
- `apps/mobile/src/data/shabbatTimes.ts` moved (`git mv`) to `packages/schema/src/shabbat-times.ts`; the app file re-exports it, so no app import changed.
- `supabase/functions/mcp/outfit.ts`: `dayInForce` (the app's rule over `phoneFreeChain` and `defaultTab`) for calls with neither `date` nor `day_type`; the answer carries `date_note` and `today` when the day moved. `sharedCalendar` reuses the first Hebcal answer, so planning Shabbat from Friday is still one request. Tool descriptions say so.
- Tests: 5 Deno tests (Friday before and after the three hours, Friday already worn, a two-day holiday, staying on today with observance off, a failed calendar or an explicit date or day type, one Hebcal request).
- Spec: PRD 7.1.
- Look at: on a Friday afternoon, ask Claude for today's outfit; it should say the look is for Shabbat.

## 2026-11-25 (The mcp deploy bundle builds again)

- Why: `scripts/bundle-mcp.sh` failed with `Could not resolve "aws4fetch"` since the R2 change (PR #58) made `_shared/objects.ts` import it; the script aliases each npm import and had no alias for it, so the documented deploy path for the `mcp` function could not build. Found by the independent review of PR #51.
- `scripts/bundle-mcp.sh`: `--alias:aws4fetch=npm:aws4fetch@1.0.20` (the version in `supabase/functions/deno.json`), and a comment that every npm import needs its alias.
- Checked: the script builds (91.8 KB) and its escape guard passes. Nothing deployed.
- Look at: the next `mcp` deploy.

## 2026-11-20, merged 2026-11-25 (The server's outfit_today follows the app's rules; NOT deployed)

- Why: the `mcp` function's engine bundle predated the date no-repeat rule, the Yom Kippur `unknown` shoe rule and the saved-outfit bonus, and `outfit_today` still let a calendar occasion beat Shabbat or a holiday.
- One rule for both: `planDay`, `occasionMayApply`, `occasionInEffect`, `dayTypeFor`, `ruleSetOf`, `hebcalDayFacts` and `calendarAnswerUsable` in `packages/schema/src/day-context.ts`. The app re-exports the moved functions where it read them; its tests are unchanged and pass. Table-driven test `day-rule.test.ts`; `apps/mobile/src/data/hebcalParity.test.ts` checks the server's Hebcal reading against the app's on every real fixture.
- `supabase/functions/_shared/engine.js` rebuilt with `scripts/bundle-engine.sh`; `scripts/engine-bundle.test.ts` rebuilds it into a temp file and fails `pnpm test` when the committed copy is stale.
- `outfit_today` (`supabase/functions/mcp/outfit.ts`): Shabbat and holidays until havdalah, the occasion after it; wears read with their context; Yom Kippur rules with a `shoes_note` when no shoe qualifies; saved outfits through `withSavedPairs`; at most 8 candidates. Hebcal is asked with a 5 s timeout; without it the civil calendar is used and the answer carries `warning: {code: "hebrew_calendar_unavailable", message}`. Strict zod inputs with typed errors. `outfit_log` records the context the same rule gives the date. No AI call in either tool.
- Look at: `mcp/outfit_test.ts` (real supabase-js over a fake PostgREST that refuses reads without the caller's `user_id`), the tool descriptions in `mcp/tools.ts`, `context_set`'s `effect` text.
- Deploy bundle built (guard passed), sha256 `52590e0b0e2c5a4c41512fba595d32723d00cd796184bdee5f1089c5cde61678`; NOT deployed: the deploy waits for Roy's approval.

## 2026-11-25 (Background-removal worker sized to Modal's $1 credit)

- Why: Modal stopped the worker on 2026-11-18 when the month's credit ran out. The credit without a card is $1, not the $30 the docs said. The code had no idle cost (no `min_containers`, no GPU, no schedule); the $1.01 was 145 cutouts, billed for each container's whole life: about 3.6x the $0.28 logged, because every burst of photos paid a 120 s idle tail on 8 cores and 8 GiB.
- `worker/app.py`: `Cutter` scales down 20 s after the last call instead of 120 s; the unused `Embedder` (FashionCLIP; embeddings are planned on `gemini-embedding-2`, TASKS 5.5), its image and the `fit-check-models` volume reference are gone. Memory stays at 8 GiB (not testable from here).
- `intake-cutout`: 40 cutouts a day instead of 400, so one heavy day cannot spend the month.
- Docs: `worker/README.md` (cost), `CLAUDE.md` Stack (ML worker), `_shared/ai/modal.ts` and `_shared/ai/README.md`.
- Look at: after `modal deploy worker/app.py` (Roy's computer; the workspace accepts it from 2026-12-01), Modal's Usage page for a few days of normal use: the cost per cutout should drop well below November's.

## 2026-11-25 (Repository polish before the repo goes public)

- Why: Roy is making the repo public. The README told readers to put `.env.local` at the root (Expo reads it from `apps/mobile`), `.env.example` named variables the code does not read, `pnpm test` did not run the Deno tests that `CLAUDE.md` said it ran, and nothing ran checks on a pull request.
- `docs/REPO_AUDIT.md`: what the project is, architecture, baseline (834 vitest + 50 Deno tests pass, web export builds), findings, and what becomes public with the history.
- Moves (`git mv`): `docs/redesign-checklist-*.md` to `docs/verification/`, `docs/KICKOFF_PROMPT.md` to `docs/archive/`. Older entries below keep the paths of their time.
- `.env.example` lists every variable the code reads (`MODAL_CUTOUT_URL`, `GEMINI_IMAGE_API_KEY`, `R2_*`), grouped by where it is set, with placeholders only (Roy: no real values in env files in the repo); the unused home coordinates are gone.
- `pnpm test:functions` runs the Deno tests; `.github/workflows/ci.yml` runs typecheck, lint, vitest and Deno tests on pull requests and `main`.
- README rewritten with real-wardrobe screenshots (`docs/assets/`), `CONTRIBUTING.md`, `.github/pull_request_template.md`, `.editorconfig`, root `.gitignore` entries, module headers on the engine and schema entry points.
- `LICENSE`: MIT (Roy, 2026-11-25). GitHub description and topics are approved but set by hand (values in `what-changed.md`).
- Not changed: `supabase/functions/_shared/engine.js` is stale (PR #51 rebuilds it), the design-preview path is still in place.
- Look at: the README on GitHub (badges, Mermaid diagram, screenshots), the first CI run on the pull request.

## 2026-11-24 (Edge Functions store garment images in R2)

- Why: the app reads garment images from R2 since 2026-11-22, but the functions still wrote every new cutout, thumb, redraw and separated garment to Supabase Storage, and read garment images only from there. New images kept costing Supabase egress (and a second overrun restricts the project with no grace period), and try-on, redraw, re-cut and Claude's item images failed for the restored items whose files exist only in R2.
- `supabase/functions/_shared/objects.ts` (`garmentStore`, `r2ConfigFromEnv`), tested in `objects_test.ts` (7 Deno tests): R2 over its S3 API with `aws4fetch` (added to `deno.json`), immutable one-year cache; reads fall back to the Supabase `cutouts` bucket; a failed R2 write lands in Supabase; without all five `R2_*` function secrets it is Supabase alone.
- Callers: `intake-cutout`, `intake-separate` (enhance), `intake-tag`, `tryon/store.ts`, `mcp/tools.ts` (`garmentsOf`, `publicUrl`), `mcp/outfit.ts`, `mcp/photos.ts`. The pending queue, `originals` and try-on images stay in Supabase.
- Spec: `CLAUDE.md` Stack and `docs/PRD.md` (intake step 3, Storage) now say where garment images live.
- Look at: after the `R2_*` secrets are set, add a garment and check its cutout appears in the R2 bucket, not in Supabase Storage.

## 2026-11-24 (Signed-out visitors land on sign-in, not the privacy policy)

- Why: after the privacy page shipped, a signed-out visit to `/` or `/wardrobe` on the live site landed on `/privacy`. When a `Stack.Protected` guard fails, Expo Router falls back to the first unguarded screen in its sort order, and `privacy` sorts before `sign-in`.
- `app/_layout.tsx`: both guards name their target (`redirectTo="/sign-in"` for the signed-in screens, `redirectTo="/"` for sign-in), so adding another public screen can never change where a guard sends people.
- Look at: signed out, open `/`, `/wardrobe` and `/item/<id>` (all go to sign-in) and `/privacy` (stays).

## 2026-11-24 (Public privacy policy page)

- Why: Google Auth Platform does not publish an External app without a working privacy policy link in Branding, and an unpublished app lets only listed test users sign in.
- `app/privacy.tsx`: the policy at `/privacy`, outside both route guards (signed-out visitors and Google's reviewers reach it). Text in `locales/{he,en}.json` under `privacy.*`: what is kept, Google Limited Use, each provider and its job, location stays on the device, deletion within 30 days by email, cutout photos are public by unguessable address. Contact: Roy Carmelli, his Gmail. Every paragraph has an explicit writing direction (a Hebrew paragraph opening with "Fit Check" was laid out left to right).
- `app/sign-in.tsx`: a "מדיניות פרטיות" link under the Google button (web: `/privacy`; native: the app's own scheme).
- Look at: `design/screens/2026-11-24-privacy-*.png`, `2026-11-24-sign-in-390-he.png`.

## 2026-11-24 (Garment images fall back to Supabase when R2 does not have them)

- Why: the Supabase project is restricted for cached egress, and Roy chose a new free project to get the app working today. The images that existed on 2026-11-22 are in R2 (`fit-check-cutouts`, same keys), but uploads still go to Supabase Storage, so with `EXPO_PUBLIC_R2_PUBLIC_URL` set a garment added after the move would show nothing.
- `components/item-art/cutoutSource.ts` (pure, tested): `cutoutUrls` gives R2 as the primary address and Supabase as the fallback; `shownUri` picks the fallback once the primary failed, keyed by address so recycled tiles reset by themselves.
- `ItemArt.tsx`: `useCutoutSource` (address + `onError`) used by `Tile`, `FlatLay`, `ItemArt` and `ItemView`; `cutoutSources` for non-hook callers. `PhotoTile` takes `fallbackUri` and the duplicate card in `GarmentReview` passes it.
- Look at: a garment added after the move on the wardrobe grid and the item screen, with `EXPO_PUBLIC_R2_PUBLIC_URL` set.

## 2026-11-24 (AI layer README matches the code)

- Why: `supabase/functions/_shared/ai/README.md` still said "Not written yet" for files that have run in production since 2026-11-08, and named Gemini 2.5 Flash Image, which is no longer used.
- The README is now a table of every file, its exports, the model id in the code, and the function that calls it, plus what is not built (`extractReceipt`, `/embed`) and the rules. Checked against the code on 2026-11-24.
- Docs only; no code changed.
- Look at: `supabase/functions/_shared/ai/README.md`.

## 2026-11-24 (README for a first-time reader)

- Why: the README was 15 lines that pointed at the spec files. A reader (or a code-reviewing agent) could not tell what the app does, how it is built or what state it is in.
- `README.md`: what it does, three screenshots from `design/screens/` (a rainy Friday, an ordinary weekday, the wardrobe; each outfit matches the forecast printed above it), an architecture diagram (Mermaid) and table, the design decisions with the files that hold them, the cached-egress incident of 2026-11-22, an honest status (built vs stubs: `generate-daily`, `precheck`, embeddings), how to run and test, how the repo is worked on with Claude Code.
- Every claim was checked against the code on 2026-11-24 (17 MCP tools in `mcp/tools.ts`, model ids in `_shared/ai/`, stubs returning 501).
- Look at: `README.md` on GitHub (the Mermaid diagram and the screenshot table render only there).

## 2026-11-24 (Docs moved under docs/)

- Why: the repo root held about 350 KB of working documents (CHANGELOG, DESIGN, PRD, TASKS, KICKOFF_PROMPT), so a reader landing on the repo saw notes before code.
- `PRD.md`, `DESIGN.md`, `TASKS.md`, `CHANGELOG.md` and `KICKOFF_PROMPT.md` moved to `docs/` with `git mv` (history kept). `CLAUDE.md` stays at the root, where Claude Code reads it; its paths and the repo layout now point to `docs/`. `README.md` links updated.
- Nothing reads these files by path (no script, test or config), so no code changed. Code comments that name "DESIGN.md section N" still name the same document.
- Look at: `CLAUDE.md` (layout block, Design rules, Workflow 2 and 4).

## 2026-11-22 (Cached Egress fixes and Cloudflare R2 read support)

- Why: the `cutouts` bucket burned through 42.77 GB of Supabase Cached Egress on the Free tier due to missing 1-year `cacheControl` headers on uploads (defaulting to 3600 s), missing `cachePolicy="memory-disk"` on `ItemArt` and `PhotoTile`, full cutouts loaded in wardrobe grid tiles instead of `thumb_path`, unthrottled focus reloads and up-to-100 simultaneous thumbnails in `PendingQueue`, and short 10-minute signed URLs in `tryon`.
- Client (`ItemArt.tsx`, `PhotoTile.tsx`, `Tile.tsx`, `packages/schema/src/{item,db}.ts`, `app/item/[id].tsx`): `cutoutUrl()` reads `EXPO_PUBLIC_R2_PUBLIC_URL` when set (falling back to Supabase `cutouts`); `ItemArt` and `PhotoTile` add `cachePolicy="memory-disk"` and `recyclingKey`; `ITEM_READ_COLUMNS`, `ItemRowSchema` and `ItemSchema` include optional `thumb_path` so `Tile` prefers `thumb_path ?? cutout_path` for grid and mini tiles while hero tiles and `FlatLay` keep the full `cutout_path`.
- Pending queue (`usePendingQueue.ts`, `PendingQueue.tsx`, `locales/{en,he}.json`): 30-second focus throttle on `usePendingQueue` (manual `reload()` stays immediate); progressive loading in `PendingQueue` (12 thumbnails initially with "Show more" / "הצג עוד" in batches of 12, keeping `PENDING_LIMIT = 100` in `data/intake.ts`).
- Storage & Edge Functions (`data/intake.ts`, `supabase/functions/{intake-cutout/index,intake-separate/index,mcp/photos,tryon/store}.ts`, `tryon/handler.ts`): added `cacheControl: "31536000"` to all uploads and raised `SIGNED_URL_TTL_S` from `600` to `86400` (updated `tryon/handler_test.ts`).
- Worker (`worker/app.py`): added `_webp_b64` (`cutout_webp_b64` at quality 85, `thumb_webp_b64` at quality 80) alongside PNG outputs for backwards compatibility.
- Look at: `ItemArt.tsx` (`cutoutUrl`), `Tile.tsx` (`imagePath`), `PendingQueue.tsx`, `usePendingQueue.ts`, `worker/app.py`.

## 2026-11-20 (Today's frame never waits on an outside service)

- Why: the independent check of the weather wait measured two holes. Hebcal had no timeout: answering at 3 s put the first outfit at 3.5 s, never answering kept Today on the loading line forever. And a stored forecast that left nothing to suggest kept the whole screen (no date, weather or tabs) on the loading line until the fresh request settled, up to 8 s.
- The frame first (`features/today/TodayFrame.tsx`, `Masthead.tsx`, `frameLayout.ts`; `components/ui/FlatLayPlaceholder.tsx`, `ACTION_BAR_HEIGHT`): as soon as the location and what is stored are read, Today draws the title, the civil date, the place, the tabs once a planned day is known (a Friday's Shabbat from the weekday) and the hero's place at its final size (the bar's height reserved), pulsing, with "טוען". Each line fills in place: the Hebrew date, the times row (held empty on Friday and Saturday only), the weather line (held empty while its request is pending with nothing stored). TodayView uses the same masthead and measures and no longer fades the masthead in a second time.
- The calendar (`data/calendarWindow.ts`, pure and tested; `data/dayContext.ts`): one Hebcal events request and one converter request cover 60 days ahead and are stored per place; a stored window that covers the date is used at once with no "old" label and renewed in the background at most twice a day. Both requests have an 8 s timeout. `loadDayContext` builds the day from the device first and delivers it again as each source settles (`DayContext.calendar`: known, pending, startedAt; `observes`). Without the calendar, `civilCalendar` gives only what the civil calendar says. Nothing about a Hebrew date, a holiday or a candle time is computed locally.
- The bounded waits (`features/today/learning.ts`, tested): `CALENDAR_GRACE_MS` = 2500 and `firstCalendar`; `firstSuggestion` composes the saved list, the weather and the calendar, each from its own start; the two requests start together, so the worst case is max(other inputs + 1.5 s, request start + 2.5 s). With the observance switch off the calendar is not waited for.
- A late calendar never re-ranks the outfit on screen: TodayView holds each tab's rules (day type, Yom Kippur, festive) in force with its forecast (`Conditions`, same `nextWeatherInForce`). `rulesStillFit` (`outfit.ts`, tested on the fixture wardrobe) decides whether "הלוח העברי נטען" offers "עדכן את ההצעה". The calendar line ("הלוח העברי לא נטען. אם היום חג או ערב חג, ההצעה לא מתאימה." with "נסה שוב", Saturday its own words) turns into "הלוח העברי נטען" in place, so the hero does not move.
- The empty-day wait: the frame stays (dates, weather with its stored-forecast note, tabs) and only the hero waits, saying "מחכה לתחזית עדכנית"; at the request's 8 s timeout the empty state is the answer, as before.
- Today and the saved outfit's screen read the records up to date + 3 whatever the chain is, so a chain that arrives late does not re-read the history and blank the screen. The opening tab is decided once in the container (dayInForce) and a tab chosen in the frame is kept.
- Measured (web export of main 239c3ee and of this branch, preview data, Hebcal and Open-Meteo answered by the test from saved real responses, 390 Hebrew, 5 clean loads each, medians; frame / first outfit): both fast (200 ms) main 0.95 / 0.95 s, branch 0.30 / 0.91 s; Hebcal at 3 s main 3.40 / 3.40, branch 0.31 / 2.87; Hebcal never, nothing stored: main never / never, branch 0.31 / 2.89; Hebcal never, yesterday's window stored: main never / never, branch 0.32 / 1.04; Open-Meteo never with a stored forecast that empties the day: main 8.31 / none (empty state), branch 0.31 / none, with "מחכה לתחזית עדכנית" from 2.5 s to 8 s; both never: main never, branch 0.30 / 2.88. One outfit shown per load and one stylist request in every case on both builds; the outfit on screen never changed by itself.
- Look at: `app/(tabs)/index.tsx` (the gate, the frame), `TodayView.tsx` (`Conditions`, `calendarMissingLine`, `placeholder`), screenshots `design/screens/2026-11-20-today-frame-*-390-he.png`.
- Fix round after the independent check (108 settled screens identical to main, no blocker). MAJOR: "נסה שוב" did nothing while the first request still hung (the request is shared until it settles). The line now follows the request (`features/today/calendarLine.ts`, pure and tested): in flight, "הלוח העברי עדיין נטען. אם היום חג או ערב חג, ההצעה לא מתאימה." with no button; failed or timed out, "הלוח העברי לא נטען. ..." with "נסה שוב", which starts a new request at once and brings back "עדיין נטען" while it runs. Same box for both wordings: 350x44 at 390 and 320x44 at 360 in Hebrew (two lines each), 350x66 and 320x66 in English (three lines each). Measured second by second (Wed 25.11, nothing stored): never answering, "עדיין נטען" from 2.5 s to 8 s with no button, then "לא נטען" with the button; failing at once, "לא נטען" from the first outfit and a press sends a second request; failing at 3 s, "עדיין נטען" at 2.5 s, "לא נטען" from 3 s; a retry that answers in 1.5 s, "עדיין נטען" then "הלוח העברי נטען"; a retry that fails in 2 s, "עדיין נטען" then "לא נטען" again.
- An empty calendar is a failed one (`calendarAnswerUsable`, `hebrewDatesUsable` in `data/calendarWindow.ts`, tested): a Hebcal answer for seven days or more with no candle-lighting item passes the schema but is no calendar, so it is not stored and the warning line applies. The converter had the same hole for the Hebrew date (an empty `hdates` would have been stored as a 60-day window); an answer without the date asked for now fails too. DESIGN.md says that a Friday with no calendar opens on "היום" at any hour; TASKS 4.11 records what is known and left.

## 2026-11-20 (Today does not wait more than 2.5 s for the weather)

- Why: on the live site, 3 of 8 cold loads showed nothing for 10.6 to 11.2 s because the Open-Meteo request failed after about 10 s and the whole day (date, Shabbat times, planned tabs, outfit) waited for it.
- `data/dayContext.ts`: the day no longer waits for the forecast's network request. A stored forecast younger than 3 h is used as before; otherwise the stored one (up to 24 h, same place) stands in while the request runs, and `useDayContext` delivers the day again when it settles. The request now has an 8 s timeout (it had none; the 10 s was the browser's own failure). `DayContext.forecast` says where the weather is from (`fresh` / `cached` with its time / `none`) and when the request started.
- `features/today/learning.ts` (pure, tested): `WEATHER_GRACE_MS` = 2500 and `firstWeather`; `firstSuggestion` composes it with the saved-list grace, each measured from its own start, so the first outfit comes at max(other inputs + 1.5 s, forecast start + 2.5 s), never the sum. `nextWeatherInForce`: the forecast the outfit is planned with changes only on a new skip, a nudge, a tab change, an occasion change or "update the suggestion"; an undo keeps it.
- Engine `fitsWeather` (pure, tested) and `weatherStillFits` in `features/today/outfit.ts`: when a late forecast makes the outfit on screen fail the engine's own weather filter, Today shows one `info` line "התחזית התעדכנה" with "עדכן את ההצעה". A ranking change alone says nothing. Rain alone is not a hard rule in the engine, so it does not raise the line. A day left empty by the older forecast takes the new one at once (found in the browser check).
- The weather line says "לפי תחזית מ-HH:MM" (or "מאתמול, HH:MM") beside the place while an older forecast is in force; the numbers update as soon as the fresh forecast lands; the outfit does not.
- Measured (web export of main and of this branch, preview data, Open-Meteo answered by the test, 390 Hebrew, 5 clean loads each, median time to first outfit): forecast at 200 ms 1.07 / 1.01 s; at 2 s 2.45 / 2.48 s; at 6 s with no cache 6.46 / 2.97 s; at 6 s with a 4 h old cache 6.46 / 2.96 s; a 2 h old cache makes no request in either (1.06 / 1.05 s); failing at once 0.99 / 0.99 s; never answering: main never drew an outfit (15 s), branch 2.93 s. One outfit per load, one stylist call, the outfit never changed by itself. Friday "לשבת" tab (clock faked to 14:30): main 6.48 s, branch 2.95 s, same outfit throughout.
- Look at: `app/(tabs)/index.tsx` (the gate), `TodayView.tsx` (`weatherState`, `forecastUpdatedLine`, `forecastAge`), screenshots `design/screens/2026-11-20-today-weather-*-390-he.png`.
- Fix round after the independent check (bound confirmed, no regression in the fast case). MAJOR: undoing a skip after a late forecast brought back a different outfit; the forecast in force is now kept per skip count and per tab (`nextWeatherInForce`, like `nextLearn`), and undo restores it (replay test on the fixture: 107+201+704+901, skip 102+303+704+901, undo 107+201+704+901 again; in the browser, on a stubbed copy that can skip, the shorts outfit planned under a warm stored forecast came back on undo under a cold fresh one, with its "התחזית התעדכנה" line). Rule change: a tab change is not a trigger; an outfit shown on a tab stays as planned while the screen is mounted, a tab not generated yet takes the freshest forecast, the "updated" line is per tab. Every printed temperature is the live one (the explanation too; the stylist's sentence is used only while its forecast is still the live one). A stored forecast that leaves the day empty keeps the loading line while the request is pending (measured: loading to 6 s, then the outfit; with no answer, loading to 8 s, then "no suggestion"). The screen-reader label isolates the forecast's time.
- Merged `origin/main` (58854f6, "לובש היום" from a saved outfit): only CHANGELOG conflicted (both entries kept); `TodayView.tsx` merged cleanly beside `DayTabs` and `dayInForce`. Re-run after the merge, median first outfit main / branch: forecast at 200 ms 1.19 / 0.95 s; never answering: never / 2.93 s; Friday "לשבת" tab (clock 14:30): 6.48 / 3.00 s with a 6 s forecast, never / 2.92 s with none.

## 2026-11-20 (A saved outfit counts every wear of its garments, stage 5.2 follow-up)

- "נלבש N פעמים · תאריך" on a tile and on the outfit screen now counts every worn wear of the same garments (the same set of item ids, any order), whichever `outfits` row the wear points at, saved or not. Before, an outfit worn on three days and then saved showed "פעם אחת", because each day had made its own row and the count used only the saved row's wears. DESIGN.md "שלב 5.2" says it in the principle paragraph.
- Decided at read time: no wear moves, no row is merged or deleted, no migration. The independent check confirmed the counts and found two majors in a first version that read the wears inside the saved list (a failed read silently showed a smaller count, and everything waiting for the list waited for the whole wear history); both are fixed by separating the tally.
- The saved list is read exactly as before: one request. The tally by garment set is its own read, `fetchWornTally` (every worn wear with its outfit's item ids, paged like Insights), and its own slice of the shared store (`features/outfits/store.ts`: `{ status: loading | ready | error, index }`, `refreshTally`, `useWornTally`, `tallyFor`). Only the collection and the outfit screen ask for it (and on focus); Today, the bookmark and the engine never do and never wait for it, so the collection draws its tiles at once and the counts arrive after.
- What the wear line shows: the tally's count and date once it answered; before the first answer, and if it never answered, an EMPTY line (the tile's caption box has a fixed height, so nothing moves when it fills; the outfit screen says only the context; a screen reader hears nothing for it). A failed or too-large (over 20,000 wears) read keeps the last good tally and shows it; it is never a smaller number and never the row's own count presented as the count. `wornMeta` takes the tally and has a third kind, `unknown`.
- After a wear or an undo anywhere, `recordWornChange(userId, { outfitId, itemIds, date }, ±1)` (store) moves the tally by garment SET at once (the date only forward on a wear), moves the row's own count as `withWornChange` does, and refreshes the tally in the background (so the date after an undo, and a wear on an unsaved row of a saved set, come right); the refresh is skipped when no screen ever asked for the tally. Today calls it from `onWornChange`, and since "לובש היום" from a saved outfit was merged so does the outfit screen (`useWearToday`): its wear, undo, replace (the corrected wear +1, the replaced wear -1, two sets in one action; the replaced wear's row may be saved or unsaved) and a wear on a planned-day tab (the date is the tab's) all move the tally by set at once and are corrected by the refresh. `retireEarlier` now moves the tally only when the replaced wear was a `worn` one. Checked on the stub at 390 Hebrew with the model rows inspected after every step: wear 3 to 4 times, date 17.11 to 20.11, same after the refresh; undo 3, date 20.11 until the refresh then 17.11; replace with the other outfit saved (both tiles right: 4 / 20.11 and 1 / 19.11) and with its wear on an unsaved row of a set that is also saved (the same); undo after a replace (this set back to 3, the replaced one stays 1: the earlier wear is not restored, as on main); a wear for Shabbat (a Friday, tab "לשבת") reads "נלבש 4 פעמים · 21.11", a future date, the same text the row's own count gave before this change; the tally read failing after a wear keeps the optimistic 4. `withWornChange` stays exported with its signature and still means the row's OWN count (`wornCount`, `wearCount`, `lastWornOn` of a `SavedOutfit` are the row's own).
- What happens to a ROW still goes by the wears that point at it: `removalAction`, `editPlan`, the builder's copy note and the undo check use `wearCount`. So an outfit saved from a never-worn build is deleted (not unsaved) on removal even if its garments were worn before on other rows; those wears stay in Insights and still count for the set. Two wears on the same date count as two (the table has no one-per-day key).
- Look at: `data/outfits.ts` `fetchWornTally` (failure modes in its TSDoc), the tally slice in `store.ts` and `store.test.ts`, `withTallyChange` / `wornTallyOf` in `data/savedOutfit.ts`. Checked in the web build at 390, Hebrew, on a stubbed copy outside the repo (an in-memory `outfits` / `outfit_items` / `wears` model running the real data layer; no write left the browser), against a build of main: with the tally delayed 3 s the tile is visible after 0.4 s with an empty line, the count arrives at 3.2 s, and the tile box is identical before and after (175 x 266.75 at the same position); a tally failing on the first load leaves the line empty; a good tally followed by a failing focus read keeps the number; Today never reads the tally and its time to the first outfit is the same as main's (same bimodal spread in all three builds, so the delay is not what moves it); requests: Today open, a save from Today and a save from Insights equal main's, the collection and a cold outfit screen are main's plus one `wears` read. Unverified: a wear or undo on Today (the preview blocks the write; covered by the store tests), the live counts on the real database, native.


## 2026-11-20 ("לובש היום" from a saved outfit, stage 5.2 pull request 5)

- The outfit screen's one accent: "לובש היום" in a floating bar (in the column on desktop). It records today's wear as one `wears` row on the saved outfit (`recordWearOfSaved`, now exported; no `outfits` row is written or changed, no score invented) through Today's own hook: `useFeedback.wearSaved` learns the pairs and moves due garments to the laundry exactly as "לובש", and Today's lines follow in Today's words ("נרשם: זה מה שלבשת היום." with "ביטול", "הועבר לכביסה" with "אל תעביר לכביסה"). Undo deletes only the wear (the saved outfit stays), unlearns and brings the laundry home.
- Already worn today in this outfit (same garments, from here or from Today): the recorded line, no bar, on load too. Worn today in another outfit: the button opens one `Sheet` ("היום כבר נרשם לוק אחר. להחליף אותו בלוק הזה?", "להחליף" / "ביטול"); confirming runs the correction after wearing (`useFeedback.correctToSaved`: this wear first, laundry, the earlier wear deleted, unlearned). Undo afterwards does what Today's undo after a correction does: this wear and its laundry go, the earlier one is not restored.
- A deleted or archived garment: no bar and one meta line saying why (an archived garment would otherwise be counted and laundered). A garment away keeps its info line and the button stays.
- Today agrees without a reload: each feedback hook re-reads its history when another screen writes a wear, and the day's laundry set is one shared state (`data/feedbackSync.ts`), so Today shows the outfit worn with its laundry line and its undo brings that laundry home. The collection's count and date follow through the outfits store.
- Fix after the independent verification (blocker): the screen records for the day in force by Today's own rule, now one shared pure function `dayInForce` (`features/today/dayInForce.ts`) that Today's opening tab calls too (Today's rows unchanged). On Friday evening for an observant user the button reads "אלבש בשבת", the wear goes on Shabbat's date, the recorded line is "נרשם: זה הלוק שלך לשבת.", and a Shabbat wear already recorded on Today shows the line or the replace step ("לשבת כבר נרשם לוק אחר..."), never a second wear. Observance off, Shabbat itself and weekdays: the civil date, "לובש היום". `plannedKeys` moved beside it so both screens use Today's words.
- Second fix (major from the second verification): a screen without tabs had no way back to today's wear once the rule moved to Shabbat (Friday 10:00: worn, re-opened, "אלבש בשבת" and no undo). The outfit screen now has Today's day tabs, extracted from `TodayView.tsx` as one piece (`features/today/DayTabs.tsx`, `dayTabKeys` and `tabKey` in `dayInForce.ts`, tested; Today renders it with the same props). The opening tab is `dayInForce`; the label, the wear's date, the recorded line with undo, the replace step and the laundry line follow the selected tab. The same outfit may be worn on Friday and for Shabbat; two wears on one day stay impossible. No planned day: no tabs, as before.
- Failure: the bar stays with an error line and "נסה שוב", recomputed from the state at that moment (`features/outfits/wearToday.ts`, pure, tested). In the design preview every write rejects, which is this path.
- Look at: `features/outfits/{useWearToday,wearToday}.ts`, `OutfitView.tsx`, `data/useFeedback.ts` (`wearSaved`, `correctToSaved`, the re-read), `data/feedbackSync.ts`; DESIGN.md "שלב 5.2" item 4 "כפי שנבנה"; screenshots `design/screens/2026-11-20-outfit-wear-*`. Unverified: real writes (checked on a stubbed copy of the web build), native.

## 2026-11-20 (The engine learns from saved and favourite outfits, stage 5.2 pull request 7)

- Engine (`packages/engine/src/saved.ts`, pure, tested): `withSavedPairs(weights, saved)` adds `FEEDBACK.saved_pair_delta` (0.1, two wears' worth) to every pair of garments inside a saved outfit, `favorite_pair_delta` (0.2, four wears) inside a favourite instead, the largest single bonus when a pair is in several saved outfits (near-copies cannot pile up), and bounds the sum of learned weight and bonus by `FEEDBACK.max_pair_weight` (1, the bound wears already had; `feedbackUpdates` now reads it from config too). No saved outfits returns the same map, so every caller that passes none, the `mcp` server included, scores exactly as before (tested to the byte).
- Effect in numbers: a whole outfit saved adds 0.1 / 2 * 0.2 = 0.01 to its score, a favourite 0.02; one garment worn yesterday costs 0.125, so "worn recently" still wins. Tested on the fixture: hard filters (weather, Shabbat, laundry), the no-repeat date rule and recency still remove a favourite; favourite >= saved >= none in score and rank; unknown ids are ignored.
- Today: the suggestion, the planned-day tabs, the swap list and a corrected wear score with the bonus; the learned weights a wear writes stay the stored ones (the bonus is never banked). The saved list in force is fixed when Today opens and taken in again only on a new skip or a nudge (an undone skip goes back to the list before it, `features/today/learning.ts`, tested), because the list is read after the first paint: taking it in on arrival re-ranked the outfit on screen and would have asked the stylist again.
- Nothing is stored: removing an outfit from the collection needs no "unlearn".
- What the bonus does in practice (independent verification): a saved outfit has no path of its own and passes every rule, but candidate scores are bunched, so among near-equal candidates the saved one comes first and a valid saved outfit is often the suggestion (one saved outfit became the top pick in about 20% of 71 fixture scenarios, a favourite 22%; with five saved, one of them in about half). Wanted, and the values stay. Saving offsets dislikes (one save cancels one dislike on a pair, a favourite two). The score and breakdown stored with a wear include the bonus; `pair_weights` do not. The earlier wording "a saved outfit is never offered as it is" was wrong and is gone from the code comments, DESIGN.md item 8 and PRD.
- Change after review (the bonus missed the morning's first suggestion): the saved list is now read alongside the wardrobe and the day (same single read), and the first suggestion waits for it at most `SAVED_LIST_GRACE_MS` (1.5 s) after everything else is in, on the existing loading line (`firstGeneration` in `features/today/learning.ts`, tested). In time: the first suggestion has the bonus. Late or failed: generated without it and taken in at the next skip or nudge, as before. The day's pick is not stored anywhere (only the stylist answer is cached, keyed by the candidate ids), so a pick made without the list is not kept for the day: the next open plans again. DESIGN.md item 8 now says when Today takes the list in, and that the item screen's "goes with" does not learn from it yet.
- Look at: `packages/engine/src/{saved,config}.ts`, `features/today/learning.ts`, `TodayView.tsx` (`scoringWeights`), `app/(tabs)/index.tsx`. Checked on a stubbed copy of the web export with the preview's real wardrobe (390, Hebrew): with the list read before Today opened, the saved outfit (8th of 8, 0.8500) became the suggestion (0.8600); with the list delayed 3 s the shown outfit did not change and no generation ran until a nudge. Unverified: real saved outfits, native, the server (`outfit_today` does not learn from saved outfits yet, TASKS 5.2g).

## 2026-11-20 (Outfits: building one by hand, editing a saved one, and the "+" choice)

- The bar's centre "+" and the desktop "הוספה" open a sheet with "בגד חדש" (the add-garment screen, as before) and "לוק חדש". Escape closes it and focus returns to the "+".
- The build screen (`/outfit/new`), presented like the outfit screen: the hero is the flat-lay itself, in the four-piece arrangement from the start, with each empty slot drawn as a rectangle (`add` and the slot's name) that opens the picker; a choice only cross-fades (180 ms, no rise; instant with reduced motion), so no other garment moves. Four legend rows, "למתי" chips (default "יום חול"), an optional name with a visible count from 30 of 40, and a floating "שמור" with the missing slots worded per combination above it. Desktop: two columns, the button in the end column.
- The picker: a tall sheet with a pinned search (name and brand, like the wardrobe's) and mini tiles of every listed garment of the slot; the wardrobe's order until another slot has a garment, then the engine's new `orderByCompatibility` (colour, formality and learned pairs; no weather or date). Not-at-home garments are dimmed with their place and can be chosen. 30 tiles, then "הצג עוד (N)". "הסר" clears a chosen slot.
- Saving: `source: "manual"`, the chosen context, today's local date. The same garments already saved open that outfit with "הלוק הזה כבר שמור"; a new one opens over the collection, so back lands there. A failure keeps everything with the reason and "נסה שוב". Leaving with changes (close, Escape, browser or Android back) asks "לצאת בלי לשמור?".
- Editing: "עריכה" in the outfit screen's "more" opens the builder filled with the outfit (a deleted garment's slot empty). `updateSavedOutfit` edits in place when the garment set is unchanged or the outfit was never shown (no wears): it inserts what the outfit gains, then deletes what it loses, then updates the row, so a failure leaves the old set or the old set plus the new garments, never part of one, and a retry finishes it. The garments of another saved outfit are refused with a line and a button that opens it.
- What was worn is never rewritten (spec owner's decision, DESIGN.md item 5): editing the garments of an outfit with any wear saves a NEW saved row (same name, favourite and exact `saved_at`, so the same place in the collection; the chosen context, `manual`, today's date) and then unsaves the old row, which keeps its garments and wears; the screen moves to the new outfit. Only the name or context, or no wears: in place. A `meta` line above "שמור" says so once a garment differs. If unsaving the old row fails, both show in the collection until "נסה שוב", which recognises the copy (same garments, same `saved_at`) and finishes instead of answering "already saved". Pure decision: `editPlan` in `data/savedOutfit.ts`, tested.
- The collection's empty state has its "לוק חדש" action. DESIGN.md "שלב 5.2" item 5 records the decisions the spec left open; section 4 lists `TextField` and the new `Sheet` props.
- Look at: `data/outfits.ts` `updateSavedOutfit` (write order and failure modes in its TSDoc, tested in `outfits.test.ts`), `features/outfits/builder.ts` (pure, tested), `packages/engine/src/compatibility.ts`. Unverified: a real write against the database (checked on a stubbed copy of the web build; the preview rejects writes), native.

## 2026-11-20 (Saving a worn outfit from Insights, stage 5.2 pull request 6)

- A bookmark at the end of every worn-outfit row in Insights "wears" (DESIGN.md "שלב 5.2" item 7): the same library `Button` `icon` as Today's (no new component was needed), 44, outline = not saved, filled = saved, labels "שמור בלוקים" / "הסר מהלוקים", `aria-pressed`, no accent. It is a sibling of the row's button, not inside it, so a press or Enter/Space never opens the row's sheet and the row still does.
- Saved is decided by garment set, not by row id (`features/insights/wearBookmark.ts`, pure, tested, on the data layer's `itemSetKey` / `findSameOutfit`): a worn row whose garments equal a saved outfit's shows filled even when the saved outfit is another row, and two rows with one set show the same state and change together (a pending state is keyed by the set). A press when not saved marks that row's own outfit (`markOutfitSaved`); when saved it removes the saved outfit of the set (`removeSavedOutfit`), which may be another row. The shared saved-outfits store is patched, so "לוקים" shows the outfit without a reload.
- Reuse: the write, optimistic state, roll-back and announcement are Today's `useBookmark`; its failure now also says whether the data layer refused the outfit itself (`unsaveable`), which Today ignores. Today's button and title row are untouched (a screenshot of the 390 title row is byte-identical before and after).
- The wears read carries the `outfits` row id (`outfit_id`, already in the preview snapshot) and `summarizeWears` returns it with every garment id and the slotted pieces a save is checked against.
- Until the saved list answers the bookmarks are disabled and drawn "not saved" (a press could not tell a saved set from an unsaved one); when it fails to load the label also says why, as on Today. The list is read on every focus of Insights.
- Failure: the bookmark rolls back and a `StatusLine` error with "נסה שוב" appears under the row that was pressed (a long list can have its top scrolled away). "נסה שוב" presses what is true now, never a replay; the line goes when the state is already what was asked. An outfit with a deleted garment says "אי אפשר לשמור את הלוק הזה: פריט ממנו נמחק." with no retry, without a write when the read already shows it.
- Fix round (independent verification: one major, three minors, recheck pending): (1) while any bookmark's write is in flight every bookmark in the list is disabled (`bookmarksDisabled`, tested), and the anchor row of the failure line is set only for an accepted press (`useBookmark.isBusy`); before, a second press was dropped silently and a failure line could land under the wrong row, whose retry then saved the first row's set. On the stub: first write succeeding leaves row 2 untouched; first write failing puts the line under row 1 and its retry writes row 1's outfit. (2) The failure remembers the pressed row's outfit id and the retry marks that row while it is listed and unsaved (`bookmarkOfKey`, tested). (3) `writeFailureKind` (pure, tested): a remove that gets `not_saved` / `not_found` has its wish met: no line, `refreshOutfits`; a save that gets `not_found` or `invalid_outfit` shows the cannot-save line with no retry. Insights' wears are not re-read on `not_found` (a re-read needs the screen's focus loader, not worth a new path; they refresh on the next focus). This also applies to Today's use of the hook (a removal of an already-gone outfit is quiet there too). (4) The bookmark's name is "שמור בלוקים: הלוק מ-{date}" / "Save to outfits: the outfit of {date}" (and the remove form), the date being the row's spoken long date ("18 בנובמבר", "November 18"), and the live announcement names it too; Today's label is unchanged.
- Known, not changed: a newly saved outfit's wear count is the wears on that row only, so the same garments worn on three days as three separate rows show "worn once" after saving.
- Look at: `features/insights/{WearsSection,InsightsView,wearBookmark}`, `data/insights.ts` (`outfit_id`), `useBookmark.ts` (`unsaveable`), strings under `insights.wears.bookmark`, screenshots `design/screens/2026-11-20-insights-bookmark-*`. Unverified: real writes (the preview rejects them; success paths ran on a stubbed copy of the web build outside the repo with every write to Supabase aborted), native.

## 2026-11-20 (Saving an outfit from Today, stage 5.2 pull request 3)

- A bookmark in Today's title row, at the end side (DESIGN.md "שלב 5.2" item 6): outline = not saved, filled = saved, library `Button` `icon` (44) with the new `bookmark` / `bookmark_fill` glyphs. Labels "שמור בלוקים" / "הסר מהלוקים" (English "Save to outfits" / "Remove from outfits"), `aria-pressed` follows the state, no accent. The title row keeps the title's own height (46 line, 44 button): the masthead and the flat-lay are identical before and after (390x844 Thursday masthead 141, hero 487x390 at top 249; Friday 167, hero 354 at 309; 360x640 hero 300; 1280x800 hero 576 at 165).
- What a press writes is decided in `features/today/bookmark.ts` (pure, tested): a suggestion that is not saved saves the outfit of the selected tab as shown, with that tab's date and context and `source` `swap` when anything was swapped, else `daily`, no name; a worn outfit whose row is not saved gets `saved_at` on that same row (`markOutfitSaved`), so no second row is made; an outfit whose garment set equals a saved one (the data layer's own order-free key) shows as saved and a press removes it (`removeSavedOutfit`: kept as an unsaved row when wears point at it); an outfit that cannot be saved (no shoes on Yom Kippur, incomplete) shows no bookmark.
- The saved outfits come from the store the collection already shares, read once after the outfit is on screen and again on every focus of Today. Until that read answers the bookmark is drawn "not saved" and disabled; it is also disabled while a wear is being written. A swap changes the garment set, so the bookmark re-evaluates at once (saved, swap: off, swap back: on).
- Optimistic: the icon changes at once and rolls back if the write fails, with an error `StatusLine` and "נסה שוב" where Today already shows a failed action (the bar for a suggestion, the status stack above the hero when worn). On success only the icon changes, plus a polite announcement "נשמר בלוקים" / "הוסר מהלוקים" (a live region on web, `announceForAccessibility` on native). A press while one is on its way is ignored.
- Wearing after saving: "לובש" and "אלבש בשבת" record the wear on the saved row (`savedOutfitId`), writing no `outfits` row; undo deletes only the wear. A save still on its way finishes before the wear is recorded. A correction whose corrected set is itself saved records on that saved row; otherwise as before, a new unsaved row. Skip is unchanged.
- The collection shows an outfit saved on Today without a reload (the store is patched with what the data layer returned), with the right wear count and date for one saved from the worn state.
- Fix round (independent verification): (1) the outfit row of EVERY answer (worn, the Shabbat wear, skipped, the corrected wear) is decided inside the write, from a settled saved list (`resolveWearRow` in `bookmark.ts`, tested for loading, ready and failed): a press waits for a save in flight and for a list still loading (up to 8 s, no new visual state: the existing busy state), a failed list is read once more, and if it still cannot be read the write fails with the existing failure line instead of recording a copy of a saved outfit; a skip of a saved outfit now points at the saved row too (the collection still counts only `worn`; undoing a skip deletes only the wear). (2) "נסה שוב" of the bookmark no longer replays the press that failed: it presses the CURRENT intent (a save that failed and was followed by a wear now marks the worn row), and a failure line whose garment set, day or wish no longer applies is not shown (`bookmarkFailureAction`). (3) A wear on a saved row, or its undo, patches the shared outfits store at once (`withWornChange`); a failed first read of the saved list is retried once after 5 s and the disabled bookmark's label says why.
- Look at: `features/today/bookmark.ts` (+ test), `useBookmark.ts`, the masthead and `wear` in `TodayView.tsx`, `FeedbackActions.wear/correct` (new trailing `savedOutfitId`), strings under `today.bookmark`, screenshots `design/screens/2026-11-20-today-bookmark-*`. Unverified: real writes (the preview rejects them; the success paths were checked on a stubbed copy of the web build with every request to the outfit tables and to `tryon` aborted), native.

## 2026-11-19 (The "על דמות" sheet and its entry on Today, stage 5.3 app side)

- A text button "על דמות" under the legend on Today (suggestion and worn state, phone and desktop, on the selected day's outfit as shown after swaps); absent when the outfit has no shoes or is incomplete. It sits below the hero and legend: the flat-lay's measured size is identical before and after (390x844 Thursday 419 high, Friday 354; 360x640 300; 1280x800 644).
- The sheet (`features/tryon/TryOnSheet.tsx`, library `Sheet`): opens with ONE free `quote`; a stored image shows at once; else the price line built from the quote's numbers and one paying button "צור תמונה" (variant `ink`, like the redraw); generating keeps the 4:5 place with the quiet pulse and no button; result with the AI note and "צור שוב" with its price; every error code has its own words, and "נסה שוב" only where a retry can change something.
- Money guards: the reducer (`features/tryon/model.ts`, tested) rejects a second paying press by identity; the request layer (`data/tryon.ts`) shares one running request per outfit, so a closed and reopened sheet attaches to it instead of offering the button; after a paying request whose answer never arrived (network, unparsable) the retry is the free `quote`, not a second payment; an expired or unloadable signed address is re-asked with `quote`, never `render`.
- Not in the design preview: both data functions return a typed "preview" result without a request, and the sheet says so with no paying button. A known-unknown balance (`month_spend_usd` null) shows the price and "היתרה החודשית לא ידועה כרגע" and hides the button; a balance below one image shows the budget line and hides it.
- Library: `PhotoTile` takes `onError` and `emptyLabel` (a still tile that says why there is no picture yet).
- Fix round (independent verification): (1) a paying request that ends WITHOUT an answer (connection lost, unreadable body, gateway 5xx, or 100 s of silence) opens a 120 s window from the moment it was SENT, per outfit, kept at module level in `data/tryon.ts` (survives closing the sheet and day tabs, not a page reload): the sheet shows the reserved place and "ייתכן שהתמונה עדיין נוצרת. בודקים שוב…", no paying button, asks the free `quote` every 15 s, shows the image as soon as a quote says cached, and when the window ends returns the ready state with "התמונה הקודמת לא הגיעה. יצירה חדשה תחויב שוב." Typed server errors are not a window. Before this, "נסה שוב" after a lost answer led back to a ready state whose press sent a second `render` (two paid images for one). (2) No retry after `provider_refused` (it says to swap a garment); the other paid retries carry the price in their label. (3) Everything under the picture has one measured height (164 at 390 wide, 204 at 360), so the picture's top is the same in every state: at 390x844 it was 383 / 289 / 349 / 297 (quoting / ready / generating / result) and is 207 in all; at 360x640 it is 166 (165 while quoting). (4) A failed or late background quote changes nothing: every accepted event bumps a sequence number and a quote answer is accepted only if nothing happened since it started. (5) When the outfit changes under the open sheet it starts over with a quote for the new garments. (6) Focus follows the state (generating line, then the picture or the failure line) and a finished image is announced. (7) Unused string removed; "not enough left" for a positive balance below one image; the garment is named once; no answer for 100 s is a lost answer.
- Look at: `features/tryon/model.ts` (+ test), `TryOnSheet.tsx`, `data/tryon.ts`, `legendBlock` in `TodayView.tsx`, strings under `tryon`, screenshots `design/screens/2026-11-19-tryon-*`. DESIGN.md "שלב 5.3" item 2 is amended to what was built.

## 2026-11-19 (Outfits: the place, the collection and the outfit screen)

- The bar keeps five places: ארון, היום, הוספה, **לוקים** (Material Symbols `style`), פרופיל; the desktop top nav changes the same way. "תובנות" is the first row of the profile and opens as a screen above the tabs with a back arrow, at the same `/insights` URL (old links land on it; back after a deep link goes to the profile). DESIGN.md "שלד" and "פרופיל ותובנות" describe this.
- "לוקים": header with count, "הכל" / "מועדפים", a grid of the new library `OutfitTile` (small unnumbered flat-lay, name or garment types, wear line, a separate 44 heart) in 2/3/4 columns. The heart is optimistic and rolls back with an error line and "נסה שוב". Loading keeps the tiles' size and pulses; empty and error states as specified, without the "לוק חדש" action until the build screen exists (pull request 4).
- The outfit screen (`/outfit/<id>`): over everything like the item screen with its fade-in; back, favourite, more; a "לא בבית עכשיו" line; Today's flat-lay with numbers, fitted by the same rule (extracted to `components/ui/flatLayFit.ts` without changing Today); the name written in place (the item screen's mechanism, generalised to an outfit name: may be empty, at most 40); for when · worn · last date; the legend, which opens the item. "הסרה מהלוקים" behind a confirm step. A deleted garment leaves its place on the flat-lay empty, keeps its numbered legend row ("נמחק מהארון") and adds an info line.
- Look at: `features/outfits/collection.ts` (pure, tested), `features/outfits/store.ts` (shared between the two screens), `useTextWriting`'s new `save(field, draft)`. Unverified: real writes (the preview rejects them; checked on a stubbed copy of the web build), native.
- After the independent check: the 24 between rows of the grid is a margin under each tile. As `rowGap` it was dropped by the web build on most paths, so the first fix never showed. Measured at 390, 360, 700 and 1280.

## 2026-11-19 (Saved outfits: migration 0007 and the data layer)

- Migration 0007 adds `outfits.name` (null, or 1-40 characters already trimmed), `is_favorite` (a favourite must be saved) and `saved_at` (in the collection exactly when not null), with a partial index for the list. Not applied yet: the lead applies it at merge. PRD 6.1 updated.
- `data/outfits.ts`: list and read saved outfits (garments as `{ slot, item }` for the flat-lay and legend, `missing` slots for a deleted garment, worn count and last date), save (the same garments in any order return the existing outfit, nothing written), save an already worn row, remove (worn: the row stays unsaved; never worn: deleted), favourite, rename. Rules and mapping in `data/savedOutfit.ts` (pure, tested); row schema in `packages/schema` `db.ts`.
- Undo of a wear no longer deletes a saved outfit, or one other wears point at (guarded in the delete itself). `recordFeedback` takes `savedOutfitId` to record a wear on an existing outfit: only a `wears` row, and a failure deletes nothing.
- Look at: `deleteFeedback` in `data/feedback.ts`, the failure modes in the TSDoc of `saveOutfit`. Unverified: the migration and every request against a real database (tests use a recording stand-in for supabase-js; the SQL was only parsed with the Postgres parser). No screen uses any of this yet.

## 2026-11-19 (Spec: outfits built by hand, saved and favourite)

- DESIGN.md "שלב 5.2": the "לוקים" place, the outfit screen, building by hand, saving from Today and from a worn outfit, what the engine learns, and the order of the seven pull requests that build it. A new library component, `OutfitTile`, is listed in section 4.
- Spec only. The navigation change, the migration and every screen come in their own pull requests.
- Look at: item 1 (navigation), item 2 (the "+" now asks garment or outfit), item 5 (what a hand-built outfit must have), item 8 (a saved outfit's pairs weigh more).

## 2026-11-19 (Profile: the observance switch on the profile)

- "שומר שבת וחג" now lives on `profile.observes_shabbat` (migration 0006) with the device copy shown at once; the profile's answer replaces it when it arrives (no row, a missing column or any read error: the device decides, logged once). A change is written to the profile (upsert, so the first write creates the row) optimistically and rolls back with an error line and "נסה שוב" when it fails (DESIGN.md "שלב 4.5" item 7).
- Look at: `data/useObservance.ts` (the only place that knows where the setting lives), `observanceFromProfile` in `data/observance.ts` (tested), the error line in `ProfileView.tsx`. Unverified: a real profile write (preview rejects writes).
- Fixes after the independent verification: a profile read that started before the user changed the switch no longer flips it back (`profileReadResult`, tested); a failed read (offline at start) is asked again on the next mount or return to the app instead of never, and a read on its way is not doubled.

## 2026-11-19 (Today: alternatives after wearing, and a tap cue)

- After "לובש" a garment still opens its sheet with up to three alternatives, under "לבשת משהו אחר?"; choosing one corrects the record in one action (undo, then wear, serialised in `useFeedback.correct`), so laundry and learning follow the corrected outfit; if the second step fails the day is back to a suggestion with the failure line. Planned-day tabs too (DESIGN.md "שלב 5.1").
- A one-time line "אפשר להקיש על כל בגד כדי להחליף אותו · הבנתי" above the hero until the first tap on a garment or "הבנתי" (device flag), measured with the hero. Legend rows end with `swap_horiz` (Material Symbols Rounded 300, svg-300@0.49.0) and read "החלפת {{name}}".
- Look at: `correct` in `data/useFeedback.ts`, the worn branch of PieceSheet's `onSwap` in `TodayView.tsx`, `LegendRow` `trailingIcon`. Unverified: the real laundry SQL after a correction; a garment moved to the laundry by a wear made before a reload is not brought back by a later correction (the laundry line is session state, as for undo).
- Fixes after the independent verification: (1) a correction records the corrected wear FIRST and only then deletes the earlier one (`retireEarlier`), so a failure never leaves the day without a record; a failed record keeps the worn look with "התיקון לא נשמר. הלבישה הקודמת נשארה."; a failed delete shows the corrected look with "הלבישה הקודמת לא נמחקה." and a retry of the delete alone; with two worn records the newest is shown (`data/correction.ts`, tested). (2) The tap hint shows only when the flat-lay keeps its floor with it (`tapHintFit`, tested), else it waits for another visit. (3) After "הבנתי" focus goes to the first legend row; legend rows read "החלפת טי-שרט: ...". (4) An archived garment in a worn outfit stays in its correction (the wardrobe holds archived items; tested).
- Second fix after the recheck (laundry after a correction): the day keeps L, the garments this wear moved to the laundry. A correction from A to B sends L's garments not in B home, moves B's due garments not in L, and keeps L = (L ∩ B) ∪ newly moved under the corrected wear; the status line names all of L and an undo brings all of it home, after any number of corrections (`laundryAfterCorrection`, tested with the verifier's sequences). Order: record, laundry, delete, unlearn: a failed record changes nothing, a failed delete leaves the laundry already matching the outfit shown, and its retry only deletes. A garment kept home with "אל תעביר לכביסה" stays home and out of L for the rest of the day. The tap hint is decided only after the day's occasion read has answered. Known leftover: after a reload with an earlier wear whose delete failed, there is no retry control and Insights counts the day twice.

## 2026-11-19 (The `tryon` function, stage 5.3 server side)

- New Edge Function `tryon` (`verify_jwt = true`): `quote` (price, month's Google spend and cap, whether a stored image exists; never costs), `render` (stored image if any, else generates), `rerender` (always generates and replaces). Zod first (`packages/schema/src/tryon.ts`: one top, one bottom, one shoes, at most one layer, no duplicate), items read with `user_id = caller` so another user's id is `item_not_found`, typed errors, CORS like the other app functions.
- `quote` also returns the stored image's signed URL (`image_url`, `expires_in_s`, present exactly when `cached`), so the sheet opens with a call that can never generate; a signing failure answers `storage_error`.
- Model `gemini-nano-banana-2.1` at 1K, 4:5, in `_shared/ai/tryon.ts`; the id, price and 4:5 checked on Google's pages the same day. No automatic retry; a timeout is logged at the estimated price. One fixed figure, drawn from text once (`tryon/figure/v1.png`), reused by every render.
- Images live in the private `originals` bucket under `tryon/{uid}/{sha256}.png` (no new bucket, no migration); the response carries a 10-minute signed URL.
- Money: `monthlyGoogleSpend` now counts the try-on model; the cap is checked as spend + this call's price, before the figure (figure + outfit together), again before the outfit, and the stored image is looked for again right before paying. Shown price about $0.055 an image (not $0.034: that is the output image alone; input images and possible thinking are added), $0.047 once for the figure.
- Look at: `supabase/functions/tryon/handler.ts`, `_shared/ai/tryon.ts` (prompts, tuck rule at formality 7), `handler_test.ts`. Built and tested with stubs only: not deployed, never called against Google, nothing spent.

## 2026-11-19 (Today: what is on today)

- The adjust sheet starts with "מה יש היום" (on a planned tab "מה יש באותו יום"): date, interview, event as chips; choosing closes the sheet and changes the look, the chosen chip clears it. The occasion shows first among the status lines above the hero ("ראיון · ראיון עבודה · מהיומן" · ביטול), measured with the hero (DESIGN.md "שלב 4.5").
- The occasion's rules override the calendar's for its date (no festive step on top); the wear is recorded in its context, the stylist request carries it and the explanation names it. Rows of `contexts` are read per date on screen (newest wins, shared schema), cached on the device, and written by hand optimistically: upsert first, then the other occasion types removed, as the MCP server does; a failure rolls back with "נסה שוב".
- Look at: `data/occasionRows.ts` (pure, tested), `data/occasions.ts`, the occasion line in `TodayView.tsx`, `AdjustSheet.tsx`. Unverified here: a real write (preview rejects writes); the MCP and the app writing the same date at the same moment.
- Fixes after the independent verification: (1) precedence corrected in DESIGN.md "שלב 4.5" items 1 and 3 and PRD 7.1: with the switch on, Shabbat and holidays keep their rules until the day's havdalah and the occasion applies only after it, never on a date without a havdalah and never on a planned day's tab (no chips, no line there); `occasionMayApply` / `occasionInEffect` in `features/today/plans.ts`, tested. The MCP server is unchanged. (2) A read that started before the user changed a date no longer overwrites that date (`mergeOccasionRead`, tested). (3) After "ביטול" on the occasion line focus goes to `tune`; its accessible name says "ביטול ההקשר: ראיון".

## 2026-11-19 (Yom Kippur: only a shoe known not to be leather)

- A shoe tagged `unknown` material is no longer offered on Yom Kippur: only one whose material is known and is not leather or suede (`YOM_KIPPUR_DENIED_SHOE_MATERIALS`). With none, the look comes without shoes and the line reads "אין בארון נעל שמסומנת כלא מעור. הלוק מוצע בלי נעליים."
- Look at: `packages/engine/src/config.ts`, `yom-kippur.test.ts` (other rule sets still give the recorded outfits).

## 2026-11-19 (Engine: a date without a name)

- A complete outfit (the same item ids) worn in one of the last three wears of a context whose rules set `no_repeat_with_key` (today only `date`) is not offered for it again (PRD 7.1, DESIGN.md "שלב 4.5" item 5). `NO_REPEAT_LAST_WEARS = 3` in `packages/engine/config.ts`; the recent wears carry an optional `context_type`; nothing about a person is stored.
- Look at: `noRepeatOutfits` in `packages/engine/src/candidates.ts`, `date-no-repeat.test.ts`. The app passes the context with each wear from "what is on today" on.
- Fix after the independent verification: the last three are chosen by date inside `noRepeatOutfits` (stable sort, newest first), not by trusting the caller's order; a test with shuffled input, and one that fails if the rule line in `generateCandidates` is removed.

## 2026-11-19 (Spec: an outfit on a figure, first slice)

- DESIGN.md "שלב 5.3": the "על דמות" entry under the legend on Today, the sheet (price and the month's remaining budget before every generation, no spinner, no automatic generation), the fixed faceless figure, and the `tryon` function's contract (quote / render / rerender, typed errors, the shared monthly cap, a row in `ai_calls`, the image stored by a hash of the item ids; no table, no migration).
- The plan said the entry sits on the saved-outfit screen; it moves to Today, which exists, so the test does not wait for round B.
- Spec only: nothing built, nothing deployed, nothing spent.

## 2026-11-19 (Try-on: decided from the research)

- The research cost nothing (web sources only). Decision: one generated image of the whole outfit on a neutral figure, on demand; per-garment on-figure renders are dropped; no separate experiment, the first slice of the feature is the test. Reasons and prices: `docs/REDESIGN_PLAN.md` "Stage 5", "Try-on".
- Side finding: `gemini-embedding-2` takes images and has a free tier; it becomes stage 5.5.
- Look at: the plan section, `TASKS.md` rows 5.3 and 5.5, the try-on line in `CLAUDE.md`. Nothing was built and nothing was spent.

## 2026-11-19 (MCP bundle survives the deploy transport)

- What failed: the first production deploy of the mcp bundle was refused ("Unterminated regexp literal"). The deploy tool carries the bundle as a JSON string; esbuild's default ASCII output had written non-ASCII characters as `\uXXXX`, and the label's single-line regex held `\u2028` / `\u2029`, which decoded to raw line terminators. Production was unchanged.
- Fix: `day-context.ts` checks line breaks by code point (no regex, no escapes); `redraw-spec.ts` `cleanFreeText` uses `\x00-\x1f` instead of `\u0000-\u001f`; `scripts/bundle-mcp.sh` passes `--charset=utf8`. `engine.js` had no escapes.
- Guard: `scripts/bundle-mcp.sh` now fails if the bundle holds a backslash-u sequence, a raw U+2028/U+2029 or a control character U+0000-U+0008.

## 2026-11-19 (Friday is for Shabbat: fixes from the independent verification)

- Day-tab change: one cross-fade in motion.state, the two looks at the same time (was a fade out then a fade in, about 440 ms: a garment's fade restarted when its old layer was cleared). The forecast line's slot is held on the today tab, so the hero keeps its box (390: 354 px at y 309 throughout, was 388 -> 354 and 275 -> 309); when status lines differ the hero keeps its size until the fade ends.
- Yom Kippur is named as itself ("ליום כיפור", "אלבש ביום כיפור") and planned by `YOM_KIPPUR_RULES` (engine config): no leather or suede shoes, any other shoe, without shoes and a line if none. Its type stays "holiday", the database enum value a wear stores. `SlotRule` gained `deny_materials` and `optional` (zod defaults only); a slot's `min_formality` replaces the coarse floor (date and interview unchanged, tested against recorded outfits).
- Day tabs follow the WAI-ARIA tabs pattern (`TextTabs` `idPrefix`, new `TabPanel`); TextTabs and CrossFade in the gallery.
- Look at: `FlatLay` Piece effect, the held size in `TodayView.tsx`, `packages/engine/src/config.ts` YOM_KIPPUR_RULES. Unverified: native; the server engine bundle (`supabase/functions/_shared/engine.js`) is not regenerated, so the MCP tools do not apply the Yom Kippur rules yet. Shoes tagged `unknown` material count as non-leather.

## 2026-11-19 (context through the MCP, observance setting on the profile)

- **NOTHING IS APPLIED OR DEPLOYED YET.** Files only, on branch `work-mcp-context`; the owner approved the migration and the tools on 2026-11-19.
- Migration `0006_profile_observance.sql`: `profile.observes_shabbat boolean not null default true`. No generated Supabase types file exists in the repo, so none to update.
- `packages/schema/src/day-context.ts`: shared zod schema of a day's context (type date | interview | event, date, label 1-60 chars one line, source manual | calendar), the date window (1 day back .. 14 ahead) and `planDay` (which rule set a day follows). 15 vitest tests.
- MCP (`supabase/functions/mcp/context.ts`, version 0.4.0): `context_set`, `context_get`, `context_clear`. One occasion per date (new row written first, then the other two occasion types deleted; readers take the newest). A calendar write over a hand-set context is refused (`manual_context_exists`). No person's name is accepted or stored; `context_key` stays null. Weekday, Shabbat, holiday, reserve and trip rows are never touched. 11 Deno tests with an in-memory fake database.
- `outfit_today`: a stored occasion beats the calendar; with `profile.observes_shabbat` false, Shabbat plans as a weekday and a holiday as a weekday plus one "dressier" step (engine `adjustRequest`). The answer has `context_used` and `calendar_day_type`. `engine.d.ts` now declares `adjustRequest` and `DayAdjustment` (the bundle already exported them).
- Workflow for the user's own assistant: `docs/mcp/daily-context-workflow.md` (Hebrew, then English).
- Look at: the walk-through of `context_set` failure cases in `supabase/functions/mcp/context_test.ts`.
- To apply, in this order: (1) merge; (2) apply `0006_profile_observance.sql`; (3) `pnpm db:types` is not needed (no types file); (4) `scripts/bundle-engine.sh` only if `packages/engine` changed since the last bundle, then `scripts/bundle-mcp.sh /tmp/mcp.bundle.js`; (5) deploy the bundle as the `mcp` function (verify_jwt off), check it boots with 401 + WWW-Authenticate, then call `context_get` from the connector. Deploying before the migration is safe: a missing column reads as "keeps Shabbat".

## 2026-11-19 (stage 4 hardening: removal, location, insights, tests)

- Item screen: "remove from the wardrobe" now follows the leave rule (`decideRemove` in `features/item/writing.ts`, tested). An open, changed, valid field is saved first (one write) and the item is archived only after that save succeeded; if it fails the item stays, the confirm sheet closes, and the field keeps its typed text, the error line and "נסה שוב". An unchanged or cancelled field does not block removal.
- Location: web reports a never-granted permission, and a prompt that was dismissed, as "prompt", which expo-location maps to `undetermined`, not `denied`; the old mount check looked only for `denied`, so the message vanished on reopening. Now `data/locationNotice.ts` (pure, tested) decides from the saved kind, the permission and whether a fix is stored: the message shows under the "my current location" row for as long as it is true, and the profile row says "מיקום נוכחי · אין הרשאה". Nothing prompts on mount; only a tap on the row does.
- Insights outfit sheet: type and Latin name are two texts (`features/insights/OutfitItemRow.tsx`), each in its own direction, so the Hebrew type sits at the start edge.
- 115 new unit tests: wardrobe filters and search, intake tag rules / failure lines / upload captions, insights summaries, the date in the location's zone, the pager. None exposed a bug.
- Look at: the remove flow with unsaved text on the item screen (browser: the preview rejects writes, so only the failing-save path was run), the location screen with the permission refused, an outfit's sheet in Hebrew.
## 2026-11-19 (Friday is for Shabbat: every phone-free day planned ahead)

- On a day with candle lighting Today shows tabs ("היום", then "לשבת" / "לחג" / "לחג א׳", "לחג ב׳") inside the measured hero block (DESIGN.md "שלב 4.1"). Each tab is its own day: Shabbat or holiday rules, its own forecast line, "אלבש בשבת" records the wear on that date (laundry at press time, undo brings it back), its own stylist request when the tab is first opened. A later day sees the earlier looks as worn; a garment recorded for a later day is not offered earlier. Opens on the planned day from three hours before candle lighting or once today is worn.
- Hebcal is asked for date..date+3 (`phoneFreeChain`, cache v5), the forecast for 4 days (cache v3). Engine: a Shabbat colour term (white top preferred; `SHABBAT_COLOR` in config) and a fix: a wear dated after `req.today` no longer lowers its garments' pre-rank.
- Profile: "שומר שבת וחג" (device setting, `useObservesShabbat` / `getObservesShabbat`). Off: no times, no tabs, no "לשבת" filter, short location hint, weekday rules; a Yom Tov is a weekday one "dressier" step up (shown in the adjust sheet).
- Look at: `features/today/plans.ts` (pure, tested), `data/shabbatTimes.ts`, `useFeedback` (one hook, `target` per action), the tab block in `TodayView.tsx`. Checked in the browser on the read-only preview (writes stubbed locally in a throwaway build).
- Unverified: native; real writes and the real `wear_counts_since_wash` SQL; the stylist's answer for a planned day (blocked in preview: the template text shows). The MCP tools do not know the observance switch. The location screen's current-location meta still mentions Shabbat times with the switch off (that row belongs to another task).

## 2026-11-19 (OpenStreetMap credit from the keyboard)

- `ui/MetaLink` is a real anchor on web (new tab, noopener): Enter, middle-click and copy-link work; native keeps Linking. Before, only a click opened it.
- The location screen now shows "no location permission" when "current" is saved but the permission was refused later (Today shows the default city then).
- Checked live: Nominatim answers with `access-control-allow-origin: *`.
## 2026-11-19 (Today: the flat-lay always fits, measured)

- Today on phones: the whole flat-lay is on screen at scroll top whatever stands above it (Friday times row, skip, worn, laundry and failure lines), per DESIGN.md section 3 "היום" item 2. The free space is measured (masthead and the status stack above the hero by size, the floating bar or, without it, the scene down to the tab bar) minus 16, instead of paddings tuned to 390 and 360.
- Below 600 the surface stays full width and gets shorter; the composition sits in a centred 4:5 frame (new optional `FlatLay` `maxHeight`; other callers unchanged). 600-899: the card cap now also works with no bar (worn, including opening already worn); the bar height resets to 0 when the bar leaves.
- Look at: the cap block in `features/today/TodayView.tsx` (`heroSpace`, `cardWidth`, `heroMaxHeight`), the frame in `components/ui/FlatLay.tsx`. Native not run (no emulator).

## 2026-11-19 (place name for the current location)

- "My current location" now shows the settlement name: Today's weather line, the profile row ("Current location · Ramat Gan") and the meta of the location screen row. Web asks Nominatim (rounded to 3 decimals, only after a move over 300 m or a language change, 3 s cap, cached on the device); native uses the device geocoder (not run here: no emulator). No name falls back to "current location" and never delays the weather.
- New `ui/MetaLink` (a meta line that opens an address, 44 hit area, in the gallery) for the OpenStreetMap credit on the location screen (web only).
- Look at: `data/placeName.ts` (pure rules, tested with real Nominatim fixtures), `placeNameFor` in `data/location.ts`, `loadDayContext` in `data/dayContext.ts`.

## 2026-11-06

- Repo scaffolded: monorepo (pnpm + turbo), `packages/schema`, `packages/engine` with tests on the real wardrobe fixture, first Supabase migration, Edge Function stubs, Modal worker stub, Expo app skeleton with i18n (he/en) and design tokens.
- Wardrobe sheet exported to `scripts/data/wardrobe.csv` (109 items) and converted to `packages/engine/__fixtures__/wardrobe.json` by `scripts/import-sheet.ts`.
- Look at: `packages/engine/src/engine.test.ts` for what the engine already guarantees; `supabase/migrations/0001_init.sql` for the schema.
- Not done yet: the "Today" screen (session 1 of Claude Code builds it), any AI call, any Supabase deploy.

## 2026-11-06 (review)

- Supabase project `ftjerbwrzjprfikxkukj` (eu-central-1) created; migrations 0001 and 0002 applied; security advisor clean.
- Engine review fixes: never-worn ordering was non-deterministic (NaN comparator), virtual items could not reach the pre-purchase check, disliked pairs lost their sign, navy was treated as a colored hue, layer formality had no upper bound, an accessory anchor dropped itself. 5 tests added (16 total).
- Open (needs a go, schema change): `match_items()` uses `auth.uid()` and returns nothing when called with the service role from an Edge Function; proposed 0003 adds a `p_user_id` parameter. Same migration could turn the duplicated hot columns on `items` into generated columns from `tags` to prevent drift.

## 2026-11-06 (session 1: Today screen)

- "Today" screen built in `apps/mobile/src/app/index.tsx` with `features/today/` (mock data from the engine on the real wardrobe fixture, weekday, 16-24C; asymmetric composition; Reanimated 4 + Gesture Handler action sheet). No Supabase, no AI.
- Screenshots in `design/screens/` are **web renders (react-native-web, Chromium, 412x915 @2x), not Android emulator captures**: the cloud session has no emulator. Native Reanimated/Gesture Handler behaviour and `I18nManager` RTL are unverified until run on a device.
- Root-cause fixes found while rendering, relevant to every later screen:
  - `className` is silently ignored on Reanimated's `Animated.View` (NativeWind). Style it inline from `tokens.ts`.
  - react-native-web resolves `start`/`end`/`marginStart` from a locale context that only a `dir` prop provides; `document.dir` alone flips flex rows but not logical props. Root layout now sets `dir`.
  - The static web export hydrates with the server's locale and window width (0) and React does not patch attributes, so SSR output won. Root layout now renders nothing until mounted.
  - Spacing scale has no `0.5`; `h-0.5` compiles to 0px.
- Mock-only, to delete when wired to `generate-daily`: the relative import of `packages/engine/__fixtures__` into the app (CLAUDE.md forbids the wardrobe in the bundle), the hardcoded Hebrew date, the static explanation string `today.explanationMock`.
- Look at: the three PNGs (closed / sheet open / English LTR); `ActionSheet.tsx` for the gesture; `OutfitComposition.tsx` for the percentage layout.
- Proposed spec edit (not applied): the DESIGN.md spring (damping 28, stiffness 320, mass 1) has damping ratio ~0.78, i.e. a ~2% overshoot, which sits uneasily next to "no bounce". Say if you want it critically damped (damping ~36).

## 2026-11-06 (session 1: spring + Wardrobe screen)

- Spring closed to `damping 36` (critically damped, no overshoot) in `tokens.ts` and DESIGN.md section 4, per review.
- "Wardrobe" screen: `apps/mobile/src/app/wardrobe.tsx` + `features/wardrobe/`. Grid grouped by category (3 columns on phone, 5 on web >= 900px, content capped at 1120), no card chrome, name in body-sm below, 280ms layout animation on the UI thread when filtering, one scrolling chip row (season, color; availability appears once data has more than one value). Filter logic is pure (`filters.ts`). Text links connect Today and Wardrobe.
- Fixture parsing moved to `src/mock/wardrobe.ts`, the single mock import to delete when screens read from Supabase.
- Screenshots (web renders again, not emulator): `design/screens/2026-11-06-wardrobe*.png`; Today re-shot for the nav link.
- Not done, on purpose: formality filter (needs a range control, not a chip), item screen and the shared-element transition, virtualization (grid renders all ~108 cells; must become a FlatList once images arrive), tests for `filters.ts` (the app has no test runner yet).
- Note: the fixture has 108 items, PRD says 109.

## 2026-11-07 (session 1: Item screen + shared-element transition)

- Item screen at `apps/mobile/src/app/item/[id].tsx` (+ `features/item/`): hero on `--ivory-deep` at 60% of the screen height, name in display-xl, tags as one running line (not chips), formality and temperature range in Plex Mono, and "goes with": up to 3 engine outfits built around the item (`getMockOutfitsWith`, anchored, weather = the item's own range, filtered to outfits that really contain it).
- Shared-element transition (DESIGN.md section 4, animation 1): the picture flies from its grid cell to the hero slot in 420ms ease-out, the ivory page fades in over the wardrobe (180ms) and the text follows 100ms later; back retraces the flight to the cell's current rect. Measured per frame in Chromium: starts on the cell rect `[276,654,116x155]`, lands on `[0,0,412x549]` at ~415ms, returns to the cell on close.
- **Deviation from CLAUDE.md ("Motion on web behind a platform split"):** one code path on Reanimated shared values instead of `sharedTransitionTag` + Motion. `sharedTransitionTag` sits behind the `ENABLE_SHARED_ELEMENT_TRANSITIONS` static flag (native rebuild) and does not exist on web; Motion is not installed. Say if you want the two-stack version.
- Things that bit, relevant to later animation work:
  - Animating `left/top/width/height` never reached the DOM on web (only opacity/transform did), so the hero is laid out once at its final rect and animated with transform + opacity only (also cheaper on native).
  - The item route mounts more than once per push, so a consume-once origin was taken by an instance that was then replaced and the survivor never flew. The origin is now keyed by item id, read without consuming, and expires after 3s (`features/item/transition.ts`).
  - Callback refs: a cell needs one ref feeding both its local measuring and the registry the item screen uses to fly back.
  - `ViewProps` has no `dir` in RN's types; the root layout spreads a typed object (see session notes above).
- Verified: web (Chromium, he/en/desktop). **Not verified:** native Reanimated behaviour (measureInWindow offsets under edge-to-edge Android, the transparentModal route on a device), hardware back on Android (handler added, untested), and deep links: a static web export has no `/item/<id>` file, so a direct URL needs a rewrite to `index.html` on the Vercel project (not set up).
- Not done on purpose: wear history (needs `wears`), edit, availability change, the item's notes (the sheet notes are raw English like "match with belt 1201"), and a "not found" screenshot.
- Screenshots: `design/screens/2026-11-07-item*.png`; `-item-transition.png` is six frames of the flight from a screen recording.

## 2026-11-07 (session 1: screens read from Supabase)

- Today, Wardrobe and Item now read the signed-in user's wardrobe and pair weights from Supabase instead of the fixture. The fixture is no longer imported by the app, so the wardrobe is out of the bundle (CLAUDE.md). Still mock, in `features/today/mock.ts`: the date, weather, Hebrew date and the explanation text (each needs Hebcal / Open-Meteo / `generate-daily`).
- Auth: Google sign-in (`features/auth/`), a session provider, and route guards in the root layout (signed out can only reach `sign-in`). Native session persistence was missing entirely (supabase-js keeps it in memory without a storage adapter); now AsyncStorage on native, localStorage on web. New deps: `@react-native-async-storage/async-storage`, `expo-web-browser`.
- Data layer (`src/data/`): one `WardrobeProvider` shared by all screens, stale-while-revalidate with a per-user cache (cache version covers format changes), quiet loading and error states with retry (`WardrobeGate`). A row that violates the tag schema is skipped and logged with its id rather than blanking the wardrobe.
- `packages/schema/src/db.ts`: the single row <-> `Item` mapping used by the app (read) and the seed script (write). 6 tests, including a round trip over all 108 real items. Hot columns are derived from `tags` on write and never read back.
- `scripts/seed-wardrobe.ts` (`pnpm seed:wardrobe`): idempotent seed of the fixture for one user. Dry run by default; `--write` needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in your shell; refuses to run if the user already has items unless `--force` (a re-seed would overwrite tags you corrected in the app).
- Verified against the live project (`ftjerbwrzjprfikxkukj`, no migration needed): anon reads of `items` return `[]`, anon writes fail with 42501, a forged JWT gets 401. In a transaction that always aborts (nothing persisted; re-checked: 0 test users, 0 items, 0 pairs afterwards) as an `authenticated` user: the owner reads exactly the app's `select`, another user sees 0 rows, a cross-user write is blocked by RLS, pair ids are ordered; those exact rows pass `itemFromRow`. In the browser: signed out shows sign-in, a forged session reaches the real 401 and shows the retry state.
- **Blocking, and yours:**
  1. Google sign-in is NOT enabled on the project (`Unsupported provider: provider is not enabled`). Create a Google OAuth client, enable the provider in Supabase (Authentication > Providers), and add the redirect URLs: `fitcheck://auth` (native, already in `config.toml`) and the web origin you deploy to (`http://localhost:8081` for local web).
  2. Sign in once, copy your user id (Authentication > Users), then: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm seed:wardrobe -- --user-id <uuid> --write`.
  3. Copy `apps/mobile/.env.example` to `.env.local` (I created one here for the cloud session; it is gitignored and holds only the public key).
- **Not verified:** a successful sign-in end to end, the signed-in screens against real rows, the native OAuth round trip (`openAuthSessionAsync` + PKCE code exchange), and session persistence on a device. Everything on the path up to the Google redirect and from the database to the parsed `Item` is verified; the middle is not.
- Known rough edge: on web, if the provider is misconfigured the browser lands on Supabase's raw JSON error page, because the redirect happens in the browser before the app can catch it.
- Not done: the pre-existing `match_items()` service-role bug and the generated-columns idea (proposed in the earlier review, still needs your go: schema change).

## 2026-11-08 (correction: sign-in flow type)

- **Bug fixed:** supabase-js 2.119 defaults to the `implicit` OAuth flow (tokens in the URL hash), but `features/auth/signIn.ts` on native exchanges a PKCE `?code=`. Native sign-in would have reported "failed" on every attempt. `createClient` now sets `flowType: "pkce"`; verified in the built web app that the authorize request carries `code_challenge` (`s256`). Web was unaffected either way (`detectSessionInUrl` handles both). The native round trip is still unverified on a device.
- **Correction to the entry above:** `config.toml`'s `additional_redirect_urls` only applies to the LOCAL Supabase stack. The hosted project's redirect allow-list is set in the dashboard (Authentication > URL Configuration), so `fitcheck://auth` is not configured there yet.

## 2026-11-08 (dev-mode overlay on web)

- **Bug fixed:** in the dev server (`pnpm --filter mobile web`) a full-screen red "Uncaught Error: Cannot manually set color scheme, as dark mode is type 'media'" covered the app on every load, so it looked like the app did not open. NativeWind's web stylesheet observer calls `colorScheme.set()`, which throws under its default `darkMode: "media"`. `tailwind.config.js` now sets `darkMode: "class"` (we are light-only and use no `dark:` variants, so nothing changes visually). It never appeared in my earlier checks because those ran against `expo export` builds, not the dev server; reproduced in a dev server and verified gone (no console errors, no overlay).
- **Known, not fixed:** on native (Expo Go / Android) Hermes has no `crypto.subtle`, so supabase-js logs "WebCrypto API is not supported. Code challenge method will default to use plain instead of sha256" and uses a `plain` PKCE challenge. Sign-in still works (Supabase accepts `plain`) but it is weaker than `s256`. Needs a SHA-256 digest polyfill (expo-crypto) before this ships on a phone. On web it only appears when the page is opened from a non-secure origin such as the LAN IP; use `http://localhost:8081`.

## 2026-11-08 (plan + engine v2 part 1 + item drawings)

- `docs/PLAN.md`: the full plan (design, engine v2, AI stylist and modes, intake, calendar, shopping, phone), built from four research passes. Includes proposed PRD/DESIGN corrections (the default city's Hebcal geonameid, current Claude/Gemini models, no `temperature` param) and the decisions still open.
- Items are drawn as technical flats in their real colour and pattern (`components/item-art/`, react-native-svg) on all three screens. Set: `design/screens/2026-11-08-item-art-set.png`.
- Engine fixes, each reproduced with a failing test against the real wardrobe first (`candidates.v2.test.ts`, 11 tests):
  - **Cold start offered only T-shirts.** Pre-ranking sorted by recency then id and kept 6, so the 24 button-downs never appeared. Now ranked by fit to the context and interleaved across subcategories.
  - **A warm date had no shoes.** Formality was checked per item; now it is the outfit's slot-weighted mean (top/bottom .35, shoes .2, layer .1) within the band, with per-slot slack for single items.
  - **"Shorts + sweater" on a 16-24C day.** Weather was an overlap test; the base outfit now has to cover the morning and the afternoon, a layer only has to overlap, and shorts/sandals need a morning of 18C+ (the sheet rated some slides 5-40C).
  - **Near-identical candidates.** Final set picked with MMR (lambda 0.7) instead of "not the same top+bottom".
- Look at: run the engine on a weekday, a warm date and Shabbat; the candidates are now coherent (see the commit message for samples).

## 2026-11-08 (real weather and dates)

- Today now uses the real day: Israel-local date, Hebrew date and holidays from Hebcal (the default city's geonameid), candle lighting on Fridays and holiday eves, and the Open-Meteo hourly forecast summarized over 07:00-19:00 (feels-like min/max, rain, wind, UV, sky). Saturdays and Yom Tov switch the engine to the Shabbat rules. `features/today/mock.ts` is gone.
- Pure summarizer in the engine (`weather.ts`) with 6 tests on a recorded real response (`__fixtures__/open-meteo-2026-11-08.json`, a showery day: 16-21C, 63% rain). API responses are validated with zod (`packages/schema/src/external.ts`).
- Each source fails alone: weather falls back to a 3h cache, then a day-old one, then "no weather data" with a mild default the screen never presents as a forecast. Attribution for both APIs (CC BY 4.0) is shown under the weather line.
- The explanation is now a true sentence built from the engine's facts (day, feels-like range, layer, rain, Shabbat), in place of the static mock text. It stays as the fallback when the AI stylist (phase B) fails validation.
- Not verified here: Open-Meteo from this sandbox returns 429 (shared IP, as the research warned); the recorded response came through another route. Hebcal Friday/Yom Tov parsing was checked against live responses.

## 2026-11-08 (choose a location)

- New Location screen (tap "מיקום: ..." under the weather line on Today): the default city, the phone's current location (expo-location, works on Android and in the browser), or any city via Open-Meteo's free geocoder. Stored on the device, not in Supabase: "current location" only means something on the device you hold.
- Weather, the local date and Shabbat times follow the chosen place. A chosen city is sent to Hebcal by its GeoNames id, so local customs apply (Jerusalem lights candles 40 minutes before sunset; coordinates alone get the generic 18, which the screen says when "current location" is used). The Israel holiday schedule (`i=on`) is applied only when the place is in Israel's time zone; abroad Yom Tov is two days.
- Caches are keyed by place, so switching cities never shows the old city's weather.
- Verified: geocoder and Hebcal (by id and by coordinates) against live responses. Not verified: the screen itself and the GPS permission flow, which need a signed-in session and a real device/browser.

## 2026-11-08 (brand: Fit Check)

- Name settled: Fit Check. Mark: "FC" in Frank Ruhl Libre inside a hairline square (Totême/SSENSE restraint: ink on ivory, no colour, no gradient). Rendered from the app's own font file into `assets/`: app icon, Android adaptive foreground/background/monochrome, favicon, splash (`expo-splash-screen`, ivory, 120px).
- Sign-in is now a cover page: monogram, the real Hebrew date (Hebcal), the wordmark, a one-line tagline, a still life of three drawn garments overlapping by 8px, then the single burgundy action. `components/brand/Monogram.tsx` and `StillLife.tsx` are reusable.
- Fixed on the way: Hebrew set in Plex Mono fell back to a system font with wide gaps (Plex Mono has no Hebrew); Hebrew text is now always in the body font, mono only for numbers. The cover's free height is taken by the composition instead of a dead band above the button.
- Look at: `design/screens/2026-11-08-sign-in*.png`, `2026-11-08-app-icon.png`. Not verified: the icon and splash in an Android build.
- Known waste, to fix: the cover loads the whole day context (including weather) when it only needs the Hebrew date.
- Plan: added stage G (personal colour palette, research-backed) to `docs/PLAN.md`; it needs a migration and waits for a go.

## 2026-11-08 (editorial redesign, A3)

- PR #1 merged to `main`. Vercel project creation was refused for this session's Vercel connection (403); the owner creates it from the dashboard (see the session notes).
- Screens split into a container (loads data) and a view (pure props): `features/today/TodayView.tsx`, `features/wardrobe/WardrobeView.tsx`, `ItemContent` in `app/item/[id].tsx`. This made it possible to render and photograph the signed-in screens with the real wardrobe for the first time.
- Today: garments carry a mono index (01-04) and the names moved to a numbered caption legend (Hebrew type + name); the reason is a pull quote in the display face under an ink rule, with practical notes beneath; the weather is a three-cell data strip (feels like, rain, sky); blocks enter in reading order (180ms, 40ms apart).
- Wardrobe: "108 items · 6 categories" instead of a bare number; section heads in the display face with a mono count and a strip of the category's real colours; captions show the Hebrew type and colour; press feedback (scale 0.97, 120ms).
- Item: tags as a spec table on hairlines (type, colour swatch, pattern, material, seasons, formality, range); "goes with" as numbered trios of drawn garments.
- New building blocks: `components/editorial/{Reveal,DataStrip,SpecTable}.tsx`, `components/PressScale.tsx`.
- Bugs found by looking: Hebrew mixed into Plex Mono again (weather line, formality line), now split into labels and mono numbers; digit-only values hugged the wrong edge in RTL because react-native-web renders text with dir="auto" (fixed by aligning the container, not the text).
- Look at: `design/screens/2026-11-08-*-editorial*.png` (rendered from the real fixture with a sample showery day, not from a live session).

## 2026-11-08 (Vercel deep links)

- The web app is live at https://fit-check-app-xi.vercel.app (project `fit-check-app`, production from `main`). Verified: the sign-in cover renders in Hebrew and English, `/wardrobe` and `/location` load.
- **Bug fixed:** deep links such as `/item/<id>` returned Vercel's 404. The SPA rewrite pointed at `/index.html`, but with `cleanUrls` on, `/index.html` itself 308-redirects to `/`, so the rewrite target never resolved. It now points at `/`; the client router reads the real URL. Takes effect on the next production deploy (merging this PR).

## 2026-11-08 (A6: wear logging and feedback)

- "לובש" now records the outfit: an `outfits` row, its `outfit_items`, and a `wears` row (feedback `worn`); Today then shows "נרשם: זה מה שלבשת היום" with undo, and the sheet goes away for the day. Writes go to the DB before the screen changes; a failed write says so and changes nothing.
- "דלג" records a skip and shows the next candidate, with "לא אהבתי את השילוב" (turns the skip into `disliked`) and undo. Skipped outfits stay out of today's suggestions after a reload.
- Learning: worn raises every pair in the outfit by 0.05, disliked lowers it by 0.1 (PRD 4), clamped, written to `pair_weights`; undo reverses it exactly. Pure engine functions `feedbackUpdates` / `applyPairUpdates`.
- Freshness: the last 21 days of worn outfits now feed the engine's `recent_wears` (was always empty).
- "החלף פריט": the caption rows become tappable; each shows up to three alternatives for that slot, scored as the whole outfit, inside today's filters and formality band, never two that look alike (engine `swapOptions`). A swapped outfit is recorded with source `swap`.
- "יותר חם / קר / רשמי / פחות רשמי" nudge today's request (3C / one formality step per tap, engine `adjustRequest`), shown as "כוונון להיום" with reset. Session-only: a persistent personal offset needs a profile column (a migration, so it waits for a go).
- Item screen: "איפה הפריט" control (בבית / בכביסה / במילואים / מושאל), optimistic with rollback; only items at home are suggested.
- Tests: engine 49 (16 new: feedback, undo, adjustments, swap), schema 8 (wear row parsing). DB writes checked under RLS as the owner in a rolled-back block.
- Not done (open decisions): automatic laundry after wearing; persisting "I run cold"; the reserve-duty "חזרתי" flow.
- Look at: `design/screens/2026-11-08-today-{skip-feedback,swap,worn}.png`, `2026-11-08-item-availability.png`; `apps/mobile/src/data/feedback.ts`, `useFeedback.ts`, `features/today/outfit.ts` (`planToday`).
- Reserve duty (PRD 4): "יוצא למילואים" on the Wardrobe screen turns the grid into a picker (tap to pick, 1px ink frame); "סמן כבמילואים" moves the picked items to `away` in one request. While anything is away the header shows the count with "חזרתי, הכל לכביסה" / "חזרתי, הכל נקי". Items not at home are faded in the grid and their caption says where they are. Look at `design/screens/2026-11-08-wardrobe-reserve-*.png`.
- Laundry by wear count (migration `0003_laundry.sql`, applied): `items.washed_at` plus SQL function `wear_counts_since_wash` (RLS-scoped, counts worn wears since the last wash; derived, so undo can never make it drift). After "לובש", engine `dueForLaundry` sends what reached its limit to the laundry: T-shirt and polo 1, shorts 2, button-down 3 (worn over an undershirt), sweatshirt 3, knit / chinos / trousers 4, jeans 6, shoes never (`LAUNDRY_AFTER_WEARS` in config.ts). Today says "הועבר לכביסה: …" with "השאר בבית"; undoing the wear brings them back too. Back home from laundry or from base resets the count. 4 engine tests (53 total); SQL checked under RLS in a rolled-back block.
- Reserve picker shows the usual first (T-shirts, sport-tagged items, slides) with "הצג את כל הארון", plus a reminder for what is not in the wardrobe: uniform, army boots, pyjamas.

## 2026-11-08 (learned warm / dressy lean)

- Each worn outfit now stores the total adjustment it was chosen under (inside `outfits.breakdown`, no migration). Engine `learnedAdjustment`: with at least 5 worn outfits in the last 30 days and a real majority (>50%) leaning the same way, that lean (capped at one step per axis) becomes every day's starting point; today's taps add on top. Totals, not taps, are stored, so a correct lean is stable and tapping against it erodes it (5 tests, 58 total).
- Today shows "מותאם לך מהלבישות האחרונות: …" when a lean is active. `RECENT_WEARS_DAYS` 21 → 30 (freshness windows are 3 and 14 days, unaffected).

## 2026-11-08 (stage B: AI stylist)

- Edge Function `style-outfit` (deployed, verify_jwt on): validates `StylistInput` with zod (at most 8 engine candidates; the wardrobe never leaves the app), calls Claude Sonnet 5.5 (`claude-sonnet-5-5`, effort medium, structured JSON output whose `chosen_outfit_id` is an enum of the offered ids, server-side refusal fallback `fallbacks: "default"`), re-validates with `StylistOutputSchema`, and logs every call to `ai_calls` with tokens and estimated cost (Sonnet 5.5 list price $2 / $10 per MTok). Spend guard: 30 calls per user per rolling 24h. Any failure returns `ai_failed` and the app keeps the engine's top pick with the template sentence (CLAUDE.md fallback).
- App: Today asks the stylist (debounced 600ms, answers cached per day and candidate set) and shows its pick with its Hebrew sentence as the pull quote; after a swap the template text returns. `planToday` takes the stylist's `preferredId` and exposes the open `candidates`.
- `packages/schema` imports now carry explicit `.ts` extensions (`allowImportingTsExtensions` in tsconfig.base and the app): the hosted Edge runtime does not resolve extensionless imports, which crashed the first deploy at boot.
- Needs: `ANTHROPIC_API_KEY` as a Supabase Edge Function secret. Until it is set the function answers `ai_failed` and Today looks exactly as before.
- Look at: `supabase/functions/style-outfit/index.ts`, `supabase/functions/_shared/ai/anthropic.ts`, `design/screens/2026-11-08-today-stylist.png` (rendered with a fake stylist).
- Stylist persona (`supabase/functions/_shared/ai/stylist-persona.ts`, deployed as style-outfit v3): a female personal stylist who specialises in everyday menswear and knows the religious dress code without preaching; writes to him in masculine singular and about herself in feminine; one or two sentences, up to 35 words, reason first, concrete numbers, at most two items named in Hebrew by garment and colour (never brand), no exclamation marks, emojis or AI clichés (a banned-word list), with an English-to-Hebrew garment and colour glossary, allowed styling terms, and good/bad examples. Written in Hebrew so the register carries over.

## 2026-11-08 (stage C, first slice: separating garments from photos)

- Edge Function `intake-separate` (deployed): takes a photo the user uploaded to the private `originals/{uid}/` bucket; Claude Haiku 5.5 (vision, structured JSON) lists the garments with a category and a precise description (max 6); Gemini `gemini-3.1-flash-lite-image` extracts each one as a product photo on white, in parallel; PNGs go to `cutouts/{uid}/intake/{photo}/{n}.png`. Every call is logged to `ai_calls` with cost (Gemini paid tier: $0.0336 per output image). Spend guard: about 40 photos per user per 24h. Nothing is written to `items` yet.
- App: "הוספת בגדים" screen (`/intake`, linked from the Wardrobe header): pick up to 10 photos, each is downscaled to 1600px JPEG, uploaded, separated, and shown with its results; status is text, never a spinner. The screen states that this is a quality check and nothing is saved yet.
- `expo-image-picker` and `expo-image-manipulator` added (photo permission text in app.json).
- Needs: `GEMINI_API_KEY` (set) and billing on in Google AI Studio (image models have no free tier; paid-tier data is not used for training).
- Next: run the 10-photo quality test, then tagging (Haiku against the frozen tag schema) and the confirm screen that saves to `items`.
- Look at: `supabase/functions/intake-separate/index.ts`, `supabase/functions/_shared/ai/gemini.ts`, `design/screens/2026-11-08-intake.png`.
- Intake switched to free by default (Roy, 2026-11-08: no real money): `gemini-2.5-flash` on the Gemini API free tier returns a box and a pixel mask per garment, and the function cuts the real photo pixels onto a transparent background (`_shared/image/cutout.ts`, imagescript, 3 Deno tests). Cost $0 per photo; Haiku listing removed. The paid redraw (`gemini-3.1-flash-lite-image`) is now an optional "שיפור עם AI" per garment, which answers "billing_required" while the project has no billing. Free-tier caveat: Google may use free-tier inputs to improve its products.
- Deploy note: Edge Functions were deployed through the Supabase MCP with trimmed copies of the shared schema files (same exports). A `supabase functions deploy` from the repo is the source of truth and gives the same behaviour.
- Correction, same day: segmentation masks dropped. Research showed `gemini-2.5-flash` masks are being retired (its requests move to 3.5 Flash-Lite on 2026-12-01, and Gemini 3.x has no masks), and the imagescript build crashed the Edge runtime (WORKER_ERROR). Now: `gemini-3.8-flash` (free tier) returns per garment a box, category, description and issues (occluded, overlapping, cut_off, wrinkled, blurry, dark); the app crops the real photo with expo-image-manipulator and uploads the crops itself. Garments with issues offer "צלם שוב לבד" first, then "שיפור עם AI" (paid redraw that completes hidden parts; billing_required while there is no billing). The tag-based drawing stays only as the last resort (Roy).
- Open spec question: background removal. Modal needs a card even for its free credits; the $0 option is an MIT model (BiRefNet-lite / BEN2 ONNX) running on the device. CLAUDE.md still says "Cutouts come from the Modal worker" and needs Roy's decision before changing.
- Paid redraw uses its own key, `GEMINI_IMAGE_API_KEY`, from a second Google project with billing and the AI Pro credit, so detection stays on the free tier of the main project. Hard cap: $8 of redraws per calendar month (UTC), summed from `ai_calls`; above it the function answers "monthly_limit".

## 2026-11-08 (fix: every signed-in AI call was 401)

- `style-outfit` and `intake-separate` called `supabase.auth.getUser()` without the token. On the server that reads a stored session (none) and ignores the Authorization header, so every real call came back 401 before reaching Claude or Gemini (photos uploaded, nothing detected, no stylist sentence, no `ai_calls` rows). Both now pass the bearer token: `getUser(token)`. Redeployed both.
- A temporary `env-check` diagnostic (lists env var names only) was deployed and then replaced by a 410 stub; it can be deleted from the Supabase dashboard.
- Still 401 after passing the token. Both functions now share `supabase/functions/_shared/auth.ts`: `getClaims(token)` (JWKS, no Auth round trip) with `getUser(token)` as fallback, and on failure the 401 body and function log carry the reason (never the token). `@supabase/supabase-js` pinned to 2.119.0 in the functions import map. intake-separate redeployed; style-outfit follows once a real call confirms the fix.
- Root cause found with a temporary diagnostic: from inside the Edge runtime, every Supabase request that carried the user's real token (getUser, getClaims, storage as the user) came back as an HTML page, while the same requests without it returned JSON. `_shared/auth.ts` now verifies the JWT locally against `SUPABASE_JWKS` (ES256, issuer `{url}/auth/v1`, audience `authenticated`) with `jose` and never forwards the token; intake-separate reads and writes storage with the service role, kept to the user's folder by `ownPath()`. 2 Deno tests (valid token; wrong issuer, wrong audience, foreign key, no token). intake-separate redeployed; style-outfit next.

## 2026-11-09 - Intake: auth works, retry when Gemini is overloaded
- Intake auth confirmed working on a real photo (local JWT check). The first real detection failed with Google 503 "high demand".
- detectGarments now tries gemini-3.8-flash twice, then gemini-3.5-flash-lite (both free tier); 429/500/503 show "Google is busy, try again" instead of a generic error. ai_calls records which model answered.
- Look at: ai_calls.model on the next intake.

## 2026-11-09 - Intake: real tagging, review screen, saving to the wardrobe
- Why: Roy saw wrong type (sweater as shirt), shade and fabric. Causes found: no tagging step existed (only detection's
  6 coarse labels), the redraw was described from detection's guess (melange tailored trousers drawn as olive chinos),
  detection had fallen back to the weak free model, and the test photos were ~200 px (crops 45-130 px).
- intake-tag (new, deployed): Claude tags a crop with the full frozen ItemTags, using a fabric/type/colour guide, the
  owner's wardrobe names, his last 15 corrections, and an optional care-label photo (composition settles wool vs cotton).
  Default model Haiku 5.5: on the real crops Sonnet 5.5 was no more accurate and 15x the cost (0.1 vs 1.7 cents).
- Migration 0004_tag_corrections: proposed vs saved per confirmed garment, with the changed fields; feeds the prompt.
- Detection: paid gemini-3.8-flash first (4 s, ~0.2 cents a photo, verified), free key as fallback, low thinking.
  The $8/month Google cap now covers paid detection and redraws together.
- App: "one garment" mode (whole frame, no detection) as default, "several garments" mode, low-resolution warning,
  review per garment (chips per field, the tagger's value first, "worth checking" on uncertain fields), care-label photo,
  redraw from the confirmed tags, save to items (+ tag_corrections), wardrobe reload.
- Look at: design/screens/2026-11-09-intake-review.png, intake-modes.png; ai_calls rows with task 'tag'.

## 2026-11-09 - Intake: "one garment" means the one in front
- Roy's closet photo of a brown shirt came back as two garments (the black shirt hanging behind it as "outerwear").
- "One garment" mode now runs detection with `single: true`: a dedicated prompt returns only the main garment (front,
  centre), ignoring clothes behind or around it, and the app crops to it. Falls back to the whole frame if detection fails.
- The tagger is told to tag only the front garment and ignore other clothes' colours.
- Look at: one-garment photo taken in the closet; ai_calls shows one 'separate' and one 'tag' row per photo.

## 2026-11-09 - Background removal (Modal worker)
- worker/app.py: separate `Cutter` (CUDA + cuDNN image, onnxruntime-gpu, rembg birefnet-general, T4, scales to zero after
  2 min) and `Embedder` classes; fixed the FastAPI `Request` injection; token check; input size cap; trimmed PNG + 400 px thumb.
- intake-cutout (deployed): crop -> worker -> `<crop>-cutout.png` + `-thumb.png` in Storage, ai_calls row (provider modal,
  cost from wall time x T4 rate), 120/day cap. Answers `not_configured` until MODAL_CUTOUT_URL and MODAL_WORKER_TOKEN are set.
- App: each garment is tagged (from the crop) and cut out in parallel; the review shows the cutout when ready; the item saves
  the cutout and thumb (a redraw still wins if the user asked for one).
- Not deployed to Modal yet: the sandbox cannot reach Modal's gRPC API. Steps in worker/README.md.

## 2026-11-09 - Show the real photo, not the drawing
- Roy: items saved from photos showed the generic drawing. The image was saved (items.cutout_path) but every view drew ItemArt.
- ItemArt takes `cutoutPath`: with a path it shows the stored image (public cutouts bucket), else the drawing (sheet items).
  Wired in the wardrobe grid, item page, "goes with", Today composition and swap options.
- Look at: design/screens/2026-11-09-wardrobe-photo.png (Tsumi Mandarin Collar).

## 2026-11-10 - Cutout worker on CPU (no card needed)
- Modal requires a payment method for any GPU function; Roy wants no card on file. Cutter now runs on 8 CPU cores
  (debian_slim + onnxruntime CPU), about 10-20 s a photo, still free within the $30/month credit. Embedder moved to CPU too.
- intake-cutout timeout 100 s -> 140 s (cold start on CPU), cost estimate per CPU core-second. Redeployed.
- How to go back to a T4 is in the comment above `cutout_image` in worker/app.py.
- Bake the BiRefNet weights into the cutout image at build time. Downloading them at container start (~3 min at
  ~5.5 MB/s, repeated by every parallel container) hit the container timeout, so the first deploy never answered.

## 2026-11-10 - Cutout fixes: AI redraws, speed, existing photos
- AI redraw: the slow cutout of the original no longer replaces the redraw on screen; the redraw itself is now cut out
  (it comes on white), and saving prefers redraw-cutout > redraw > original cutout > crop. intake-cutout accepts
  `-enhanced` paths (redeployed).
- Speed: Cutter uses Modal memory snapshots (`enable_memory_snapshot`, `@enter(snap=True)`), so a sleeping worker
  restores the loaded model instead of reloading 1 GB (the first real call took 112 s). Needs a `modal deploy`.
- Existing photo items: one-off `cutout-backfill` function (code-guarded, expires 2026-11-10 23:00 UTC) cuts out
  every photo item that has no `-cutout.png` yet; retired after the run.

## 2026-11-10 - Spreadsheet items deleted; Today says what is missing
- At Roy's request, deleted the 108 items imported from the spreadsheet (their pair weights cascaded). The wardrobe now
  holds only the 41 items added from photos; tag_corrections and ai_calls are kept.
- Today: when the wardrobe has no tops, bottoms or shoes at all, the empty state names what is missing and links to
  "add clothes" instead of the generic "no suggestion today". Screenshot: design/screens/2026-11-10-today-missing.png.

## 2026-11-10 - Edit items after they are added
- Item page: "עריכה" opens an editor (features/item/ItemEditor.tsx): name, brand, type, colour, pattern, fabric, fit,
  seasons (at least one) and formality 1-10, saved together; the hot columns stay in step with `tags` (data/items.ts).
- Image actions: "החלפת תמונה" (new photo, background removed) and "שיפור עם AI" (redraw from the original crop, never
  from an earlier redraw, then cut out). Each redraw now gets its own file (`-enhanced-<ts>.png`) so an item can be
  redrawn again; intake-separate redeployed.
- "הסר מהארון": two taps; archives the item (status `archived`) so wear history stays and it is never listed or
  suggested again.
- Screens: design/screens/2026-11-10-item-view.png, 2026-11-10-item-edit.png.

## 2026-11-10 - Duplicate check, sleeve length, name in the redraw prompt
- intake-tag: after tagging, up to 4 look-alikes (same subcategory, colour and sleeve length, active, with an image)
  are compared with the new crop by Claude Haiku (_shared/ai/duplicates.ts). Only a high-confidence match is returned
  as `duplicate`. Daily tag cap 80 -> 160 (two calls per garment). Redeployed.
- App: a duplicate notice shows both images before the tags, with "same garment, skip", "same garment, use this photo"
  (sets the existing item's image) and "different garment".
- Sleeve length: a row in the review and the item editor (tops, layers, outerwear); `normalizeTags` keeps category,
  sleeve "na" and the short_sleeve / short_pants modesty flags consistent with manual edits. Shown on the item page.
- The AI redraw description now starts with the item's current name (brand and the user's own words), plus sleeve length.
- Screens: design/screens/2026-11-10-intake-duplicate.png, 2026-11-10-intake-review-sleeve.png.

## 2026-11-10 - Sleeve and leg length: detect, default short, always choosable
- Tagger: explicit rule for sleeve length (ends above the elbow = short; reaches the wrist, or rolled-up long sleeves =
  long); when the end is hidden it answers short and flags `sleeve` as uncertain. Leg length rule for shorts vs long
  trousers. `uncertain` may now include `sleeve`. intake-tag redeployed.
- App: the sleeve row shows "worth checking" when uncertain; a garment that gains sleeves defaults to short. New
  "leg length" row (long/short) for bottoms in the review and the item editor; short maps to `shorts`, long restores the
  garment's long type (or chinos).

## 2026-11-10 (daily caps)

- Roy hit `daily_limit` mid-upload (80 Google calls in 24 h). Spend was fine: Google $1.55/24 h, $1.76 this month of the $8 cap; Claude $0.19; Modal $0.18.
- Daily caps raised to runaway guards only: detect 200, enhance 60, tag 400, cutout 400. The money guard stays the monthly $8 Google cap in `intake-separate`.
- Deployed: intake-separate v19, intake-cutout v6, intake-tag v7.

## 2026-11-10 (front garment only)

- Cutouts of closet photos kept the shirt hanging behind (BiRefNet keeps every garment it sees). The worker now also runs SAM 2.1 small, prompted with points on the centre of the crop, and keeps BiRefNet's alpha only inside SAM's garment. Guards: if SAM's mask covers under 30% of the foreground it is ignored; pieces under 15% of the biggest are dropped (a second shoe survives). AI redraws skip it (`isolate=0`).
- Tested locally on Roy's 21 photo items: dark and white garments behind are removed; a white shirt with a pink one pressed right behind it can still keep a pink edge (SAM reads them as one).
- Needs `modal deploy worker/app.py` (image grows by CPU torch + SAM; memory 6 GB -> 8 GB). intake-cutout v7 is already deployed and works with the old worker too.
- Fixed: a cutout that finished after "save" never reached the item, so items kept the uncut redraw on white. The app now updates the saved item when a late cutout lands; 17 items fixed in the data.
- Temporary `cutout-backfill` function deployed to re-cut the 21 photo items once the worker is up; retire to 410 after.

## 2026-11-10 (overshirt, type filter)

- New subcategory `overshirt` (category `layer`): a heavier shirt worn open over a T-shirt. The engine can now put it over a tee below the layer threshold (19C) and never on a hot day; laundry after 4 wears. Tagger prompt separates it from `button_down` (thick flannel, corduroy, shacket, chest flap pockets). No DB migration: `items.subcategory` is plain text with no check constraint. Existing button-downs are re-classified by hand with Roy, not by a silent default.
- Deployed: intake-tag v8 (tagger knows overshirt), style-outfit v15 (stylist schema and Hebrew term).
- Wardrobe: a "type" filter row before season/colour: shirts, T-shirts, polos, overshirts, knits, trousers, shorts, shoes, coats, accessories (only types present show). Look at `design/screens/2026-11-10-wardrobe-type-*.png`.
- Re-classified by Roy (2026-11-10): Koton, American Eagle and Grey hooded check flannels are thick overshirts (cotton, 6-20C, transition/winter); Brown Long Sleeve Shirt (olive) is a thin overshirt (16-26C, transition). All `open_front`. Until this PR is live, the deployed app skips these 4 rows as unknown subcategory.

## 2026-11-17 (MCP, phase 1)

- New Edge Function `mcp` (verify_jwt off on purpose, see its header): Fit Check as an MCP server over Streamable HTTP, stateless JSON. Tools: `wardrobe_search`, `item_get` (returns the photo), `item_update` (validated tag merge, hot columns kept in sync), `item_archive`, `item_restore`, `spend_summary`. Service-role client with an explicit `user_id` filter in every query (user-token clients fail inside the Edge runtime, see `_shared/auth.ts`).
- Auth: OAuth 2.1 via Supabase Auth's OAuth server. 401 carries `WWW-Authenticate` -> `/functions/v1/mcp/.well-known/oauth-protected-resource` -> authorization server `/auth/v1`. New consent page `apps/mobile/src/app/oauth/consent.tsx` (outside both route guards; a signed-out user's request survives the Google redirect via session storage, `oauthPending.ts`). Screenshot: `design/screens/2026-11-17-oauth-consent-signed-out.png`.
- Needs from Roy (dashboard): Authentication > OAuth Server: enable, Authorization Path `/oauth/consent`, allow dynamic client registration; Site URL = the production web URL. Then add the connector in claude.ai with `https://ftjerbwrzjprfikxkukj.supabase.co/functions/v1/mcp`.
- Not verified yet with a real OAuth token (the OAuth server is still disabled): if its access tokens carry an audience other than `authenticated`, `authenticate()` will 401 and needs the audience added.
- Phase 2: today's outfit, adding garments from photos, AI redraw and re-cut from chat.

## 2026-11-17 (MCP live, image type fix)

- MCP verified end to end from a Claude session through Roy's claude.ai connector (OAuth token accepted with the existing `authenticated` audience): wardrobe_search (4 overshirts), item_get with photo, spend_summary.
- Fixed: 15 of 144 tag/duplicate calls failed with "specified using image/png but appears to be image/jpeg": some `.png` files hold JPEG bytes. New `_shared/media.ts` sniffs the type from the bytes; used by intake-tag (v9) and mcp (v2). The duplicate check had been silently skipped in those cases.

## 2026-11-17 (wardrobe cleanup, no AI spend)

- Duplicates removed (archived, reversible with item_restore): the older "Polo Ralph Lauren Denim Shirt" and "Tsumi Mandarin Collar" were the same photo saved twice. Checked and kept as different garments: the two white Tommy Hilfiger shirts (pocket vs no pocket) and the Next vs plain white tees.
- 20 images re-cut for free: 19 closet photos re-run through the worker's own BiRefNet + SAM 2 isolation inside Claude's sandbox (Roy, 2026-11-17: do the work locally where it saves paid AI calls), plus the Beige Melange redraw that had kept its white background. Uploaded through a temporary `image-put` function (now 410) as new `N-clean-<ts>-cutout/thumb.png` files; old files untouched. Before/after: `design/screens/2026-11-17-cleanup-before-after.png`.
- Still imperfect (shirt pressed against a same-coloured garment): Gant Button-Down, Grey Hooded Flannel, Tommy Hilfiger Shirt, Abercrombie Button-Down, Brown Zip Jacket. A paid redraw (~$0.034 each) would fix them.
- `cutout-backfill` and `image-put` retired to 410.
- Redrawn with Roy's OK ($0.17 total, 5 x $0.034): Gant Button-Down, Grey Check Flannel Hooded Shirt, Tommy Hilfiger Shirt, Abercrombie Button-Down, Brown Zip Jacket. Descriptions written by Claude from the photos (hood, pocket, logos), so each took one call. Temporary `redraw-five` function retired to 410. Before/after: `design/screens/2026-11-17-redraw-five.png`.

## 2026-11-17 (MCP phase 2)

- New MCP tools: `outfit_today` (the app's engine builds today's candidates with weather, Shabbat/holiday rules, laundry and recent wears; Claude in the chat picks and explains, so the paid Sonnet stylist is skipped), `outfit_log` (worn/skipped/disliked with the app's three writes, pair-weight learning and laundry), `intake_pending` + `item_create` (photos parked with the new "send to Claude" button; Claude tags them itself, no tagger call), `item_redraw` (one paid call, description written by Claude), `item_recut` (free, Modal).
- App: intake screen has "שלח ל-Claude בלי תיוג" under the main button; uploads to `cutouts/{uid}/pending/`. Screenshot: `design/screens/2026-11-17-intake-for-claude.png`.
- The engine runs in Deno through a generated bundle, `supabase/functions/_shared/engine.js` (`scripts/bundle-engine.sh`; re-run after changing packages/engine) with types in `engine.d.ts`.
- The mcp function is deployed as one minified bundle (`scripts/bundle-mcp.sh`), because its sources are too large to paste into the deploy tool.
- `MONTHLY_GOOGLE_BUDGET_USD` and `monthlyGoogleSpend` moved to `_shared/ai/budget.ts`, shared by intake-separate and mcp. intake-separate's deployed v19 already behaves identically; redeploy it with the next real change.

## 2026-11-17 (MCP: several garments in one photo)

- Bug (reported from a Claude session): a pending photo with 6 garments; the first item_create moved the photo away and the second failed with "Object not found", and the cutout covered the whole pile.
- Fix: item_create now copies the photo into the item's own folder, takes an optional `crop` box (fractions 0-1; cropped with imagescript before the cutout, so the item's original, redraw source and re-cut are that garment only) and `keep_pending` (leave it in the queue for its other garments). New tools `intake_dismiss` (drop a pending photo) and `item_recrop` (crop an existing item's original; full photo kept as `N-full-<ts>.jpg`; `requeue_original` puts a copy back in pending; `recut` optional). Single-garment flow unchanged.
- Data: "Zara Half-Zip Sweater" (fa5f2cf6) still has the 6-garment photo as its original; fix with item_recrop (crop box from the photo, `requeue_original: true` to bring the photo back for the other 5).
- Incident (≈20:26–now UTC): mcp v4 returned 500 at boot. Cause: the npm build of imagescript loads a native Node codec the Edge runtime rejects ("unsupported arch/platform"). Fix: the Deno build (https://deno.land/x/imagescript@1.3.0, pure WASM), imported dynamically inside cropImage so a codec problem can only break cropping, never the whole server.

## 2026-11-18 (redraw background)

- An AI redraw's white background is now removed on the server right after generation (`supabase/functions/_shared/whitebg.ts`): a flood fill from the border with a threshold read from the image itself, so white shirts stay whole. Free, no model, about 0.1 s. Wired into `intake-separate` enhance (v20, returns `transparent`) and the MCP `item_redraw` (v6); the Modal worker is only a fallback when the check declines.
- App: `ItemEditor` and `IntakeView` skip the worker cutout when the redraw comes back `transparent`.
- Cause: the Modal workspace was disabled on 2026-11-18, so every redraw stayed on white. 18 items left on white were cleared with the same code; the temporary `image-put` function is retired (410).
- Look at: `design/screens/2026-11-18-redraw-whitebg.png` (all 18 on a green test ground). A faint light outline remains on a few dark garments; it doesn't show on the app's light background.

## 2026-11-18 (AI redraw composer)

- The paid redraw now opens a composer instead of firing right away (Roy, 2026-11-18): the garment as dotted running text where every word is a tag (tap = its closed list, and the change is a tag edit, saved with the new image), detail chips (collar, pockets, logo, closure, soles... 51 in `packages/schema/src/redraw-spec.ts`, Hebrew labels in the locales), photo-fix chips, and up to two free notes of 60 characters. The English prompt is shown read-only, built by the same function the server uses. The button shows the price and the month's remaining Google budget (new `quote` action on intake-separate, no AI call).
- Suggestions cost nothing: the name, brand and detection's description preselect details by keyword (longest match per group), detection's issues preselect fixes (overlapping -> remove the garment behind), and past redraws of the same garment type rank the chips. A free note typed twice for a garment type is offered back as a chip. Logic in `packages/engine/src/redraw.ts`, 19 tests.
- Free notes are cleaned (no quotes, brackets or line breaks), quoted in the prompt, and come with an instruction never to draw them as lettering on the garment.
- Migration `0005_item_redraw_spec.sql`: `items.redraw_spec jsonb`, the last successful redraw's choices, so a second redraw of an item starts where the first ended. Not part of the frozen tags.
- intake-separate `enhance` takes `spec` (the server builds the prompt) or the old `description` (older app builds keep working). A spec with no chips produces the exact pre-composer prompt (test in `redraw-spec.test.ts`).
- MCP `item_redraw`: description is optional; without it, `details` from the same vocabulary build on the item's tags and the spec is stored. `fixes` and `notes` work in both modes.
- `Chip`/`Row` moved from GarmentReview to `features/intake/ChoiceRow.tsx` (shared by intake, item editor and composer). Engine bundle regenerated; it now imports values from @fit-check/schema.
- Deployed: migration 0005 applied; intake-separate v21 (one esbuild bundle, same flags as `scripts/bundle-mcp.sh`), checked to boot. Old app builds keep working (description path).
- mcp v7 deployed later the same day (bundle from `scripts/bundle-mcp.sh`, checked: boots with the same 401 + WWW-Authenticate as before, deployed source identical to the bundle). `item_redraw` chips mode is live.
- Look at: `design/screens/2026-11-18-redraw-composer.png` and `-open.png` (colour word open, a free note being typed, prompt shown).


## 2026-11-18 (design preview, temporary until 2026-11-25T16:00:00Z)

- Read-only design preview of the web app (Roy, 2026-11-18): a designer (another Claude in a real browser) can see Roy's live wardrobe without Google sign-in. Open any URL with `?preview=<code>`; the code goes to sessionStorage and leaves the address bar. Web only, native untouched.
- New Edge Function `design-preview` (verify_jwt off, own check): POST `{ code }`, compared in constant time with the `DESIGN_PREVIEW_CODE` secret (Supabase function secrets only, never in the repo). Returns Roy's rows only (explicit `user_id` filter on every query): items, pair_weights, the last 31 days of wears, stored redraw specs, in the same shapes the app's reads parse. Never writes, never calls an AI provider. 401 for a missing or wrong code, 410 after the expiry hard-coded in the source.
- App: `src/data/preview.ts` (isPreview, getSnapshot kept in memory only); `fetchWardrobe`, `fetchFeedback` and `fetchRedrawHistory` read the snapshot in preview. Every write throws `PreviewReadOnlyError` (screens show their existing "not saved" state), uploads and intake/redraw function calls answer reason `preview`, the stylist returns null (top-scored candidate, no Sonnet call), and the wardrobe is not cached in local storage. SessionState gained `preview`; the signed-in routes render with Roy's id and no Supabase session. A quiet line at the bottom of every screen: "תצוגה לעיצוב בלבד · שום דבר לא נשמר".
- Schema: `packages/schema/src/design-preview.ts` (input and snapshot schemas, 3 tests).
- To remove: retire `design-preview` to a plain 410 (like redraw-five), delete the `DESIGN_PREVIEW_CODE` secret, and revert the preview commits on `claude/busy-tesla-bogylz` (snapshot schema, function, data layer, session/banner, this entry stays).
- Deployed: `design-preview` v1 (one esbuild bundle, same flags as `scripts/bundle-mcp.sh`; deployed source checked against the bundle). Checked: wrong or missing code 401 with no data, OPTIONS preflight returns the CORS headers. Not yet set: the `DESIGN_PREVIEW_CODE` secret (the Supabase tool asks for the value in the dashboard and got no answer), so until it is set every code gets 401 and the preview shows "could not load the wardrobe".
- Look at: on web, `/?preview=<code>`. Checked locally with a mocked snapshot built from the anonymized fixture: Today, wardrobe grid, item page and intake render with the line at the bottom; "לובש", an availability change and every other write sent no request to Supabase and showed the screens' own "not saved" message. Screenshots stay out of the repo (they would show the real wardrobe once the secret is set).

## 2026-11-18 (redesign 1.2: design system foundations)

- Tokens v2 (DESIGN.md section 2): `ink-faint` darkened to #6E6A61 (meta text is darker on every screen, intended), `scrim`, `tile`/`tile-deep`/`tile-cool`, `num-sm`; `motion` gains press/stagger/skeleton, `shadow.lift`/`shadow.sheet` (one `boxShadow` string: RN 0.88 new architecture and react-native-web both take it), `layout` gains grid, nav, desktop and hit sizes plus `masonryColumnsFor()`. Display serif now Frank Ruhl Libre 400 (500 no longer loaded).
- `theme/tileTone.ts`: OKLCH tone rule; bounds L > 0.86 deep, hue 40-110 / L 0.55-0.86 / C 0.02-0.10 cool. Checked on white, cream, beige, khaki, camel, tan, light brown, navy, black, olive, burgundy, blue, grey, yellow, light blue. `tileAspect()` covers all 19 subcategories.
- `components/ui/`: Button, Chip, Segmented, Tile, MasonryGrid (windowed ScrollView, synchronous shortest-column layout), Sheet (RN Modal; desktop dialog >= 900), Swatch, Icon (Material Symbols Rounded 300 paths inline), ScreenHeader, TabBar, TopNav, ListRow, EmptyState, Skeleton, StatusLine, and `Display`/`Meta` (the English-only tracking and uppercase rules live there). Web keyboard focus ring via `data-focusring` in global.css.
- Gallery at `/design-system` (not linked). Screens are not migrated yet.
- Look at: `design/screens/2026-11-18-design-system-*` and `-today-tokens-v2`, `-wardrobe-tokens-v2`.
- Not verified: native iOS/Android (no emulator in the session): Modal + gestures, `boxShadow` on Android, haptics, `I18nManager` RTL.

## 2026-11-18 (redesign 1.3: navigation shell)

- Route group `src/app/(tabs)/` with expo-router `Tabs` and a custom bar (`features/shell/ShellTabBar.tsx`): library `TabBar` below 900px, `TopNav` from 900px, switched on window width. Destinations: wardrobe, today (`/`), add (`/intake`), insights (new), profile (new). URLs unchanged; `/item/[id]` and `/location` stay above the tabs. Tab switches are instant (`animation: "none"`).
- `/profile`: location row (opens `/location`), read-only language row, data credits. `/insights`: empty state pointing at the wardrobe. The old text links between Wardrobe, Intake and Today are removed (Today's own link is left to the Today task).
- Preview banner now sits directly above the tab bar on mobile (root layout only shows it on screens outside the tabs). `TabBar`/`TopNav` got `aria-selected`, which react-native-web did not emit from `accessibilityState`.
- Look at: `design/screens/2026-11-18-shell-*`; resize the browser across 900px; open an item and go back.
- Not verified: native iOS/Android (no emulator): safe-area padding, haptics, RTL tab order.

## 2026-11-18 (redesign 1.4: Today)

- Today rebuilt per DESIGN.md section 3 "היום": masthead (date line, weather line in mono that opens `/location`, place name under it), full-bleed 4:5 flat-lay of cutouts, numbered legend, pull quote, floating action bar ("wearing it" = 1 tap, `tune` opens the adjustments sheet). Tap a garment or its legend row = piece sheet (3 alternatives, swap = 2 taps; "open item"). Swipe on the flat-lay = skip (toward the start edge: left in LTR, right in RTL). Desktop >= 900: two columns, nothing floats. The header link to the wardrobe is gone (the tab bar replaces it).
- New library pieces: `FlatLay` (with the one `FLAT_LAY` placement config; numbers attach to the drawn garment's edge, computed from the photo's aspect), `Stepper`, `LegendRow`, `ActionBar`. Extended: `Button` icon `outlined` (48, beside a button), `StatusLine` `secondaryAction` + `disabled`. Fixed: `Sheet` title hugged the wrong edge for Latin titles in RTL. Gallery shows 8 real flat-lay combinations and the stepper.
- Removed (no other importers): `ActionSheet`, `OutfitComposition`, `ItemPlaceholder`, `editorial/DataStrip`.
- Look at: `design/screens/2026-11-18-today-*` (default at 360/390/430/1280 he+en, piece sheet, adjust sheet, mid-swipe, failed wear, flat-lay combinations).
- Not verified: native (no emulator), real writes (preview is read-only: wear/skip show the failure line), the all-skipped/missing/empty states (not reachable with this wardrobe in preview). Known gap: RNGH 3.3 on web overrides the detector's `touchAction="pan-y"` with `none`, so on a touch browser a vertical scroll that starts on the flat-lay does not scroll.

## 2026-11-18 (redesign 1.4: Today fix round)

- Touch scroll over the hero (web): RNGH 3.3 applies GestureDetector's `touchAction` once, then every gesture config change runs `setGestureConfig()` → `resetConfig()`, which puts `touch-action: none` back. The swipe's pan config now carries `touchAction: "pan-y"` itself (whitelisted at runtime in RNGH's `allowedNativeProps`, missing from `PanGestureConfig`'s type; passed via a variable typed with it, no cast). Verified with iPhone 13 touch emulation: vertical drag from the hero scrolls, horizontal drag swipes.
- `Sheet` ground is `ivory` (was `ivory-deep`), so tiles inside a sheet show their ground.
- Skip line moved out of the floating bar to between the masthead and the hero; the bar is only wear + tune (worn, laundry, failure lines still in it).
- `ActionBar` in Today has `safeArea={false}`: the tab bar below owns the bottom inset.
- Desktop flat-lay capped to the viewport height under the top nav (32 above and below), 4:5 kept by narrowing.
- Look at: `design/screens/2026-11-18-today-{default,piece,adjust}-*.png` (re-shot). Not seen: the skip line on Today itself (the preview cannot record a skip).

## 2026-11-18 (redesign 1.8: small screens on the component library)

- Sign-in is a cover: `Display` app name as the one serif moment, the still life narrowed with air around it, `StatusLine` for a failed sign-in, the Google `Button` (primary) at the bottom. Still-life tiles lost their hairline frames and sit on `tile` / `tile-deep` / `tile-cool` grounds; the garment hexes stay in one commented constant. Monogram label comes from `app.name`.
- Location: back icon button + `ScreenHeader`, `ListRow` choice rows (check + selected state), new `SearchField`, `StatusLine` for the denied message (it used to replace the row's meta). Logic untouched except the search reset is derived instead of set in an effect (lint).
- OAuth consent: `Display` title, scopes as `ListRow`s under a `Meta` label, approve = primary `Button`, deny = outline, errors in `StatusLine`. Logic and redirect handling untouched; the sentence that starts with the client's name now gets an explicit direction.
- `WardrobeGate`: loading is one centred `Meta` line low on ivory; error is `EmptyState` with a retry `Button`. New `+not-found` route (`EmptyState` + back to Today).
- Profile and Insights: new `ScreenColumn`; from 900px the 720 column sits on the start edge of the 1200 container, under the TopNav brand mark. Mobile unchanged.
- `TextAction` / `TextLink` now render the library text `Button` (`quiet` is ignored).
- Library additions: `ListRow` `meta` and `selected`, `SearchField`, `ScreenColumn`. New keys: `common.back`, `common.loadFailedBody`, `oauth.scopesTitle`, `notFound.*`.
- Look at: `design/screens/2026-11-18-{sign-in-idle,location-*,consent-*,gate-*,notfound*,profile,insights}-*.png`.
- Not verified: native, a real Google sign-in, a real consent approval (the ask state was reached with a faked session and mocked Supabase responses), a successful "my current location" write (back has no history in a fresh tab).
## 2026-11-18 (redesign 1.7: Add / intake)

- Add screen rebuilt on the library: `ScreenHeader`, `Segmented` mode, one primary `Button` (choose photos), "send to Claude" as `outline`, `JobCard` (thumbnail + `StatusLine` per photo), `GarmentReview` (large photo on a tile ground from `tileTone`, inline name, library `Chip` rows with an icon-and-words "worth checking" marker, ink save button), duplicate card with two `PhotoTile`s. New library piece `PhotoTile` (tile-style photo with reserved size, skeleton, error glyph); `Tile`'s `FRAME` is exported. Desktop: 720 column, review cards two to a row from 1200.
- Every failure is visible with a reason and, where it can help, "try again": job failures (reason kept: server reason, `http_<status>`, network, preview), failed background removal (original and redraw), late image sync, redraw-spec save, one-garment fallback to the whole photo, tag-corrections write, send-to-Claude failures (retries only the failed photos). Preview blocks read "design preview only: the photo was not uploaded". `busy` is now real (saving, syncing, reading a label).
- Data: `invoke` keeps the server's reason or `http_<status>`; new `reasonOf`; `saveGarment` returns `{ id, correctionSaved }`; `saveRedrawSpec` (data/redraw.ts) returns a boolean.
- Look at: `design/screens/2026-11-18-intake-*`, and the "Add" block of `/design-system`. Not verified: native, and the real upload, detection, tagging, saving pipeline (blocked in the preview).

## 2026-11-18 (redesign 1.5: Wardrobe)

- Wardrobe rebuilt on the library: `ScreenHeader` with count, `tune` (ink dot when a sheet filter is on) and a `backpack` icon for reserve duty; sticky category words (`TextTabs`, new) in DESIGN.md order; colour filter as tappable 24px swatches with the chosen name beside the row; active sheet filters as removable chips; windowed `MasonryGrid` of `Tile`s (2/3/4/5 columns, gap 8, gutter 16); "all" grouped under `Display` headings with counts, one category = continuous grid. Groups now follow the tab order (top, bottom, layer, outerwear, shoes, accessory).
- Filter sheet (type, season, availability; "נקה" / "הצג N פריטים", live). Long press (or Shift+F10 / context-menu key / right click on web, or the screen-reader action) opens the item's actions: availability as `Segmented` (optimistic, same `setAvailability` rules as the item screen), "לפריט" (flight kept), "הסר מהארון" with a confirm step (`archiveItem`). Failures show as `StatusLine`.
- Reserve duty in the grid: tiles toggle with ring + check, usual/all as `Segmented`, reminder under the header, floating `ActionBar` above the tab bar with the count and "סמן כבמילואים" / "ביטול"; away items as a `StatusLine` with the three actions.
- Library (additive): `Button` `dot`; `Tile` `imageRef` + web keyboard/right-click long-press; `MasonryGrid` `StickyHeaderComponent`, `ListSubheaderComponent`, `scrollRef`, `onScroll`; `StatusLine` `moreActions`; `Icon` `backpack`; new `TextTabs`. `Sheet`: the scrim closes only on a press that started on it (a touch long press opened the sheet under the finger and the release click closed it at once).
- Removed (no importers left): `features/wardrobe/{WardrobeGrid,FilterChips}.tsx`, `components/PressScale.tsx`.
- Look at: `design/screens/2026-11-18-wardrobe-*.png`. Not verified: native (no emulator), real writes (preview is read-only; every write shows its failure line), the away block on real data (checked once with a local, uncommitted override).

## 2026-11-18 (redesign 1.6: Item)

- Item screen rebuilt per DESIGN.md section 3 "פריט": hero 56% of the phone screen on its own tile tone, edge to edge, full cutout `contain`ed; `arrow_back` / `more_horiz` as 44 ivory squares on the hero corners (they scroll with it on a phone). Name (display-xl) and brand edit in place (blur/return saves, Escape cancels on web). Availability is the library `Segmented`. Every tag is a chip in a labelled hairline row; a chip opens a `Sheet` with the closed list and saves on choice (seasons: multi-select + done; formality: 1-10 grid). Optimistic: the store changes at once, a failed write rolls back and a `StatusLine` appears under that row. No edit mode, no save button. "Goes with" = up to 3 small flat-lays in a scrolling row, each garment opens its item. Overflow sheet: replace photo, improve with AI (price on the row when quoted), remove (confirm inside the sheet, ink, no accent). Desktop >= 900: two columns, picture held in the start column.
- One save path: `features/item/edit.ts` `editPayload(item, change)` builds the old editor's payload (trim, empty name keeps the old one, empty brand null, `normalizeTags` on a tag patch) and calls the same `updateItemDetails`. `ItemEditor.tsx` removed.
- Replace photo: when background removal fails the uncut photo is still saved, and now a status line says so.
- `RedrawComposer` restyled with library Chip/Button/StatusLine/Meta; new optional props `sheet` (own sheet, paid button + budget pinned in the footer) and `error`. Same logic; long-press on a detail also has a button route (empty "own detail" note offers the chosen details as starting text). Intake's inline use is unchanged in props.
- Shared element (`features/item/transition.ts`, additive): origins carry a tone, a picture rect and `loose`; `registerOrigin` / `flyFrom` / `getFlightOrigin` / `captureReturn` let any picture be an origin. Today's flat-lay ("לפריט" in the piece sheet) and "goes with" garments fly; the ground expands from the origin, the picture scales uniformly; back flies to the pressed garment if still measurable, else fades. Old exports unchanged.
- Library (additive): `Chip` `accessibilityLabel`/`accessibilityHint`/`onLongPress`/`stretch`; `Button` icon `surface`; `FlatLay` `numbered`, `onPieceNode`, exported `flatLayTone`.
- Look at: `design/screens/2026-11-18-item-*` (top/tags/goes-with 390 he+en, bottom, shoes 360, no photo, sheets, rollback, name edit, overflow, remove confirm, composer states, 1280 he+en, flight strips from wardrobe/Today/goes-with and back).
- Not verified: native (no emulator); real writes and the paid redraw (preview blocks them: the failure lines were seen, the success paths were not); price on the button (preview returns no quote).

## 2026-11-18 (polish: sign-in, wardrobe gap, tile tone, lint)

- Sign-in: the Latin app name is in a start-aligned box (same fix as Tile captions and Sheet titles), so it sits on the start edge in he and en.
- Wardrobe "all": the first section heading is now 24 below the visible swatch row (the row is a 44 hit box around 24 swatches, so the spacer is 14); with active-filter chips it stays 24; sections keep 48 between them.
- `tile-cool` #E3E3DD -> #E6E3DC (tokens.base.js, DESIGN.md section 2): less green next to the warm tiles. Beige tee and khaki chinos still read clearly against it (ground moved by 3 on red, 1 on blue).
- Lint clean: the `mounted` flag in the root layout is `useSyncExternalStore` (server false, client true) instead of setState in an effect; the two `i18n` imports are one (kept first); `T[]` instead of `Array<T>`; `i18n.use` goes through the named `use` export.
- Look at: `design/screens/2026-11-18-sign-in-idle-*`, `2026-11-18-wardrobe-all-*`.

## 2026-11-18 (redesign 1.6: Item fix round)

- Shared element: the origin's picture is hidden for the whole flight in both directions and shown again on landing, on an exit without a flight, and when the item screen unmounts (browser back). Hiding goes by the measured node: `components/ui/originVisibility.ts` (`useOriginVisibility`, `setOriginHidden`), wired into `Tile` (`imageRef`) and `FlatLay` (`onPieceNode`; the node now lives inside each garment). `transition.ts` adds `getFlightNode` and re-exports `setOriginHidden`; `captureReturn` now returns `{ origin, node }`. No wardrobe screen change. The page fades out at once on the way back again (the delay only masked the double).
- Back from a deep-linked item (no history) now goes to Today instead of leaving a blank page.
- Availability to spec rows: 32 instead of 48.
- Screen-reader labels and hints on the item screen and in the composer have the bidi isolates stripped (`features/item/a11y.ts` `spoken`); visible text keeps them.
- Look at: `design/screens/2026-11-18-item-flight-*` (re-shot), `-tags-390-*`, `-1280-*`, `-browserback-today-390-he`.

## 2026-11-18 (redesign 1.6: Item, verification fixes)

- Name field: Enter saves and closes on web (the multiline textarea inserted a line break) and on native; a saved name or brand never contains a line break. Brand and name controls: the spoken name starts with the visible text ("הוסף מותג" when empty), and the small brand control is a real 44x44 pressable box on web with no visual change.
- Flight start: the flying picture stays invisible until it has been drawn, then appears in the same frame the origin's picture is hidden (per-frame probe, wardrobe x3, Today x2, goes-with x2: no frame with zero or two copies).
- Reversible picks: colour and leg-length picks are built against the item as the screen opened it (`edit.ts` `colorPatch`, `legPatch`), so jeans -> shorts -> long gives jeans and a colour changed back gets its measured hex, as in the old editor.
- Error lines end with their action: any next edit on the details clears the last failure; "keep" clears the remove failure; closing the composer clears its failure.
- Composer garment words expose `aria-expanded` on web. Library `Chip` has no `expanded` prop yet, so tag chips do not.

## 2026-11-18 - Verification fixes

- Wardrobe: a filter chip applies and closes the sheet (tune + chip = 2 taps); "show N" footer removed; "נקה" in the active-filter row clears colour/type/season/availability in 1 tap and keeps the category. DESIGN.md "ארון" item 7 updated.
- Today: 24px above the masthead and 16px between masthead and hero, so the whole flat-lay clears the action bar at 390x844 and 360x800; credits line sentence case; hero garments out of the Tab order on web (legend rows are the 01..04 stops).
- Reserve duty failure line clears on cancel. `/location` back/choose go to `/profile` when there is no history. Sign-in still life hidden from assistive tech; Monogram uses the 16px token.
- Look at: design/screens/2026-11-18-{today-default,wardrobe-filter-sheet,wardrobe-filters-active,sign-in-idle}-*.png

## 2026-11-18 (redesign 1.7: accessibility fix round)

- State reaches the DOM on web: `webStateProps` in `ui/interaction.ts` maps an accessibility state to `aria-selected` / `-checked` / `-pressed` / `-expanded` / `-disabled` (nothing on native). Used by TextTabs, Swatch, Chip, Segmented (radiogroup + radio), Tile (checkbox), ListRow, TabBar, TopNav, Button. Model: chips and swatches are toggle buttons (`aria-pressed`, also in single-choice rows; a removable chip has none); tabs `aria-selected`; segments `aria-checked`. `Chip` and `Button` take `expanded` for sheet-openers.
- Real 44x44 hit boxes on web (react-native-web ignores `hitSlop`): the Pressable is the 44 box, the 36 chip / 32 ring a centred child; negative margins keep the footprint. Category tabs and TopNav destinations carry their gap as padding (12 / 16 each side) so a short word is still 44 wide; text buttons get `minWidth` 44. Visible sizes and rhythm unchanged (measured). A chip inside a horizontal ScrollView needs 4px of vertical room or the box is clipped back to 36: fixed in intake `ChoiceRow`; the wardrobe active-filter row still needs it.
- Blurred tab screens leave the web tab order and accessibility tree: `features/shell/SceneGate.tsx` (`screenLayout`) marks them `data-scene-hidden`, `visibility: hidden` in `global.css`. State and scroll stay mounted.
- `Display` has `level` (1-3, default 2; `role=heading` + `aria-level` on web); ScreenHeader's title is level 1; Sheet's title is level 2.
- Sheet is one dialog named by its title (`aria-labelledby`, or `aria-label` without a title) on RNW's own Modal element; its two focus sentinels and the scrim are out of the tab order and the tree, Tab / Shift+Tab wrap inside the dialog.
- Look at: wardrobe header rows and the design-system chips / swatches at 390 (should look identical to before); Tab on `/insights` after visiting Today and Wardrobe; the Filter sheet with a screen reader.

## 2026-11-18 - Leftovers

- `FlatLay` takes `pieceFocusable` (default true). False sets `focusable={false}` and `tabIndex={-1}` on the garment buttons (react-native-web renders a `<button>`, which Tab reaches unless `tabIndex` says otherwise); they stay clickable and named. Today passes it (legend rows are the 01..04 stops); the MutationObserver stopgap `useOutOfTabOrder` is deleted. The item screen's "goes with" flat-lays keep their stops.
- Heading levels: `Display` takes `level={null}` for display type that is not a heading (Today's pull quote). Today title, item name, sign-in, consent, not-found titles are level 1 (`EmptyState` takes `level`, default 2); the item name is an h1 around its edit button at rest and a plain labelled field while editing (`InlineText headingLevel`). Gallery masonry category heads are level 3. No more `accessibilityRole="header"` on `Display` (it was overridden by the explicit role on web anyway).
- Wardrobe active-filter chip row: 4px of vertical room in the scroll content and a -4 margin, so a chip's 44 box is no longer clipped to 36 (row and content below did not move). It was the only remaining clipped chip scroller.
- `ListRow` choice rows use `aria-pressed` (not `aria-selected`, invalid on role=button).
- design/screens/after/ and the 360/430 today-default shots re-taken from the final build.
- Look at: Tab on `/` (weather, 4 legend rows, wear, tune); the heading outline per screen; the active-filter chip row at 390.

## 2026-11-18 (redesign stage 1 closed)

- Stage 1 of `docs/REDESIGN_PLAN.md` is complete on `claude/gifted-goldberg-9498c1`: DESIGN.md v2, the component library (`apps/mobile/src/components/ui/`, gallery at `/design-system`), bottom tab bar and desktop top nav, and every existing screen rebuilt on the library. No change to the data model, the Edge Functions or the MCP tools.
- Verified in Chromium on the web build with the read-only design preview, at 390 and 1280, Hebrew and English. Not verified: Android, real writes, the real intake pipeline, the paid redraw, real Google sign-in. `TASKS.md` lists what is open and who can close it.
- Look at: `design/screens/before/` vs `design/screens/after/` (same names), `docs/redesign-checklist-part1.md` and `part2.md` for the regression tables and defects.
- lint went from 20 problems to 0; typecheck and tests pass.

## 2026-11-19 - Intake queue (stage 2, task 2.3)

- The Add screen shows "Waiting for Claude" under the two buttons: the photos sent with "send to Claude" that Claude has not tagged yet, 3 per row on a phone and 6 from 900, each with when it was uploaded (relative for 24 hours, then a short date). Not rendered when the queue is empty. Refreshes on screen focus and after a send batch; no polling.
- `listPendingForClaude` in `data/intake.ts` lists `cutouts/{uid}/pending` with the same folder, extension filter and page size as the MCP's `intake_pending`, newest first. It is a read, so it also runs in the design preview (the bucket is publicly readable).
- Thumbnails are images, not buttons: the bucket has no delete policy, so dismissing stays in the chat (`intake_dismiss`).
- Gallery: loading, one photo, seven photos, failure in the intake block of `/design-system`.
- Look at: `design/screens/2026-11-19-intake-queue-*`; the Hebrew hint line (explicit RTL, it starts with "Claude"); a real send-then-refresh on a signed-in device (not exercised).

## 2026-11-19 - Item: notes, wear history, manual re-cut (stage 2, task 2.2)

- Notes: a "הערות" section after the tags, edited in place like the name (`InlineText multiline`: Enter is a new line, blur saves, Escape cancels on web), 500 characters with a mono counter from 400. Saved through the one payload builder (`editPayload` now carries `notes`; trimmed, empty is null) and the item route's optimistic save, which writes `updateItemNotes` (new, `data/items.ts`) when only the notes changed.
- Wear history: a "לבישות" section after notes: "נלבש N פעמים · לאחרונה ב-<date>" (Hebrew one/two/other forms) or "עוד לא נלבש", five newest wears as hairline rows (numeric date in mono, the outfit's other pieces), "הצג הכול" expands in place. `fetchItemWears` (`data/feedback.ts`): worn wears whose outfit holds the item, all time, newest first, 50 rows, exact count. The design preview derives it from the snapshot, i.e. only the last 31 days. The preview has no worn outfit, so the rows are shown with a fixture in `/design-system` ("מסך פריט: לבישות").
- Manual re-cut: "חיתוך רקע מחדש" in the item's overflow sheet when the item has a source crop; the same free intake-cutout call as "replace photo", on that crop. Busy line under the hero, the hero updates on success, a failure line with the reason (and "נסה שוב" when retrying can help).
- Not verified: native; real notes writes, the real history query with data (only its syntax against PostgREST, as anon) and a real re-cut, all blocked in the preview.
- Look at: `design/screens/2026-11-19-item-*.png`.

## 2026-11-19 - Stage 2.1: wardrobe search, Shabbat and formality filters, archive

- Wardrobe search (DESIGN.md "שלב 2"): `search` before `tune` swaps the title row for a focused `SearchField` + live count + `close`; name or brand, substring, any case, trimmed (`matchesQuery` in `features/wardrobe/filters.ts`), AND with category, colour and sheet filters. Close / Escape clears. Desktop: field always in the header, 280 wide. No-match quotes the query and offers "נקה". `SearchField` gained `autoFocus` and `onEscape`.
- Filter sheet rows "הקשר" (one chip, "לשבת") and "רשמיות" (1-4 / 5-7 / 8-10). "לשבת" uses the new engine export `passesContextRules(item, DEFAULT_CONTEXT_RULES.shabbat)`, which `hardFilter` now calls for its context part (same behaviour, test in `context-rules.test.ts`; `engine.js` re-bundled). Outerwear and accessories have no Shabbat rules and pass.
- Archive: `/archive` (above the tabs, back falls back to `/profile`), masonry of archived items, sheet with "שחזר לארון" (optimistic, rolls back with an error line). Data: `useArchivedItems()`, `useArchivedCount()`, `useSetItemStatus()` in `data/WardrobeProvider.tsx`; archived rows already came with `fetchWardrobe` and the preview snapshot, no new query.
- After a removal from the long-press sheet, an undo line "הוסר מהארון · ביטול" pinned under the category row until the next action; a failed undo shows an error line with retry.
- Look at: `design/screens/2026-11-19-wardrobe-*` and `2026-11-19-archive-*`; the Shabbat list (outerwear jackets with formality 3-4 are in it, by the rules as written).

## 2026-11-19 (stage 2: insights and profile)

- Insights: "Wears, last 30 days" (days with an outfit, distinct items, most-worn item with ties to the most recent; a 30-day ink/hairline strip, newest at the end side, one focusable group with a summary and a named square per day; recent outfits as small flat-lays, 10 then "show more", garments open the item with the shared-element flight) and "AI cost this month" (total, Google spend bar against the $8 cap with a warn line from 80%, cost by task). Reads in `src/data/insights.ts`; the preview has no `ai_calls`, so it says so instead of showing numbers. Gallery has an Insights block with fixture states.
- Profile: language `Segmented` (stored on the device, wins over the device locale; web flips text, `dir` and tab order at once; native shows a restart note for direction), "Archive" row with count linking to `/archive` (route lands with the wardrobe work), "Sign out" with a confirmation sheet (preview: forgets the preview code and reloads to sign-in).
- Outside the owned folders: root `_layout.tsx` computes `dir` per render from the active language; `useRtl` re-renders on a language change and on native reports the drawn direction; `kv.ts` gained plain settings; `preview.ts` exports `forgetCode`.
- Look at: `design/screens/2026-11-19-insights-*` and `-profile-*`; the "fixture" insights shots use real items with synthetic worn wears injected in the test browser only (the real snapshot has no worn wear).

## 2026-11-19 (stage 2 fix round: insights, intake, profile)

- Insights "today" is the saved location's date (`wearsToday` in `data/insights.ts`, via `dayContext.localDate` and `resolveLocation`), the same as Today and as the date wears are written with; the window and strip end on it. An outfit row is now one button (name = date + garments, min height 44) that opens a sheet of the garments (`type · name`, chevron, each to `/item/<id>`); the small flat-lay is only a picture. Most worn: ties resolve by count, then latest wear date, then name; the label pluralises (`count`, he one/two/many/other) and stays on one line, the item name takes two lines at most.
- AI spend is read by paging `.range()` in 1,000-row pages (cap 20 pages; if hit, a `Meta` line says the total is partial). Strip: app focus ring, empty squares outlined in `ink-faint` (4.8:1). New type token `num-lg` (28/34 Plex Mono, DESIGN.md section 2); widths on the 4-scale (`w-24`, `w-16`).
- Hebrew relative times in the intake queue: "לפני דקה", "לפני שעה", "לפני שעתיים" are i18n strings (Intl added a stray numeral); other counts and English stay on Intl. Profile's archive count comes from `useArchivedCount()` (its own query is gone).
- Look at: `design/screens/2026-11-19-insights-fixture-*`, `-insights-row-sheet-*`, `-intake-queue-seven-*`.

## 2026-11-19 - Fix round: keyboard patterns, Shabbat filter for coats and accessories, Today focus and hero cap, search polish

- `Segmented` is a WAI-ARIA radiogroup on web (one tab stop on the checked radio; arrows, Home / End and Space choose and move focus; Enter already did) and `TextTabs` a tablist with automatic activation (the grid re-filters cheaply, so focus follows selection). Horizontal arrows follow reading order, so in Hebrew ArrowLeft is "next". Shared in the new `components/ui/roving.ts`; native unchanged.
- `SearchField` is 44 high at every width: the 1px underline took a pixel from the input (43); it is now its own layer and the input carries `layout.hit`.
- Wardrobe "לשבת": an item with no slot (outerwear, accessory) passes only when it passes the engine's layer gate (`passesContextRules` on a layer stand-in, so the bound and slack come from the rule data and `FORMALITY_SLACK`: formality 6+ today). On the real wardrobe 32 items passed before, 27 now: the puffer, zip jacket, softshell and both caps leave, the wool coat stays. Engine untouched.
- Search folds the ASCII apostrophe / quotes with Hebrew geresh / gershayim, strips Latin diacritics and niqqud (`normalizeSearch`). The title row replaced by the search field on a phone keeps a visually hidden level-1 heading. The two "נקה" buttons are now "נקה חיפוש" (no-match state) and "נקה סינון" (chip row).
- Today: on mobile layout at 600+ the flat-lay is a centred 4:5 card with radius 6, capped so it ends 8px above the action bar at scroll top (below 600 unchanged). The failure line is cleared when another action starts (adjust or piece sheet; wear / skip already did). After wear, skip and undo focus moves to the new status line's undo (or the line itself when it has no action), and back to "wearing it" after an undo. A failed pair-weights write after a stored wear is logged and no longer shows "didn't save".
- Look at: `design/screens/2026-11-19-wardrobe-shabbat-*` and `-nomatch-*`. Not verified: native; real writes (the preview rejects them, the success paths were driven in a throwaway build with local fake writes).

## 2026-11-19 (item fix round: flight, focus, optimistic edits, re-cut, undo)

- The screen under the item modal stays painted: `SceneGate` hides a tab scene only while another tab is selected (tab navigator state), and the tabs layout makes everything under a modal route `inert` + `aria-hidden` instead (native: hide-descendants flags). Flights from the wardrobe, Today and "goes with", both directions, he/en, 390/1280: 0 frames with no garment, 0 with two (rAF probe).
- Focus: item tab order is Back, More, details; keyboard Back returns to the opening tile (or its re-rendered twin, else the screen's first control); Enter/Escape in an inline field return to its edit button; sheets focus their first content control (never the dialog host), remember their opener across a sheet that opened them, and return focus there; the composer keeps focus on "+ Other…" after a note.
- Optimistic item edits go through one serialised per-item queue (`features/item/editQueue.ts`, driver `editRunner.ts`): edits carry only their fields, writes go one at a time over the confirmed state, a failure rolls back only its own fields, and a write that settles after the screen closed still settles the wardrobe store. Tests: `apps/mobile` now runs vitest for its pure modules (`pnpm test`).
- "Remove the background again" on an AI-redrawn or hand-cleaned picture asks first (`features/item/recut.ts`); undo line after removal from the item screen (last removed item moved into `WardrobeProvider`); composer word buttons are 44 boxes; long-press chips carry an `aria-description`; logical text alignment; capped wear list says so.
- Look at: `design/screens/2026-11-18-item-flight-*` (replaced, plus en/1280 strips), `2026-11-19-item-recut-confirm-*`, `2026-11-19-item-composer-390-he.png`.

## 2026-11-19 (ListRow Latin truncation, wardrobe tabs under a filter)

- `ListRow` sets an explicit `writingDirection` on label, meta and value from the dominant script of the string (`components/ui/textDirection.ts`, first strong character on a tie, digits only = LTR), inside a start-aligned box. A long Latin name in a Hebrew row ("חולצה · Carhartt WIP Detroit Jack…") now loses its end, not its start; Hebrew-only rows are unchanged. Side effect: a mixed row that fits ("מגפיים · Salomon Hiking Boots") is now drawn left-to-right inside the row, so the Hebrew word sits left of the name.
- Wardrobe: with a sheet filter, colour, search or reserve-mode narrowing active, the category tabs show only categories with a match (counted with the grid's own `applyFilters` and `matchesQuery`), plus "הכל" and the selected category even when empty. With nothing active the row is as before.
- Look at: Insights outfit sheet with a long item name (he/en, 390), the wardrobe under "לשבת" (no accessories tab). Not verified: native (no emulator).

## 2026-11-19 (redesign stage 2 closed)

- Stage 2 of `docs/REDESIGN_PLAN.md` is complete on `claude/gifted-goldberg-9498c1` (PR #23): wardrobe search, Shabbat and formality filters, archive with restore and undo; item notes, wear history, guarded re-cut; the intake queue; Insights; Profile language switch, archive row and sign-out. No migration, no Edge Function change. `packages/engine` exports `passesContextRules` (behaviour unchanged).
- Two independent verifications (`docs/redesign-checklist-stage2.md`, `docs/redesign-checklist-recheck.md`) found a live regression from stage 1 (the screen under the item modal disappeared during the flight), a re-cut that would have replaced AI redraws, races in optimistic edits, and keyboard and focus gaps. All fixed; `apps/mobile` now has a vitest suite (21 tests) for the pure logic.
- Not verified: Android, real writes, the first real wear, a real `ai_calls` read. `TASKS.md` "Open after stage 2" lists them.

## 2026-11-19 (Today: worn state)

- After "לובש" the floating bar is gone and the worn line ("נרשם · ביטול") and the laundry line take the skip line's slot between masthead and flat-lay, so the shoes are no longer covered (DESIGN.md section 3 "היום" item 8). A failed "לובש" still shows in the bar. Focus after a wear lands on the worn-status wrapper (`today-worn-status`), after an undo on the button, back in the bar.
- Look at: `features/today/TodayView.tsx` (`wornStatus`, `barStatusLine`, the focus effect). Not verified: native, a real write (checked on web with the preview writes stubbed in a throwaway build).

## 2026-11-19 (Shabbat times: current location)

- "My current location" now lights candles by the local custom: `candleLightingMinutes` (pure, `apps/mobile/src/data/candleLighting.ts`) returns 40 inside Jerusalem's municipal boundary, 30 inside Haifa's or Zikhron Ya'akov's, 20 elsewhere in Israel, 18 abroad, and `loadCalendar` sends it as `b=`. Before, Hebcal gave coordinates its own default (20 in Israel): Jerusalem showed 16:17 instead of 15:57 on 2026-11-20. Chosen cities (`geonameid`) are unchanged. Cache key bumped to `hebcal:v3`.
- Boundaries are simplified OpenStreetMap relations (about 100 m edge accuracy) in `candleLightingBounds.ts`. Look at: the header there for sources, and `candleLighting.test.ts` for the landmark points. A place within ~100 m of a city border can land on the wrong side.

## 2026-11-19 (Today: end of Shabbat, candle lighting named by the day)

- The times row under the date now follows DESIGN.md section 3 "היום" item 1: "כניסת שבת" only on a Friday, "הדלקת נרות" on any other candle-lighting day, plus "צאת שבת" / "צאת החג" when the end is today, or tomorrow when candles are lit today (never further away). Pure logic in `data/shabbatTimes.ts`, tested on 13 saved real Hebcal responses (`data/__fixtures__`). `loadCalendar` asks Hebcal for today and tomorrow, but day type and holiday still come from today's events only; cache key is `hebcal:v4`. `DayContext.candleLighting` became `candles` and `end`.
- Hebcal facts: Chanukah candles are `holiday` events, not `candles`, so a weekday Chanukah night shows no line; Yom Kippur ends with an ordinary `havdalah` item; Rosh Hashana 2027 (Sat-Sun) is two days even in Israel, so its eve (a Friday) shows no end.
- Look at: `TodayView.tsx` (`timesLine`). Not verified: native.
## 2026-11-19 (item: explicit save for name, brand and notes)

- Writing in place follows DESIGN.md section 4 "כתיבה במקום": nothing saves on blur. At rest a pencil (`edit`, 20 in a 44 box) at the end of the name and brand lines and of the notes heading; empty brand / notes are dashed "add" chips; tapping the text also opens writing. Writing: new library `EditField` (ivory, 1px ink, radius 6, padding 12, caret at the end) with "שמירה" (ink, disabled when unchanged or an empty name) and "ביטול"; notes counter from 400 on the same row. Enter saves name/brand, Ctrl/Cmd+Enter saves notes, Escape cancels. One field at a time: switching saves a changed valid field (an empty name is cancelled). Leaving the screen (back, hardware back, browser back, goes-with) saves a changed valid field through the edit queue.
- After a save "נשמר" for 2 seconds in a polite live region (light haptic on native); a failed save reopens the field with the typed text and an error line with "נסה שוב". Focus returns to the field's pencil.
- Web keeps the button row above the on-screen keyboard (`visualViewport`); native relies on `automaticallyAdjustKeyboardInsets` and `keyboardShouldPersistTaps="handled"` on the item scroll view (unverified, no emulator).
- Pure decisions in `features/item/writing.ts` with tests; state in `useTextWriting.ts`; gallery fixtures (rest, writing, saved, failed) in the item block of `/design-system`.
- Look at: `design/screens/2026-11-19-item-writing-*`.

## 2026-11-19 (Today: tomorrow on a holiday's end, fast ends on Yom Kippur)

- The end in the times row says "מחר" / "tomorrow" when it is tomorrow's and today is not a Friday ("הדלקת נרות 18:54 · צאת החג מחר 19:53"); on a Friday it stays "כניסת שבת 16:18 · צאת שבת 17:17". Yom Kippur says "צאת הצום" / "Fast ends". `shabbatTimes` returns `end.day` and `end.kind: "fast"`; Yom Kippur is detected by `title_orig === "Yom Kippur"` (English whatever `lg` is) on the day the havdalah belongs to. New fixture: Yom Kippur day.
- Labels use no-break spaces, so on a narrow screen the row breaks only at " · ".
- Double Hebcal request: `getJson` (`dayContext.ts`) now shares an in-flight request per URL. A plain cold load in a fresh browser sent each URL once, so the doubling was not reproduced; the likely paths are `useDayContext` mounted in two screens (Today, sign-in) and its reloads on location or place-name events, both before the first answer reaches the cache.
- Look at: `TodayView.tsx` (`endKeys`). Not verified: native.
## 2026-11-19 (item writing: leaving waits for the save)

- Leaving the item screen with an open, changed, valid field saves it first; the screen goes (with its flight back) only after the save succeeded. While saving "שמירה" reads "שומר" and is inert; a failed save keeps the screen with the field, the typed text, the error line and "נסה שוב". One write per leave. Unchanged or invalid (emptied name) open fields are dropped and do not block. Covered: the back button, Android back, browser back and other navigator removals (`usePreventRemove`), "goes with", and closing after removal. Decision in `writing.ts` `decideLeave` with tests.
- A failed save puts focus back in the reopened field (caret at the end). A failure while another field is open keeps its text and error line until it is saved or cancelled; leaving then reopens it instead of losing it.
- Name and brand text at rest are no longer tab stops; the pencil is the only keyboard and screen-reader control.

## 2026-11-19 (stage 3 merged, stage 4 proposed)

- Stage 3 (fixes from Roy's use of the live app) merged as PR #24 after two independent verification passes (`docs/redesign-checklist-stage3.md`).
- `docs/REDESIGN_PLAN.md` now has "Stage 4 - from a finished redesign to a daily habit": Friday for Shabbat, Android, a morning notification on the device, manual contexts, reserve packing, hardening, clean-up. It rests on an inventory of the PRD against the code made the same day. Nothing in it is started; it waits for Roy's go.
- Look at: the stage 4 table and the "Not in stage 4" table; `TASKS.md` "Open after stage 3".

## 2026-11-19 (stage 4 part 1 closed; stage 5 planned)

- Independent verification of Shabbat planning, the observance switch and the hardening items, and a recheck after the fix round: `docs/redesign-checklist-stage4-part1.md`. No blocker and no major defect; open minors are in `TASKS.md`.
- `supabase/functions/_shared/engine.js` rebuilt from the engine (`scripts/bundle-engine.sh`): the white-shirt preference, the future-dated wear fix and the Yom Kippur rule set are now in the bundle the `mcp` function runs. `supabase/config.toml` now lists `mcp` and `design-preview` with `verify_jwt = false`, as deployed.
- `docs/REDESIGN_PLAN.md` "Stage 5": hand-built and saved outfits with favourites (a "לוקים" place in the bottom bar, Insights moves into the profile), alternatives after wearing, the algorithm's judgement, and a try-on experiment. Decisions and their reasons are there.
- To deploy with this merge: migration 0006, then the `mcp` function from `scripts/bundle-mcp.sh` with verify_jwt off.

## 2026-11-19 (deployed: migration 0006 and mcp version 9)

- Migration `0006_profile_observance` applied to the project and checked in `information_schema`.
- `mcp` redeployed as version 9 from `scripts/bundle-mcp.sh` (verify_jwt off, as before): the context tools, `outfit_today` honouring the day's occasion and the observance setting, and the rebuilt engine. Deployed source equals the bundle byte for byte; an anonymous call answers 401 with `www-authenticate`; `outfit_today` through the connector returns `context_used`.

