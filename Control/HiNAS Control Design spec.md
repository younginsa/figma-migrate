# HiNAS Control — Design Specification

_Source of truth for visual rules, layout constraints, and interaction patterns across the HiNAS Control setting dialog._
_Inherits from: `../HiNAS Design System.md` — all global tokens, typography, spacing, radius, and shared component behavior apply unless overridden here._
_Cross-reference: `combinator-state-matrix.md` (state logic), `combinator-component-mapping.md` (token mapping)._
_Figma mockup file: `iSBKt82nnX2Uebb1hH4AfE` (Control DS — Claude x Figma)._
_Figma global DS file: `nCcEQ5xPIJ1d4pivt35Jkx` (HiNAS Design System)._

---

## 1. Toast / Snackbar

### Positioning

| Property | Value |
|---|---|
| Horizontal | Center-aligned within the dialog |
| Vertical anchor | 24 px above the dialog's bottom edge |
| Stacking direction | Upward (new toasts push previous ones up) |
| Container | Scoped to the dialog frame — NOT the viewport |

```
┌──────────────────────────────────┐
│          dialog content          │
│                                  │
│                                  │
│   ┌──────────────────────────┐   │
│   │       Toast message      │   │  ← centered, 24 px from bottom
│   └──────────────────────────┘   │
└──────────────────────────────────┘
                                  ↑ 24 px
```

### Variants (from DS component `Toast`)

| DS variant | Trigger in HTML |
|---|---|
| `type=success` | Profile saved · Profile deleted |
| `type=processing` | Save in progress (`Saving…`) |
| `type=failed` | Save failed · Select profile failed |
| `type=failed-action` | Row deleted (+ **Undo**) · Save failed (+ **Retry**) |
| `type=failed 2` | Multi-line failure — select profile |
| `type=failed 2-action` | Multi-line failure — delete profile (+ **Retry**) |

### Width

- Default: `compact` width (sized to content)
- Long error messages with action: `compact` — wraps to 2-line (`failed 2`, `failed 2-action`)

### Duration

- Default auto-dismiss: **4 000 ms**
- Toasts with action (Undo / Retry): remain until dismissed or action taken

---

## 2. Footer CTA layout

Applies to any Setting artboard that has bottom action buttons (primarily Setting 2 — Edit screens).

### Spacing

| Property | Value |
|---|---|
| Margin — left | 24 px |
| Margin — right | 24 px |
| Margin — bottom | 24 px |
| Gap from content above | 40 px |
| Gap between buttons (within right group) | 12 px |

### Alignment

| Button role | Alignment | Order (left → right) |
|---|---|---|
| Destructive / tertiary (e.g. Delete Profile) | Left edge (x = 24 px) | Alone on the left |
| Secondary (e.g. Cancel) | Right group | First (leftmost of right group) |
| Primary (e.g. Save) | Right group | Last (rightmost, flush to right margin) |

```
┌──────────────────────────────────────────────┐
│                                              │
│  [Delete Profile]        [Cancel]  [Save]   │  ← y = frameH − 24 − btnH
│ ←24px                          24px→        │
└──────────────────────────────────────────────┘
```

- Right group: `primary.x = frameWidth − 24 − primary.width`; `secondary.x = primary.x − 12 − secondary.width`
- If only one button exists on the right, it still aligns to the right margin.

---

## 3. Artboard naming convention

All top-level Figma artboards follow:

```
Setting {depth} — {Screen name} ({State})
```

| Segment | Description |
|---|---|
| `Setting 1` | Profile list screen |
| `Setting 2` | Edit profile screen |
| State suffix | Optional: `(Dirty)`, `(Saving)`, `(Error)`, etc. |

---

## 4. Dialog shell

| Property | Value |
|---|---|
| Width | `min(1120px, 96vw)` |
| Min-height | `680 px` |
| Background | `--color-bg-surface` `#15161A` |
| Border | `1 px solid rgba(255,255,255,0.08)` |
| Border-radius | `8 px` |
| Shadow | `0 8px 16px rgba(0,0,0,0.24)` |

---

_Last updated: 2026-04-29_
