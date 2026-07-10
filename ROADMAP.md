# Roadmap — what's built, what's left

Phase 1 (the walking skeleton) is done and verified end-to-end: sign in, create a
resume from a template, edit fields, watch the PDF rebuild, download it. The
sandbox and access controls were tested, not assumed (see *Verified* below).

**Phase 2 (the chat agent) is built.** See *Phase 2, as built* below for the
places the plan turned out to be wrong.

Everything below is what remains, in the order it makes sense to build.

---

## Phase 3 — assets (the photo)

`assets` table and `lib/server/assets.ts` exist; `compile.ts` already resolves
opaque ids into the compile root. What's missing is the **upload route and UI**,
so `header.photo` is always `""` today and Jenny's seeded resume renders without
her photo.

- `POST /api/assets` — accept an image, cap size and dimensions, **re-encode**
  (strips EXIF/GPS and any polyglot payload), store at
  `data/assets/<userId>/<id><ext>`, insert an `assets` row, return the id.
- Form fields for `header.photo` and `education[].logo` that upload and store the
  returned id. Never a path: `resolveAssetPath()` is the only thing that turns an
  id into a filename, and it re-checks containment.

## Phase 4 — editor completeness

`ResumeForm.svelte` covers most of the schema but not all of it:

- Cannot **add, remove, or reorder sections**, or change a section's `kind`.
- Exhibition **`items[]` are not editable** (only entry title/meta/date are).
- Bullet `sub[]` editing is crude (a textarea, one per line).
- Resume **duplicate** action; rename from the workbench.
- The template gallery has no thumbnails.

## Phase 5 — hardening

`usage` now records per-user, per-day turns and tokens, and `CHAT_TURNS_PER_DAY`
is enforced. What's left:

- A daily **token** budget, not just a turn count — the tokens are already
  recorded, nothing reads them back. One 12-step turn costs far more than one
  one-step turn, so a turn cap alone is a loose bound on spend.
- Turns-per-minute, to stop one user monopolising the Typst semaphore.
- Rate-limit invite **redemption** attempts (codes are 128-bit and hashed, but
  attempts are currently unbounded).
- Redact more aggressively: compiler logs are stripped of paths
  (`compile.ts:redact`) but still quote the offending résumé line back to the
  owner. That's fine for the owner; make sure it never lands in a shared log.
- Sessions are purged at boot only (`purgeExpiredSessions`). Fine for now.
- `users.theme` is unused — the theme lives in `localStorage`. Either wire it up
  or drop the column.
- Deny the Typst child network egress at the container/host level. The package is
  vendored so nothing *should* be fetched, but `#import "@preview/..."` inside a
  user's bio would otherwise still try.
- CI: typecheck + build + `pnpm test`, and a secret/PII scan before publish.
- **`pnpm lint` cannot run.** There is no `eslint.config.js` (ESLint 9 requires
  flat config) and no Prettier config, so `prettier --check .` compares the whole
  tree against Prettier's defaults and fails on every file. Adding a Prettier
  config reformats ~59 files, so it wants to be its own commit. Separately,
  `prettier-plugin-svelte@3.5.2` throws `getVisitorKeys is not a function` on
  every `.svelte` file under `prettier@3.9.x` — it needs the v4 plugin.

## Known smaller gaps

- The chat agent has **never run against the real Anthropic API** — only against
  a stub. The wiring is proven; the *prompt* is not. Expect to iterate on
  `agent/prompt.ts` once a real model is editing real résumés.
- `edit_resume` takes the **whole document**, so every edit re-sends the résumé.
  Fine at these sizes; revisit if the 256 KB ceiling ever gets approached.
- The per-résumé lock (`locks.ts`) is an **in-process `Set`**. Two app instances
  against one database would not see each other's locks. Single-instance only,
  until it moves into SQLite.
- A turn cut short records a **floor**, not the true token spend: an assistant
  message's `output_tokens` is its count at `message_start`. Under-counts, never
  over-counts.
- `templates/starter/main.typ` **ignores `section.page`** — it's one continuous
  flow. That's intentional, but means moving a section to "p2" does nothing there.
- The seed example carries a `_comment` key; Zod strips unknown keys, so it's
  harmless, but it isn't part of the schema.
- `contact[].icon` is a closed enum (`email|phone|website|instagram|github`).
  Adding an icon means adding an SVG to the template's `assets/` and a branch to
  `icon-img` in `main.typ`.

---

## Phase 2, as built

The plan above was mostly right. Four things it got wrong, kept here because
each cost real time to find:

- **`jenn-resume` does not exist** anywhere on the dev box. There was nothing to
  port from; the agent was written from scratch against the plan's description.
- **`allowedTools` does not restrict the tool surface** — per the SDK's own docs
  it only auto-approves without prompting, so `Read`/`Bash` would still have been
  *available*. The option that actually removes them is `tools: []`. Confirmed
  against a live session: `system/init` reports exactly the three
  `mcp__resume__*` tools.
- **Worse, `allowedTools` *disables* the `canUseTool` gate for the names it
  lists.** The SDK says so at runtime (`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`):
  "bare allowedTools entries auto-approve the whole tool before the callback is
  consulted." Listing the three tools there — as the plan said to — meant the
  deny-gate never ran for them. `allowedTools` is now omitted entirely, so every
  tool call goes through `canUseTool`, which defaults to deny.
- **`settingSources` defaults to loading everything** (`~/.claude/settings.json`,
  `.claude/`, `CLAUDE.md` under `cwd`). On a multi-tenant server that is operator
  config leaking into a user's session. It is now `[]`.
- **`canUseTool`'s `updatedInput` *replaces* the tool's arguments.** Returning
  `{ behavior: 'allow', updatedInput: {} }` silently wipes `edit_resume`'s
  payload. Pass `input` straight through.

And three the SDK surfaced only at runtime:

- **A provider failure arrives as `subtype: 'success'` with `is_error: true`,**
  and its `result` string is the error text. Trusting `subtype` alone wrote
  *"Invalid API key · Fix external API key"* into the user's transcript as if the
  assistant had said it, and skipped the quota refund. Check `is_error`; decide
  refunds on tokens actually billed, not on "a result arrived".
- **`result.usage` is cumulative for the whole turn** (measured: four steps of
  100 in / 30 out arrive as `400` / `120`). So bill once, from the `result` —
  billing per-`assistant`-message as well would double-count. But a turn cut
  short never emits a `result`, so per-step usage is accumulated as a *floor* and
  recorded if no `result` ever arrives. Without it, hanging up mid-turn spent the
  operator's money and recorded nothing.
- **`request.signal` does not fire when the browser hangs up mid-stream** under
  `adapter-node` — only the `ReadableStream`'s `cancel()` does. The route now
  drives its own `AbortController` from both. `cancel()` must *not* release the
  per-résumé lock: the turn is still unwinding and may yet write. It is released
  once the turn settles, after `finalizeTurn`.

## Verified in Phase 2

Against a running server, some checks with a deliberately invalid
`ANTHROPIC_API_KEY`, the rest against a stub Anthropic API pointed at by
`ANTHROPIC_BASE_URL` that scripts one scripted turn. Typst was real throughout —
the renders below are real PDFs.

| Check | Result |
|---|---|
| `GET`/`POST`/`DELETE` `/api/resumes/:id/chat`, unauthenticated | 401 |
| Chat on another user's resume | **404** (not 403, and not 503 — ownership is checked before config) |
| `POST` with no credentials configured | 503, and the Chat tab renders a notice |
| Empty, whitespace-only, malformed, or >4000-char message | 400 |
| Two concurrent turns on one resume | one 200, one **409**; the 409 costs no turn |
| At the daily cap | 429, `usage.turns` does not creep past the cap |
| A turn that bills nothing (rejected key) | refunded to 0; no assistant message persisted; no provider error text in the transcript |
| Tool list the model receives (`system/init`) | exactly `get_resume`, `edit_resume`, `render_resume` |
| A **successful** turn | `get_resume → edit_resume → render_resume → reply`; PDF written, `render_version` 0→1, `last_good_json` set, transcript persisted, `agent_session_id` stored |
| A second turn on the same resume | resumes the stored session — the model sees the earlier tool calls |
| The model calls `Bash` ("cat /etc/passwd") | never executed; the turn carries on with its three tools |
| Client hangs up mid-turn | model stopped, lock released only after the résumé settles, turn **not** refunded, spend recorded as a per-step floor |
| Résumé whose `template_id` no longer exists | `error` event, turn refundable, no leak of the template name (unit test) |
| Agent `$HOME` | `data/agent/<resumeId>/` — one session-store bucket per résumé |
| Response headers | `application/x-ndjson`, `no-store`, `x-accel-buffering: no` |

## Verified in Phase 1

Worth re-running after any change to `compile.ts` or the templates:

| Check | Result |
|---|---|
| `#read("/data/auth-secret")`, `#read("../../data/auth-secret")`, `#json("<db>")` in a bio | compile fails, edit auto-reverts, canary never appears in any PDF |
| `#("A" * 200000000)` in a bio | child SIGKILLed at 20s, server healthy, no orphan processes |
| Another user's resume via `/api/resumes/:id/data` and `/resumes/:id/pdf` | **404** (not 403) |
| Unauthenticated / forged session cookie on `/api/*` | 401 |
| Invalid hex colour, unknown section `kind` | 400 with a Zod message |
| Typst package resolution with the real cache hidden | compiles offline from `vendor/` |
| `git` history | no `data/`, `.env`, `*.db`, `auth-secret`, photo, or personal content |

## Running it

See [README.md](README.md). You need Google OAuth credentials (redirect URI
exactly `${ORIGIN}/auth/google/callback`) and `ALLOWED_EMAILS`. The first account
to sign in becomes admin.

To seed a resume, drop `seed/<google-email>.json` on the host before that person's
first login. Seed files are gitignored.
