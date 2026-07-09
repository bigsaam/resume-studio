// =========================================================================
// TEMPLATE: starter
//
// A single-column, full-width resume. No aside, no photo. Deliberately plain:
// it's the blank page you start from, and a worked example of the minimum a
// template must implement.
//
// Reads the same `resume.json` contract as every other template, but only uses
// the fields it needs. Unused fields (education logos, hobbies, photo) are
// simply ignored.
// =========================================================================

#let data = json("resume.json")
#let th = data.theme
#let textColor = rgb(th.colors.text)
#let metaColor = textColor.lighten(30%)
#let headingColor = rgb(th.colors.heading)
#let bodyFont = th.fonts.body
#let headingFont = th.fonts.heading
#let nameFont = th.fonts.at("name", default: bodyFont)
#let bodySize = th.at("bodySize", default: 9)

#let md(s) = eval(s, mode: "markup")

#set page(paper: "us-letter", margin: 46pt)
#set text(font: bodyFont, size: bodySize * 1pt, fill: textColor)
#set par(leading: 0.75em, justify: false)
#set list(spacing: 6pt, marker: [•])

#let section(title, body) = {
  v(12pt)
  block(breakable: false, {
    text(font: headingFont, weight: 700, size: (bodySize + 0.5) * 1pt, fill: headingColor, tracking: 0.12em, upper(title))
    v(3pt)
    line(stroke: 0.6pt + headingColor, length: 100%)
    v(6pt)
  })
  body
}

#let render-bullet(b) = {
  if type(b) == str { md(b) } else {
    md(b.text)
    if b.at("date", default: "") != "" {
      h(1fr)
      text(weight: "light", fill: metaColor, b.date)
    }
    if b.at("sub", default: ()).len() > 0 { list(..b.sub.map(md)) }
  }
}

// ---- header ----
#align(center, {
  text(font: nameFont, size: th.nameSize * 1pt, weight: "bold", fill: rgb(th.colors.name))[
    #data.header.firstName #data.header.lastName
  ]
  v(4pt)
  text(size: (bodySize + 1) * 1pt, fill: metaColor, data.header.profession)
  v(5pt)
  // Contact details on one line, separated by dots.
  text(size: (bodySize - 0.5) * 1pt, fill: metaColor,
    data.contact.map(c => c.text).join("  ·  "))
})

#if data.header.bio != "" {
  v(10pt)
  md(data.header.bio)
}

// ---- sections (page field is ignored: this template is one continuous flow) ----
#for s in data.sections {
  if s.kind == "work" {
    section(s.title, {
      for (i, e) in s.entries.enumerate() {
        if i > 0 { v(8pt) }
        block(breakable: false, {
          grid(columns: (1fr, auto), align: (left, right),
            { strong(e.title); if e.at("organization", default: "") != "" [ #text(fill: metaColor)[ — #e.organization] ] },
            text(fill: metaColor, weight: "light", e.at("timeframe", default: "")),
          )
          if e.at("location", default: "") != "" {
            text(size: (bodySize - 1) * 1pt, fill: metaColor, e.location)
          }
        })
        v(4pt)
        if "bullets" in e and e.bullets.len() > 0 { list(..e.bullets.map(render-bullet)) }
        else { md(e.at("body", default: "")) }
      }
    })
  } else if s.kind == "bullets" or s.kind == "bullets-2col" {
    section(s.title, list(..s.bullets.map(render-bullet)))
  } else if s.kind == "exhibitions" {
    section(s.title, {
      for (i, e) in s.entries.enumerate() {
        if i > 0 { v(6pt) }
        block(breakable: false, {
          strong(md(e.title))
          if e.at("date", default: "") != "" { h(1fr); text(weight: "light", fill: metaColor, e.date) }
          if e.at("meta", default: "") != "" { linebreak(); text(fill: metaColor, md(e.meta)) }
          if e.at("items", default: ()).len() > 0 {
            list(..e.items.map(it => {
              md(it.text)
              if it.at("date", default: "") != "" { h(1fr); text(weight: "light", fill: metaColor, it.date) }
            }))
          }
        })
      }
    })
  }
}
