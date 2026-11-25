# What changed (repo polish, 2026-11-25)

Branch `chore/repo-polish`. No app, engine, function or database behaviour changed. The full audit is in [docs/REPO_AUDIT.md](docs/REPO_AUDIT.md).

## What changed and why

| Change | Why |
| --- | --- |
| `docs/REPO_AUDIT.md` | Phase 1 audit: architecture, baseline, findings, what becomes public |
| `docs/redesign-checklist-*.md` moved to `docs/verification/` | Reports were mixed with the spec; references in `TASKS.md` and `REDESIGN_PLAN.md` updated |
| `docs/KICKOFF_PROMPT.md` moved to `docs/archive/` with a note | Its setup steps are out of date and it mentions subscription details |
| `.env.example` rewritten | It named `MODAL_WORKER_URL` (code reads `MODAL_CUTOUT_URL`), listed unused home coordinates and missed `GEMINI_IMAGE_API_KEY`, `R2_*`, `DESIGN_PREVIEW_CODE` |
| `pnpm test:functions` and a `CLAUDE.md` fix | `pnpm test` never ran the 50 Deno tests although `CLAUDE.md` said it did; the function list was incomplete |
| `.github/workflows/ci.yml` | Typecheck, lint, vitest and Deno tests on every pull request and on `main` |
| README rewritten | Wrong setup step (env file location), outdated diagram (no R2); now has badges, contents, real-wardrobe screenshots in `docs/assets/`, MCP tool list, links |
| `CONTRIBUTING.md`, `.github/pull_request_template.md` | The `CLAUDE.md` workflow in a form GitHub shows to contributors |
| `.editorconfig`, `.markdownlint.jsonc`, root `.gitignore` entries | Consistent formatting; ignore `web-build/`, `coverage/`, `*.tsbuildinfo`, `.vercel/` |
| Module headers on `packages/engine` and `packages/schema` entry points | Why the engine is pure and why the two barrels differ on import extensions |

## Verification

- `pnpm typecheck`, `pnpm lint`: pass. `pnpm test`: 834 pass (same as baseline). Deno: 50 pass.
- Web export (`expo export --platform web`) builds with the public env values.
- Relative links in every markdown file resolve. External links: all reachable except GitHub pages of this repo, which return 404 to anonymous requests while it is private; checked through the API instead.
- markdownlint: 0 issues in the new files. The Mermaid diagram validates.

## Left for you

1. **License.** Done: MIT (Roy, 2026-11-25), `LICENSE` added.
2. **Before flipping to public**, decide on the personal details in the files and the history (audit section "Before the repo goes public"): home city, Shabbat and reserve-duty rules, the wardrobe list, the Supabase project ref. Removing them from history needs a rewrite or a fresh repo.
3. **GitHub metadata.** Applied on 2026-11-25 (Roy's go):
   - Description: `Hebrew-first personal wardrobe and AI styling app: photo intake, a deterministic outfit engine with Shabbat and weather rules, and an MCP server for Claude.`
   - Topics: `expo`, `react-native`, `typescript`, `supabase`, `edge-functions`, `mcp`, `wardrobe`, `ai-stylist`, `rtl`, `hebrew`
4. **LinkedIn link** for the Author section (`TODO(owner)` in the README).
5. **Not touched on purpose:** the stale `supabase/functions/_shared/engine.js` (PR #51 rebuilds it) and the design-preview code path, due for removal.
6. After merge, the CI and last-commit badges render once the repo is public.
