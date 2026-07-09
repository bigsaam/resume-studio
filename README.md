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
- **No network at render time.** The one `@preview` package is vendored into
  `vendor/typst-packages/` and resolved from disk.
- **Uploads are opaque ids**, never paths, so a crafted `photo` value can't
  traverse the filesystem.
- **The chat agent has no filesystem or shell tools** — only `get_resume` /
  `edit_resume`, scoped to the caller's own resume, validated against the schema
  before anything is persisted.
- Sessions are opaque, DB-backed, and bound to a user id. `id_token`s are
  verified against Google's JWKS (`iss`, `aud`, `exp`, `nonce`, `email_verified`).
  Resumes you don't own return **404**, not 403.

Found a problem? Please open an issue.

## Layout

| Path | Role |
|---|---|
| `src/lib/server/templates/` | Template registry, Zod schema, Typst files |
| `src/lib/server/compile.ts` | Sandboxed Typst compile service |
| `src/lib/server/agent/` | Claude Agent SDK session + JSON-only MCP tools |
| `src/lib/server/access.ts` | Allowlist, invites, ownership checks |
| `src/lib/components/` | UI |
| `fonts/`, `vendor/` | Bundled fonts and Typst packages |

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
