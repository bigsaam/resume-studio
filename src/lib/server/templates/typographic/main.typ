#import "@preview/typographic-resume:0.2.0": *

// =========================================================================
// TEMPLATE: typographic
//
// A two-page resume: page 1 has a tinted aside (contact / education /
// languages / hobbies) beside a main column; page 2+ runs full width.
//
// This file is pure layout. Every value comes from `resume.json`, which the
// server materializes next to this file inside a throwaway compile root. Do
// not put content here.
//
// Sandbox note: the content strings below are rendered through `eval(..)`, so
// they may contain Typst markup. The compile root is disposable and holds only
// one user's own data — never the database, secrets, or another user's files.
// =========================================================================

#let data = json("resume.json")
#let th = data.theme
#let textColor = rgb(th.colors.text)
#let metaColor = textColor.lighten(30%) // muted text for dates, orgs, meta lines
#let headingColor = rgb(th.colors.heading)
#let nameColor = rgb(th.colors.name)
#let sidebarColor = rgb(th.colors.sidebar)
#let bodyFont = th.fonts.body
#let secondaryFont = th.fonts.secondary
#let headingFont = th.fonts.heading
// The name keeps its own font (broken out from the body stack) so switching the
// body to a sans face doesn't restyle the name.
#let nameFont = th.fonts.at("name", default: bodyFont)
#let bodySize = th.at("bodySize", default: 8) // base body/heading size in pt

// Render a content string that may contain light Typst markup (*bold*, --, links).
#let md(s) = eval(s, mode: "markup")

// Two-column helper for dense list sections.
#let two-col(left, right) = grid(
  columns: (1fr, 1fr),
  column-gutter: 24pt,
  left, right,
)

// Local override of work-entry with a two-column header:
//   left  = TITLE (bold) / organization · ages (muted)
//   right = period / location (muted, right-aligned)
#let work-entry(
  theme: (),
  timeframe: "",
  title: "",
  location: "",
  meta-left: "",
  body,
) = {
  set text(size: theme.font-size) if "font-size" in theme

  if "space-above" not in theme {
    v(1fr)
  } else {
    v(theme.space-above)
  }
  {
    set text(font: theme.font-secondary) if "font-secondary" in theme
    set text(font: default-theme.font-secondary) if "font-secondary" not in theme
    set block(above: 0pt, below: 0pt)
    grid(
      columns: (1fr, auto),
      column-gutter: 10pt,
      align: (left, right),
      {
        set text(weight: 600)
        upper(title)
        if meta-left != "" {
          linebreak()
          text(weight: "light", fill: metaColor, meta-left)
        }
      },
      {
        // Dates + location in the body font (not the secondary/Roboto font).
        set text(font: bodyFont, weight: "light", fill: metaColor)
        timeframe
        if location != "" {
          linebreak()
          location
        }
      },
    )
  }
  {
    set block(above: 6pt, below: 8pt)
    line(stroke: 0.1pt, length: 100%)
  }
  context {
    set text(fill: text.fill.lighten(30%))
    set par(leading: 0.75em)
    body
  }
}

// ---- section body renderers -------------------------------------------
// A bullet is either a plain markup string, or { text, date } — the latter
// renders the date muted and flush right.
#let render-bullet(b) = {
  if type(b) == str {
    md(b)
  } else {
    md(b.text)
    if b.at("date", default: "") != "" {
      h(1fr)
      text(weight: "light", fill: metaColor, b.date)
    }
    if b.at("sub", default: ()).len() > 0 {
      list(..b.sub.map(s => md(s)))
    }
  }
}

#let render-bullets(bullets, size: none) = {
  set par(leading: 0.75em)
  set text(size: size * 1pt) if size != none
  list(..bullets.map(render-bullet))
}

#let render-bullets-2col(bullets, fontSize) = {
  set text(size: fontSize * 1pt)
  set par(leading: 0.75em)
  let n = bullets.len()
  let leftN = calc.ceil(n / 2)
  two-col(
    list(..bullets.slice(0, leftN).map(render-bullet)),
    list(..bullets.slice(leftN).map(render-bullet)),
  )
}

// Exhibitions / publications: standardized entries with a bold title (date
// flush right), a muted meta line, and optional dated sub-items.
#let render-exhibitions(entries) = {
  for (i, e) in entries.enumerate() {
    if i > 0 { v(10pt) }
    block(breakable: false, {
      {
        strong(md(e.title))
        if e.at("date", default: "") != "" {
          h(1fr)
          text(weight: "light", fill: metaColor, e.date)
        }
      }
      if e.at("meta", default: "") != "" {
        linebreak()
        text(weight: "light", fill: metaColor, md(e.meta))
      }
      if e.at("items", default: ()).len() > 0 {
        set par(leading: 0.75em)
        // Bullet | text (wraps) | date pinned top-right on the first line.
        grid(
          columns: (auto, 1fr, auto),
          column-gutter: 5pt,
          row-gutter: 5.5pt,
          align: (left + top, left + top, right + top),
          ..e.items.map(it => (
            [•],
            {
              md(it.text)
              if it.at("sub", default: ()).len() > 0 {
                list(..it.sub.map(s => md(s)))
              }
            },
            if it.at("date", default: "") != "" {
              box(text(weight: "light", fill: metaColor, it.date))
            } else { [] },
          )).flatten()
        )
      }
    })
  }
}

// Render one section (heading + rule + body) with the right wrapping.
#let render-section(s) = {
  let space = s.at("spaceAbove", default: 0) * 1pt
  if s.kind == "work" {
    section(theme: (space-above: space), s.title, {
      for e in s.entries {
        let parts = ()
        if e.at("organization", default: "") != "" { parts.push(e.organization) }
        if e.at("titleNote", default: "") != "" { parts.push(e.titleNote) }
        block(breakable: false, work-entry(
          theme: (space-above: e.at("spaceAbove", default: 0) * 1pt),
          timeframe: e.timeframe,
          title: e.title,
          location: e.location,
          meta-left: if parts.len() > 0 { parts.join(" · ") } else { "" },
          if "bullets" in e and e.bullets.len() > 0 {
            render-bullets(e.bullets)
          } else {
            md(e.at("body", default: ""))
          },
        ))
      }
    })
  } else if s.kind == "bullets" {
    let content = section(
      theme: (space-above: space),
      s.title,
      render-bullets(s.bullets, size: s.at("fontSize", default: none)),
    )
    if s.at("wrapWhole", default: false) { block(breakable: false, content) } else { content }
  } else if s.kind == "bullets-2col" {
    block(breakable: false, section(
      theme: (space-above: space),
      s.title,
      render-bullets-2col(s.bullets, s.at("fontSize", default: 7.5)),
    ))
  } else if s.kind == "exhibitions" {
    section(theme: (space-above: space), s.title, render-exhibitions(s.entries))
  }
}

// ---- aside helpers ----------------------------------------------------
// email/phone/github ship with the @preview package; the rest live in assets/.
#let icon-img(name) = {
  if name == "email" { email-icon }
  else if name == "phone" { phone-icon }
  else if name == "github" { github-icon }
  else if name == "instagram" { image("assets/instagram-brands.svg", alt: "instagram icon") }
  else if name == "website" { image("assets/globe-mono.svg", alt: "website icon") }
}

// Education entries may omit a logo; fall back to a neutral cap glyph.
#let edu-logo(e) = {
  let path = e.at("logo", default: "")
  if path == "" { image("assets/graduation-cap-mono.svg", width: 23pt) }
  else { image(path, width: e.at("logoWidth", default: 30) * 1pt) }
}

// =========================================================================
// Design customizations (from resume.json theme):
// - sage-green section headings across the whole document
// - a soft sage panel behind the page-1 aside/left column
// =========================================================================
#show heading.where(level: 1): set text(fill: headingColor)

// --- Global typography (translated from the CSS spec) ---------------------
// letter-spacing 0.2px on all text (subtle); uppercase section headers bump to
// 0.12em in their own show rules below. line-height 1.75 -> par leading 0.75em
// (applied per text block since resume() scopes its own par rules). Bold
// markup/labels render at weight 600; section headers stay 700.
#set text(tracking: 0.02em)
#set par(leading: 0.75em)
#set list(spacing: 6pt)
#show strong: set text(weight: 600)
#set page(
  background: context {
    // Page 1 only: the aside/left column exists only there.
    if here().page() == 1 {
      place(
        top + left,
        layout(size => {
          let m = 26pt // page margin, == the grid's middle (gutter) column
          let band = m + (size.width - 3 * m) / 3 + m / 2
          rect(width: band, height: size.height, fill: sidebarColor)
        }),
      )
    }
  },
)

// NOTE: explicit #resume(...)[ ... ] call (not #show: resume.with(...)) so that
// content AFTER the closing bracket falls outside the aside/main grid entirely,
// letting page 2+ use the full page width.
#resume(
  theme: (
    text-color: textColor,
    font: bodyFont,
    font-secondary: secondaryFont,
    font-tertiary: headingFont,
    font-size: bodySize * 1pt,
  ),
  first-name: [],
  last-name: [
    #text(font: nameFont, size: th.nameSize * 1pt, weight: "regular", fill: nameColor)[#data.header.firstName] #text(font: nameFont, size: th.nameSize * 1pt, weight: "bold", fill: nameColor)[#data.header.lastName]
    #v(6pt)
  ],
  profession: [#data.header.profession #v(10pt)],
  bio: [
    #set text(hyphenate: false)
    #set par(leading: 0.75em) // override the template's 1.0em so the bio breathes like the body
    #md(data.header.bio)
  ],
  profile-picture: {
    // Both the photo and its caption are optional — a resume with neither still
    // renders, it just starts the aside higher up.
    let photo = data.header.at("photo", default: "")
    let caption = data.header.at("photoCaption", default: "")

    // Neutralize the template's ambient block settings so we control the shape.
    set block(radius: 0pt, clip: false, above: 0pt, below: 0pt)
    if photo != "" {
      v(14pt) // breathing room between the profession subheading and the photo
      align(center, layout(size => {
        let w = size.width * (th.photoWidthPct / 100)
        box(
          width: w,
          height: w,
          radius: 50%, // circular mask
          clip: true,
          stroke: (paint: rgb(th.photoBorderColor), thickness: th.photoBorderWidth * 1pt),
          image(photo, width: w, height: w, fit: "cover", alt: data.header.firstName + " " + data.header.lastName),
        )
      }))
    }
    if caption != "" {
      v(12pt)
      align(center, text(style: "italic")[#caption])
    }
    v(14pt)
  },
  aside: {
    // Bold aside section headings (override the template's light weight).
    show heading.where(level: 1): set text(weight: 700, tracking: 0.12em)
    section(
      "Contact",
      {
        set image(width: 8pt)
        set grid(align: horizon)
        for (i, c) in data.contact.enumerate() {
          if i > 0 { line(stroke: 0.1pt, length: 100%) }
          contact-entry(icon-img(c.icon), link(c.href, c.text))
        }
      },
    )

    section(
      "Education",
      {
        set text(size: 7.5pt)
        grid(
          columns: (30pt, 1fr),
          column-gutter: 6pt,
          row-gutter: 14pt,
          align: horizon,
          ..data.education.map(e => (
            align(center, edu-logo(e)),
            {
              // Bold first line + inline right-aligned date, then detail lines —
              // all one flow so every line gap is the same (uniform leading).
              md(e.lines.at(0))
              if e.at("date", default: "") != "" {
                h(1fr)
                box(text(size: 6.5pt, weight: "light", fill: metaColor, e.date))
              }
              for ln in e.lines.slice(1) {
                linebreak()
                md(ln)
              }
            },
          )).flatten()
        )
      },
    )

    section(
      "Languages",
      // Rendered manually (not the template's language-entry, which forces the
      // secondary/Roboto font) so Languages matches the body font.
      grid(
        columns: (1fr, auto),
        row-gutter: 6pt,
        align: (left, right),
        ..data.languages.map(l => (l.language, l.level)).flatten()
      ),
    )

    if "hobbies" in data and data.hobbies.len() > 0 {
      section(
        "Hobbies",
        {
          set text(size: 7.5pt)
          data.hobbies.join("  ·  ")
        },
      )
    }
  },
)[
  // Bold section headings (override the template's light weight).
  #show heading.where(level: 1): set text(weight: 700, tracking: 0.12em)
  #set par(leading: 0.75em) // override the template's 1em main-column wrapper
  #for s in data.sections.filter(s => s.page == 1) {
    render-section(s)
  }
]

// --- Page 2+: full-width content, no aside/main grid ---
// Re-apply the theme's margin/font/color/heading style manually since
// resume()'s internal set/show rules (including set page(margin: ...)) are
// scoped to its own bracketed content above, not to sibling content out here.
#set page(margin: 26pt)
#set text(font: bodyFont, size: bodySize * 1pt, fill: textColor)
#set par(leading: 0.75em)
#show heading.where(level: 1): set text(font: headingFont, weight: 700, size: bodySize * 1pt, fill: headingColor, tracking: 0.12em)
#show heading.where(level: 1): set align(end)

#pagebreak()

#for s in data.sections.filter(s => s.page == 2) {
  render-section(s)
}
