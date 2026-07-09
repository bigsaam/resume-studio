# Seed content

Drop a file named `<email>.json` here to pre-populate that person's first resume
the first time they sign in. The file is the resume `data` blob — the same shape
the template's Zod schema validates (see `src/lib/server/templates/`).

```
seed/
  ada@example.com.json     # → Ada's first resume, created on her first login
```

Seeding only fires when the user has **zero** resumes, so it never overwrites work.

## This directory is gitignored

`.gitignore` excludes everything here except this README and
`example@example.com.json`. Seed files contain a real person's name, email,
phone number, and history. **This repo is public — never commit them.**

To move an existing resume onto a new instance, copy its JSON here and sign in.
