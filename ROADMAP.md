# Roadmap — what's built, what's left

Phase 1 (the walking skeleton) is done and verified end-to-end: sign in, create a
resume from a template, edit fields, watch the PDF rebuild, download it. The
sandbox and access controls were tested, not assumed (see _Verified_ below).

**Phase 2 (the chat agent) is built.** See _Phase 2, as built_ below for the
places the plan turned out to be wrong.

**Phase 3 (photo uploads) is built.** `POST /api/assets` decodes every upload
with `sharp` and re-encodes it from the pixels — EXIF/GPS is discarded, appended
polyglot payloads cannot survive, decompression bombs are refused before they
allocate, and SVG is rejected outright (libvips would render it; an SVG is a
document, not an image). Stored as `.png` when it has transparency, `.jpg`
otherwise, because Typst picks its decoder from the extension. `ImageField`
uploads and stores the returned opaque id — never a path.

**Phase 4 (editor completeness) is built.** Sections can be added, removed,
reordered, and changed between kinds without losing their content
(`lib/sections.ts`, and `sections.test.ts` proves all sixteen conversions still
satisfy the schema). Exhibition `items[]` and bullet `sub[]` are editable.
Résumés can be duplicated and renamed. The template gallery renders a thumbnail
of each template's own starting content. Uploads no résumé references can be
reaped from Settings.

Everything below is what remains, in the order it makes sense to build.

---

## Phase 5 — hardening

Rate limiting is done: `CHAT_TURNS_PER_DAY`, `CHAT_TOKENS_PER_DAY` (both in one
atomic `reserveTurn`), `CHAT_TURNS_PER_MINUTE`, and `INVITE_ATTEMPTS_PER_HOUR`.
What's left:

- Redact more aggressively: compiler logs are stripped of paths
  (`compile.ts:redact`) but still quote the offending résumé line back to the
  owner. That's fine for the owner; make sure it never lands in a shared log.
- Sessions are purged at boot only (`purgeExpiredSessions`). Fine for now.
- `users.theme` is unused — the theme lives in `localStorage`. Either wire it up
  or drop the column.
- **Deny the Typst child network egress at the container/host level.** Verified
  the exposure: a `#import "@preview/…"` in a résumé field _does_ fetch from
  Typst's registry (the vendored cache path is not an "offline" switch, and there
  is no offline flag in Typst 0.15). The bounds, also verified: only the
  `@preview` namespace reaches the network (`@evil/pkg` is refused with no
  request); a `https://…` import resolves as a path _inside_ the compile root,
  not a URL, so it is not an SSRF; the 20s `SIGKILL` caps a slow fetch; and any
  code pulled still renders confined to `--root`. So it is a bounded outbound
  request on user input, not exfiltration — but still unwanted. Node needs egress
  (OAuth, Anthropic) and Typst is its child in the same netns, so it can't be
  split in-process; `docker-compose.yml` documents the edge allowlist and an
  `internal: true` network for instances that need no egress at all.

CI runs `pnpm lint`, `pnpm check`, `pnpm test` and `pnpm build`; renders every
template offline against the vendored package on a separate job; and refuses a
commit that tracks `data/`, `.env`, a database, a seed file other than the two
`.gitignore` allows, or a credential-shaped string. Both guards were tested by
planting an offender.

## Known smaller gaps

- The chat agent has **never run against the real Anthropic API** — only against
  a stub. The wiring is proven; the _prompt_ is not. Expect to iterate on
  `agent/prompt.ts` once a real model is editing real résumés.
- `edit_resume` takes the **whole document**, so every edit re-sends the résumé.
  Fine at these sizes; revisit if the 256 KB ceiling ever gets approached.
- The per-résumé lock (`locks.ts`) is an **in-process `Set`**. Two app instances
  against one database would not see each other's locks. Single-instance only,
  until it moves into SQLite.
- A turn cut short records a **floor**, not the true token spend: an assistant
  message's `output_tokens` is its count at `message_start`. Under-counts, never
  over-counts.
- **`pnpm build` opens the database.** SvelteKit's route-analysis pass imports
  every server module, and `db/index.ts` calls `createDb()` at import, so a build
  leaves an empty `./data/resume-studio.db` behind (gitignored, harmless). Making
  `db` lazy would fix it. Pre-dates the agent work.
- **An upload orphaned by a crash is never collected.** The file is written and
  renamed before the row is inserted; a `SIGKILL` in between leaves a file no
  `resolveAssetPath` can reach (so it is unreachable, not dangerous) and nothing
  reaps it. Settings reaps uploads with no _résumé_ referencing them, which is a
  different set — it works from the rows. A sweep of `assetsDir` for files with
  no matching row would close this one.
- **Template thumbnails are cached until the directory is deleted.** Editing a
  `main.typ` or a `default.ts` will not regenerate `data/thumbs/*.png`. Deleting
  the directory is the way; a content hash in the filename would be better.
- **`drizzle-orm` is pinned at `^0.36.3`, which has a HIGH advisory**
  (GHSA-gpj5-g38j-94v9, SQL injection via improperly escaped _identifiers_, fixed
  in `>=0.45.2`). Not reachable here — every `sql` template interpolates either a
  drizzle column object or a bound value, and there is no `sql.raw` or
  `sql.identifier` anywhere — but the bump is worth doing on its own, alongside
  `drizzle-kit`.
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
  _available_. The option that actually removes them is `tools: []`. Confirmed
  against a live session: `system/init` reports exactly the three
  `mcp__resume__*` tools.
- **Worse, `allowedTools` _disables_ the `canUseTool` gate for the names it
  lists.** The SDK says so at runtime (`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`):
  "bare allowedTools entries auto-approve the whole tool before the callback is
  consulted." Listing the three tools there — as the plan said to — meant the
  deny-gate never ran for them. `allowedTools` is now omitted entirely, so every
  tool call goes through `canUseTool`, which defaults to deny.
- **`settingSources` defaults to loading everything** (`~/.claude/settings.json`,
  `.claude/`, `CLAUDE.md` under `cwd`). On a multi-tenant server that is operator
  config leaking into a user's session. It is now `[]`.
- **`canUseTool`'s `updatedInput` _replaces_ the tool's arguments.** Returning
  `{ behavior: 'allow', updatedInput: {} }` silently wipes `edit_resume`'s
  payload. Pass `input` straight through.

And three the SDK surfaced only at runtime:

- **A provider failure arrives as `subtype: 'success'` with `is_error: true`,**
  and its `result` string is the error text. Trusting `subtype` alone wrote
  _"Invalid API key · Fix external API key"_ into the user's transcript as if the
  assistant had said it, and skipped the quota refund. Check `is_error`; decide
  refunds on tokens actually billed, not on "a result arrived".
- **`result.usage` is cumulative for the whole turn** (measured: four steps of
  100 in / 30 out arrive as `400` / `120`). So bill once, from the `result` —
  billing per-`assistant`-message as well would double-count. But a turn cut
  short never emits a `result`, so per-step usage is accumulated as a _floor_ and
  recorded if no `result` ever arrives. Without it, hanging up mid-turn spent the
  operator's money and recorded nothing.
- **`request.signal` does not fire when the browser hangs up mid-stream** under
  `adapter-node` — only the `ReadableStream`'s `cancel()` does. The route now
  drives its own `AbortController` from both. `cancel()` must _not_ release the
  per-résumé lock: the turn is still unwinding and may yet write. It is released
  once the turn settles, after `finalizeTurn`.

## Verified in Phase 2

Against a running server, some checks with a deliberately invalid
`ANTHROPIC_API_KEY`, the rest against a stub Anthropic API pointed at by
`ANTHROPIC_BASE_URL` that scripts one scripted turn. Typst was real throughout —
the renders below are real PDFs.

| Check                                                          | Result                                                                                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`/`POST`/`DELETE` `/api/resumes/:id/chat`, unauthenticated | 401                                                                                                                                                          |
| Chat on another user's resume                                  | **404** (not 403, and not 503 — ownership is checked before config)                                                                                          |
| `POST` with no credentials configured                          | 503, and the Chat tab renders a notice                                                                                                                       |
| Empty, whitespace-only, malformed, or >4000-char message       | 400                                                                                                                                                          |
| Two concurrent turns on one resume                             | one 200, one **409**; the 409 costs no turn                                                                                                                  |
| At the daily cap                                               | 429, `usage.turns` does not creep past the cap                                                                                                               |
| A turn that bills nothing (rejected key)                       | refunded to 0; no assistant message persisted; no provider error text in the transcript                                                                      |
| Tool list the model receives (`system/init`)                   | exactly `get_resume`, `edit_resume`, `render_resume`                                                                                                         |
| A **successful** turn                                          | `get_resume → edit_resume → render_resume → reply`; PDF written, `render_version` 0→1, `last_good_json` set, transcript persisted, `agent_session_id` stored |
| A second turn on the same resume                               | resumes the stored session — the model sees the earlier tool calls                                                                                           |
| The model calls `Bash` ("cat /etc/passwd")                     | never executed; the turn carries on with its three tools                                                                                                     |
| Client hangs up mid-turn                                       | model stopped, lock released only after the résumé settles, turn **not** refunded, spend recorded as a per-step floor                                        |
| Résumé whose `template_id` no longer exists                    | `error` event, turn refundable, no leak of the template name (unit test)                                                                                     |
| Agent `$HOME`                                                  | `data/agent/<resumeId>/` — one session-store bucket per résumé                                                                                               |
| Response headers                                               | `application/x-ndjson`, `no-store`, `x-accel-buffering: no`                                                                                                  |

## Verified in Phase 4

| Check                                                                            | Result                                                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| All sixteen `convertSection` kind pairs                                          | every result parses against `sectionSchema`; heading, page and spacing survive all of them                                                             |
| A role converted to bullets and back                                             | title, timeframe and bullets round-trip; a prose `body` becomes a sub-line                                                                             |
| Content past the schema's caps (60 bullets → 30 entries, 20 sub-lines → 10)      | trimmed, not left to fail validation later                                                                                                             |
| "+ sub-bullet"                                                                   | opens the editor and _stays_ open while empty — it previously did nothing at all                                                                       |
| Duplicating a résumé                                                             | copies content, **not** `agent_session_id` and not the transcript; `render_version` restarts at 0; titles stay under 200 chars through repeated copies |
| Deleting a résumé                                                                | removes the rendered PDF directory, and the transcript goes via `ON DELETE CASCADE` (so the `foreign_keys = ON` pragma is confirmed live)              |
| Renaming                                                                         | `PATCH /api/resumes/:id` — no recompile, no lock, so it cannot collide with a chat turn                                                                |
| Reaping uploads                                                                  | deletes only what no résumé of _that user_ references; another user's résumé referencing your id does not keep it alive                                |
| Four concurrent first-requests for one thumbnail                                 | one Typst run, four identical bytes (in-flight dedupe)                                                                                                 |
| `GET /api/templates/:id/thumb` unauthenticated / unknown id / `../../etc/passwd` | 401 / 404 / 404                                                                                                                                        |
| Thumbnail output                                                                 | 420px wide PNG for both templates, rendered from their own `defaultData`                                                                               |

## Verified in Phase 3

Against a running server, with real Typst and a real `sharp`:

| Check                                                           | Result                                                                                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JPEG carrying `IFD0.Copyright` and a GPS directory              | stored file contains neither the string nor any EXIF block                                                                                                       |
| JPEG carrying EXIF + ICC + XMP                                  | all three absent from the stored file (asserted, so a sharp upgrade that changes its defaults fails loudly)                                                      |
| `maxAssetsPerUser + 4` uploads fired concurrently               | exactly `maxAssetsPerUser` succeed — both ceilings are re-checked inside the insert transaction. Verified by mutation: removing the check lets 7 past a cap of 3 |
| An upload that would cross `MAX_BYTES_PER_USER`                 | 400, and it leaves neither a row nor a file                                                                                                                      |
| Four concurrent renders with `TYPST_CONCURRENCY=2`              | all 200 — the semaphore extracted from `compile.ts` behaves as before                                                                                            |
| Generated ids                                                   | always match `^[A-Za-z0-9_-]{1,64}$`, the regex `resolveAssetPath` and the résumé schema both enforce                                                            |
| JPEG with `#read("/data/auth-secret")…POLYGLOT-CANARY` appended | payload absent from the stored bytes                                                                                                                             |
| `<svg><script>…</script></svg>`                                 | 400 — decoded as `svg`, refused by format                                                                                                                        |
| Shell script, truncated JPEG, empty file                        | 400                                                                                                                                                              |
| 500×250 image, `MAX_IMAGE_DIM=64`                               | stored 64×32; a 16px image is not enlarged                                                                                                                       |
| Transparent PNG / opaque JPEG                                   | `.png` / `.jpg`, and the bytes match the extension                                                                                                               |
| `POST /api/assets` unauthenticated                              | 401                                                                                                                                                              |
| Another user's asset id, `GET` and `DELETE`                     | **404**                                                                                                                                                          |
| `../../../etc/passwd`, `/etc/passwd`, 65-char id, `""`          | `resolveAssetPath` returns null                                                                                                                                  |
| Upload past `MAX_ASSETS_PER_USER`                               | 400; the ceiling is per user, not global                                                                                                                         |
| Photo attached, résumé re-rendered                              | PDF grows 70702 → 74466 bytes and embeds an image XObject                                                                                                        |
| Asset deleted while the résumé still references its id          | recompiles clean, falls back to no photo — no revert                                                                                                             |

## Verified in Phase 1

Worth re-running after any change to `compile.ts` or the templates:

| Check                                                                                     | Result                                                                |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `#read("/data/auth-secret")`, `#read("../../data/auth-secret")`, `#json("<db>")` in a bio | compile fails, edit auto-reverts, canary never appears in any PDF     |
| `#("A" * 200000000)` in a bio                                                             | child SIGKILLed at 20s, server healthy, no orphan processes           |
| Another user's resume via `/api/resumes/:id/data` and `/resumes/:id/pdf`                  | **404** (not 403)                                                     |
| Unauthenticated / forged session cookie on `/api/*`                                       | 401                                                                   |
| Invalid hex colour, unknown section `kind`                                                | 400 with a Zod message                                                |
| Typst package resolution with the real cache hidden                                       | compiles offline from `vendor/`                                       |
| `git` history                                                                             | no `data/`, `.env`, `*.db`, `auth-secret`, photo, or personal content |

## Running it

See [README.md](README.md). You need Google OAuth credentials (redirect URI
exactly `${ORIGIN}/auth/google/callback`) and `ALLOWED_EMAILS`. The first account
to sign in becomes admin.

To seed a resume, drop `seed/<google-email>.json` on the host before that person's
first login. Seed files are gitignored.
