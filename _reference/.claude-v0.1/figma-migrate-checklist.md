# /figma-migrate — runtime checklist

Compact reference. Full rules and rationale live in `commands/figma-migrate.md`.
**On each run, surface progress via TaskCreate — don't re-print this list to the user.**

---

## Phase 1 — Pre-flight

- [ ] **DS sync** — sample `Design system` page, diff vs `.claude/ds-manifest.json`, **always print result** (changed → ask; unchanged → "no changes since {date}")
- [ ] **Read & parse HTML** — states, visible text, DS components, conditional visibility
- [ ] **DS coverage map** — for **every** DS component in the manifest, decide which HTML elements it covers. Print the table to the user before building. Any HTML element with a DS match **must** use the DS instance in Phase 3 (size mismatch → use DS anyway, log as DS candidate). Any HTML element without a DS match → DS candidate artboard in Phase 4.

## Phase 2 — Defaults (apply silently)

- [ ] Placement = parallel band, origin `(80, maxY+200)` rounded to next 1000, 4×N grid stride 1320×880
- [ ] Naming = `Setting - {Section} - {State}`
- [ ] State list = auto-derived from HTML dev-panel
- [ ] One modal artboard per `openModal*()` call
- [ ] One toast artboard per distinct `showToast(...)` call
- [ ] DS Candidate band always created

## Phase 3 — Per-artboard build (loop)

- [ ] Inspect master layer tree (incl. hidden layers)
- [ ] Create fresh instance — never reuse a modified one
- [ ] Toggle visibility to match HTML
- [ ] Apply text overrides (loadFontAsync → find by chars → assign)
- [ ] Build with auto-layout: artboard `VERTICAL` → Tab bar → Title → body → optional Footer
- [ ] body uses `primaryAlign=CENTER, counterAlign=CENTER` for system-state screens
- [ ] Overlays escape via `layoutPositioning='ABSOLUTE'` (close X, Toast, Modal+backdrop, dev panel)
- [ ] Toast positioned center-bottom, 24px above bottom
- [ ] Footer = HORIZONTAL auto-layout, `primaryAlign=MAX` (or `SPACE_BETWEEN` for 3-button)
- [ ] **Icons from DS** — search before falling back to any text glyph
- [ ] Verify live instance tree

## Phase 4 — DS Candidate band

- [ ] Build at `(80, maxNewY+200)` with 32px label "DS Candidates — HTML structures not yet in DS"

---

## Conditional gates (fire only when triggered)

- [ ] **DS conflict** (master renders wrong in context) → pause + surface mismatch + ask, before any instance override
- [ ] **Bulk operation** (rebuild, mass swap, retrofit) → ask **"full pages vs. targeted pages?"** before proceeding
- [ ] **Section wrapping** (clones placed in a Section) → use section-local coords post-`appendChild`, verify with `absoluteBoundingBox`
- [ ] **This file edited** (visual rule) → ask user to build a focused test artboard in dated section
- [ ] **This file edited** (process rule) → note in summary, no test artboard

---

## Runtime display

Use TaskCreate for each phase. Examples:

```
✓ Pre-flight: DS sync (no changes since 2026-05-07)
✓ Pre-flight: HTML parsed (12 states, 4 modals, 4 toasts)
⏳ Phase 3: Building Edit Profile [5/17]
☐ Phase 4: DS Candidate band
```

User sees **active phase only** in the spinner — never the full 24-item list. After the run, summary lists what completed plus any conditional gates that fired.
