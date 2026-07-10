# Resume Studio

Self-hosted, multi-user resume builder. Edit a resume through a structured form
(or by chatting with Claude), and watch a **Typst**-rendered PDF update beside it.

```
┌──────────┬──────────────────────┬─────────────────────┐
│ Sidebar  │  Structured editor   │   Live PDF preview  │
│ Resumes  │  fields · colors     │   [ resume.pdf ]    │
│ Templates│  fonts · sections    │        ↑ refreshes  │
│ Settings │                      │   [ Download ]      │
└──────────┴──────────────────────┴─────────────────────┘
      edit → validate → typst compile → preview
```

- **Structured, not a text box.** Content and theme live as validated JSON. The
  form, the chat agent, and the renderer all agree on one schema.
- **Templates.** A template is a Typst file plus a schema and some starting
  content. Ships with `typographic` (two pages, tinted sidebar, optional photo)
  and `starter` (one column, no photo).
- **Multi-user.** Google sign-in, per-user resumes, strict ownership checks.
  Access is an email allowlist plus single-use invite codes.
- **Light and dark.**

## Quick start

Requires Node 22, pnpm, and [Typst](https://github.com/typst/typst) on `PATH`.

```bash
pnpm install
cp .env.example .env      # fill in the Google OAuth values + ALLOWED_EMAILS
pnpm db:generate && pnpm db:migrate
pnpm dev
```

Create OAuth credentials in the [Google Cloud console](https://console.cloud.google.com/apis/credentials).
The authorized redirect URI must be exactly `${ORIGIN}/auth/google/callback`.

The first account to sign in becomes the **admin** and can mint invite codes from
**Settings**.

### Docker

```bash
docker compose up -d --build
```

`./data` (database, PDFs, uploads, session secret) and `./seed` are mounted, not
baked into the image.

## Seeding someone's first resume

Drop `seed/<their-google-email>.json` on the host. On that person's first login —
and only if they have no resumes — it becomes their first resume. See
[`seed/README.md`](seed/README.md). **Seed files hold real personal data and are
gitignored.**

## Security notes

Typst templates render user content through `eval(.., mode: "markup")`, so a
resume field is, in effect, Typst code. That is deliberate — it's what makes
`*bold*`, `--`, and `#link(..)` work — and it is contained:

- **Every compile gets a throwaway root.** `typst --root <tmpdir>` confines all
  file access to a directory holding only that user's `resume.json`, the
  template, and their own uploads. The database, `data/auth-secret`, `.env`, and
  other users' files live outside it and are unreachable. `DATA_ROOT` must never
  sit inside a compile root.
- **Compute is bounded.** A wall-clock timeout kills runaway renders; a semaphore
  caps concurrent compiles. The container adds a memory and pid limit and drops
  all capabilities.
- **Renders resolve packages from disk.** The one `@preview` package the
  templates use is vendored into `vendor/typst-packages/`, so an ordinary render
  never touches the network. A `#import "@preview/…"` typed into a résumé field
  for a package that _isn't_ vendored will still be fetched from Typst's registry
  — bounded (registry-only, not an SSRF, killed by the render timeout, and any
  code confined to the compile root), but real. Deny the render's egress at your
  firewall or reverse proxy to close it; see `docker-compose.yml`.
- **Uploads are opaque ids**, never paths, so a crafted `photo` value can't
  traverse the filesystem.
- **Uploaded images are re-encoded, not just validated.** Every file is decoded
  to pixels and written back out from those pixels, so EXIF (including GPS)
  is discarded and a polyglot — a valid JPEG with a payload appended — cannot
  survive. Decompression bombs are refused before they allocate. SVG is rejected:
  libvips would happily render it, but an SVG is a document, not an image.
- **The chat agent has no filesystem or shell tools.** The session is created
  with `tools: []`, which removes every built-in (`Read`, `Write`, `Bash`,
  `Grep`, `WebFetch`); the only capabilities are `get_resume`, `edit_resume` and
  `render_resume`, each closed over one `(userId, resumeId)` pair and re-checking
  ownership. A `canUseTool` gate denies anything else by name. `edit_resume`
  validates against the Zod schema before persisting, and a turn that leaves the
  résumé unable to typeset is rolled back to `last_good_json`.
- **Chat is metered.** A turn is reserved against a per-user daily cap _before_
  the model is called, and refunded only if nothing was billed.
- Sessions are opaque, DB-backed, and bound to a user id. `id_token`s are
  verified against Google's JWKS (`iss`, `aud`, `exp`, `nonce`, `email_verified`).
  Resumes you don't own return **404**, not 403.

Found a problem? Please open an issue.

## Layout

| Path                        | Role                                              |
| --------------------------- | ------------------------------------------------- |
| `src/lib/server/templates/` | Template registry, Zod schema, Typst files        |
| `src/lib/server/compile.ts` | Sandboxed Typst compile service                   |
| `src/lib/server/agent/`     | Claude Agent SDK session + JSON-only MCP tools    |
| `src/lib/server/uploads.ts` | Image ingest: decode, re-encode, strip metadata   |
| `src/lib/sections.ts`       | Section construction and lossless kind conversion |
| `src/lib/server/access.ts`  | Allowlist, invites, ownership checks              |
| `src/lib/components/`       | UI                                                |
| `fonts/`, `vendor/`         | Bundled fonts and Typst packages                  |

## Status

The core loop works: sign in, pick a template, edit or chat, upload a photo,
download. **Rate limiting beyond a daily chat cap is not built yet** — see
[ROADMAP.md](ROADMAP.md).

Chat needs `ANTHROPIC_API_KEY`. Without it the Chat tab says so and the endpoint
returns 503; everything else works unchanged.

## Adding a template

Create `src/lib/server/templates/<id>/` with a `main.typ` (it reads
`resume.json` from its compile root), an optional `assets/`, and a `default.ts`
exporting starting content. Register it in `templates/index.ts`. That's the whole
extension surface.

## Credits

Built on [Typst](https://typst.app) and the
[typographic-resume](https://github.com/tsnobip/typst-typographic-resume) template
(vendored, unmodified). Bundled fonts are SIL Open Font License. Icon glyphs in
`templates/typographic/assets/` are from [Font Awesome Free](https://fontawesome.com)
(CC BY 4.0).

MIT licensed.
