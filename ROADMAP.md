# Roadmap — what's built, what's left

Phase 1 (the walking skeleton) is done and verified end-to-end: sign in, create a
resume from a template, edit fields, watch the PDF rebuild, download it. The
sandbox and access controls were tested, not assumed (see *Verified* below).

Everything below is what remains, in the order it makes sense to build.

---

## Phase 2 — the chat agent

`src/lib/server/agent/` exists but is **empty**. The `chat_messages` table is
declared in `db/schema.ts` and referenced nowhere yet.

Port from the old Express app (`jenn-resume/app/src/{claudeSession,server,previewTool}.ts`),
with these changes — they matter:

- **Don't use the `claude_code` system-prompt preset.** It assumes `Read`/`Edit`
  exist and will keep telling the model to edit files it has no tools for. Pass a
  plain string `systemPrompt`.
- **Tools are JSON-only.** Build an in-process MCP server (`createSdkMcpServer`)
  closing over one `resumeId`, exposing `get_resume`, `edit_resume`, and
  `render_resume`. Set `allowedTools` to exactly those three `mcp__resume__*`
  names, and keep a `canUseTool` gate that denies everything else. No `Read`,
  `Write`, `Grep`, or `Bash` — Claude Code's `Read` takes absolute paths, so a
  `cwd` would not contain an untrusted user.
- `edit_resume` must validate against the template's Zod schema **before** it
  persists (`resumes.ts:validateResumeData`).
- Persist the SDK's `session_id` to `resumes.agent_session_id` so chat resumes
  with context — **per resume**, not globally. (The old app kept one
  `session.json` for the whole process; multi-user, that hands one person's
  conversation to the next.)
- Stream NDJSON with the existing event shapes: `delta`, `tool`, `render`,
  `status`, `done`, `error`.
- Reuse the compile → repair (×2) → revert loop, but revert against
  `resumes.last_good_json`, not files on disk. `withResumeLock()` in
  `lib/server/locks.ts` already serializes a chat turn against a form auto-save
  on the same resume; the chat route must take the same lock.

Route: `src/routes/api/resumes/[id]/chat/+server.ts`. UI: a `ChatPanel.svelte`
tabbed beside `ResumeForm` in the workbench.

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

The `usage` table is declared and unreferenced. Nothing rate-limits anything
today, and **the operator's Anthropic account pays for every user's chat.**

- Per-user chat limits (turns/min, turns/day) and a daily token budget read off
  the SDK `result` message's usage. `config.chatTurnsPerDay` already exists.
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
- CI: typecheck + build, and a secret/PII scan before publish.

## Known smaller gaps

- `templates/starter/main.typ` **ignores `section.page`** — it's one continuous
  flow. That's intentional, but means moving a section to "p2" does nothing there.
- The seed example carries a `_comment` key; Zod strips unknown keys, so it's
  harmless, but it isn't part of the schema.
- `contact[].icon` is a closed enum (`email|phone|website|instagram|github`).
  Adding an icon means adding an SVG to the template's `assets/` and a branch to
  `icon-img` in `main.typ`.

---

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
