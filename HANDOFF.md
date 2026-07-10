# Handoff — 2026-07-09

Written to hand this repo to a fresh session cold. For the authoritative
build/verify status read [ROADMAP.md](ROADMAP.md); this note is the orientation
that gets you there, plus the things that will bite you in the first ten minutes.

## Where we are

All five roadmap phases are built and on `main` (14 commits this session,
`5c9d44f..HEAD`). CI is green. The suite is **95 tests across 9 files**;
`pnpm lint`, `pnpm check`, `pnpm test`, and `pnpm build` all pass.

The app: sign in with Google → pick a template (with a live thumbnail) → edit
through the structured form **or** by chatting with Claude → upload a photo →
watch a Typst-rendered PDF update beside it → download. Multi-user, per-user
ownership, email allowlist + single-use invite codes.

## What was accomplished this session

Started from a repo where only Phase 1 (the walking skeleton) existed.

| Phase | What landed | Commit |
| --- | --- | --- |
| Tooling | pnpm 11 install fixed (native build + supply-chain policy) | `a8de80c` |
| 2 | Chat agent — MCP tools, streaming route, ChatPanel, daily turn cap | `abd78fd` |
| 3 | Photo uploads — decode/re-encode, strip metadata, opaque ids | `50f5f25` |
| 4 | Sections add/remove/reorder/convert; bullet + exhibition editors | `208ffdd` |
| 4 | Duplicate + rename a résumé | `313970b` |
| 4 | Manage uploads from Settings; reap orphans | `c467e5e` |
| 4 | Template gallery thumbnails | `239b443` |
| 5 | Token budget, burst control, bounded invite guessing | `5ca385f` |
| 5 | drizzle-orm 0.36→0.45 (closes GHSA-gpj5-g38j-94v9) | `31ece4f` |
| 5 | Prettier config + fix (`pnpm lint` now runs) | `1a1866b` |
| 5 | ESLint flat config + GitHub Actions CI | `7098ee0` |
| 5 | Drop the dead `users.theme` column (migration `0001`) | `1154fc4` |
| 5 | Accurate render-time egress docs | `385637b` |

Two independent reviewers (security + TypeScript) ran against Phases 2 and 3 and
found real bugs, all fixed. The "as built" corrections to the original plan —
several of them security-relevant — are recorded in ROADMAP.md under **Phase 2,
as built**. Read that section before touching the agent; it will save you the
same discoveries.

## What's left

Nothing from the numbered phases. The open items are all in ROADMAP.md's
**Known smaller gaps**; the ones that matter for the next session:

- **The chat agent has never run against the real Anthropic API** — only a stub.
  The wiring is proven end-to-end; the _prompt_ (`src/lib/server/agent/prompt.ts`)
  is not. The single highest-value next step is to point it at a real key, drive
  a few real edits, and iterate on that prompt.
- **Render-time network egress** is understood and bounded (registry-only, not
  SSRF, timeout-killed) but not closed — it needs an operator egress policy, not
  a code change. `docker-compose.yml` documents it.
- Single-instance assumptions: the per-résumé lock (`locks.ts`) and the rate
  limiter (`ratelimit.ts`) are in-process. Fine for one instance; move into
  SQLite before running two.
- Smaller: `pnpm build` leaves an empty gitignored `data/*.db` (SvelteKit route
  analysis opens the DB at import); template thumbnails cache until
  `data/thumbs/` is deleted; dev-only `vitest`/`vite` advisories remain
  (`pnpm audit --prod` is clean).

## First-ten-minutes gotchas

The dev box does **not** have the toolchain a fresh clone needs:

- **`node_modules` may be absent or unbuilt.** Run `pnpm install`. pnpm 11 reads
  build-script approval from `pnpm-workspace.yaml` (`allowBuilds`), _not_ the
  `pnpm` field in package.json — without it `better-sqlite3`'s native binding is
  silently skipped and every test fails opening the database.
- **Typst is not on PATH by default.** Tests mock the compiler, so `pnpm test`
  works without it, but running the app or `pnpm render:templates` needs it:
  `curl -fsSL https://github.com/typst/typst/releases/download/v0.15.0/typst-x86_64-unknown-linux-musl.tar.xz | tar -xJ -C /tmp && mv /tmp/typst-*/typst ~/.local/bin/` (then `export PATH="$HOME/.local/bin:$PATH"`).
- **No `ANTHROPIC_API_KEY`** on the box. Chat is off without it (the tab says so,
  the endpoint 503s). To exercise a real chat turn without a key, the pattern
  used this session was a stub Messages API pointed at by `ANTHROPIC_BASE_URL` —
  the SDK honours it.
- **Tests choose their own throwaway `DATA_ROOT`** in `vite.config.ts` (guarded
  by `process.env.VITEST`), because `$env/dynamic/private` snapshots the
  environment when the SvelteKit plugin loads — setting env from a setup file is
  too late and would migrate the real `./data` DB.

## Map

| Path | Role |
| --- | --- |
| `src/lib/server/agent/` | Claude Agent SDK session + JSON-only MCP tools |
| `src/lib/server/uploads.ts` | Image ingest: decode, re-encode, strip metadata |
| `src/lib/server/compile.ts` | Sandboxed Typst compile (throwaway `--root`) |
| `src/lib/server/usage.ts` | Per-user daily turn + token ceilings (atomic) |
| `src/lib/server/ratelimit.ts` | Sliding-window limiter (chat burst, invites) |
| `src/lib/sections.ts` | Section construction + lossless kind conversion |
| `src/lib/server/access.ts` | Allowlist, invites, ownership checks |

Every claim in ROADMAP.md's **Verified in Phase N** tables was checked against a
running server, not assumed. Re-run those after any change to `compile.ts`, the
templates, or the agent.
