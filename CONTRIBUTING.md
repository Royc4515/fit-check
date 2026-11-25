# Contributing

Fit Check is a personal project. Issues and suggestions are welcome; pull requests are reviewed against the rules in [CLAUDE.md](CLAUDE.md), which is the full guide. The short version:

1. **Read the spec first.** Scope and data model are in [docs/PRD.md](docs/PRD.md), everything visual in [docs/DESIGN.md](docs/DESIGN.md). If the spec is wrong, propose the edit in the same pull request; do not silently diverge.
2. **One thing per pull request.** One feature, one fix or one rule, on a branch named `claude/<topic>` or a similar topic branch cut from `main`.
3. **Each pull request carries its own** spec edit, tests, row in [docs/TASKS.md](docs/TASKS.md) and entry in [docs/CHANGELOG.md](docs/CHANGELOG.md).
4. **Checks before review:**

   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   ```

   ```bash
   pnpm test:functions
   ```

   CI runs the same commands ([.github/workflows/ci.yml](.github/workflows/ci.yml)).
5. **Anything a user can see** gets a screenshot in `design/screens/YYYY-MM-DD-<screen>.png` and a check by someone who did not write the code, at phone and desktop widths, in Hebrew and English.

Code rules that are easy to miss:

- The engine ([`packages/engine`](packages/engine)) is pure: no I/O, no `Date.now()`. Weights live in `config.ts`.
- No string literals in JSX; use `t('...')`. Logical properties only (`ms-`, `me-`, `ps-`, `pe-`), never `ml-` or `mr-`.
- All AI output is validated with zod and every AI call writes a row to `ai_calls`. A new paid call or provider needs the owner's approval with its monthly cost.
- Migrations are forward only; every table has `user_id` and an RLS policy.
- Secrets go in Supabase function secrets or Modal secrets, never in the app or in git.
