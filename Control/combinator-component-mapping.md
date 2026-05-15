# Combinator — HTML ↔ Figma Component Mapping

_Companion to `combinator-state-matrix.md`. Defines the exact Figma tokens to use for each visual element. Review this before implementation begins._

## 1. Root CSS variables (token layer)

Every component below references these variables. If a value needs to change, it changes here once.

```css
:root {
  /* --- Surfaces (dark Dusk mode) --- */
  --color-bg-overlay: rgba(0, 0, 0, 0.64);     /* Black 64 — modal backdrop */
  --color-bg-base: #0E0F12;                    /* Gray/50  — page behind dialog */
  --color-bg-surface: #15161A;                 /* Gray/100 — dialog body */
  --color-bg-raised: #1B1C21;                  /* Gray/200 — cards, list rows */
  --color-bg-raised-hover: #23252B;            /* Gray/300 — row hover */
  --color-bg-input: #23252B;                   /* Gray/300 — input fill */
  --color-bg-input-hover: #3C3E47;             /* Gray/400 */

  /* --- Borders / dividers --- */
  --color-border-subtle: rgba(255,255,255,0.08);  /* White 8  */
  --color-border-default: #3C3E47;                /* Gray/400 */
  --color-border-emphasis: #5A5D67;               /* Gray/500 */

  /* --- Text --- */
  --color-text-muted: #858998;      /* Gray/600 — subtitle, caption, disabled */
  --color-text-secondary: #B0B3BF;  /* Gray/700 — chart labels, meta */
  --color-text-primary: #D0D2D9;    /* Gray/800 — body, inputs */
  --color-text-emphasis: #ECEDF0;   /* Gray/900 — title, selected label */
  --color-text-on-primary: #FFFFFF; /* White — text on blue buttons */

  /* --- Brand / semantic --- */
  --color-primary: #1379F3;         /* Blue/400 — primary action, check icon, active tab underline */
  --color-primary-hover: #348FF4;   /* Blue/500 */
  --color-primary-subtle: #004DA3;  /* Blue/100 — selected row tint */

  --color-danger: #FF4141;          /* Red/500 — destructive, invalid cell border */
  --color-danger-hover: #EA2929;    /* Red/400 */
  --color-danger-subtle: #A50000;   /* Red/100 — banner bg tint */

  --color-warning: #F4810C;         /* Orange/600 */
  --color-success: #2BB46D;         /* Green/600 — success toast accent */

  /* --- Typography --- */
  --font-family: "Inter", "Noto Sans KR", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;

  /* name          weight  size/lh    Figma token           */
  --text-title-2:  600 32px/40px var(--font-family);  /* 1M/Title 2 Bold  */
  --text-title-1:  500 26px/32px var(--font-family);  /* 1M/Title 1 Bold  */
  --text-body-1-b: 600 18px/24px var(--font-family);  /* 1M/Body 1 Bold   */
  --text-body-1:   400 18px/24px var(--font-family);  /* 1M/Body 1        */
  --text-body-2:   400 20px/28px var(--font-family);  /* 1M/Body 2        */
  --text-caption-b:500 16px/24px var(--font-family);  /* 1M/Caption Bold  */
  --text-caption:  400 16px/24px var(--font-family);  /* 1M/Caption       */

  /* --- Spacing (4px grid) --- */
  --space-xs: 4px;    --space-sm: 8px;    --space-md: 12px;
  --space-lg: 16px;   --space-xl: 24px;   --space-2xl: 32px;
  --space-3xl: 48px;

  /* --- Radii --- */
  --radius-sm: 4px;   /* inputs, small chips */
  --radius-md: 8px;   /* buttons, cards, dialog */
  --radius-lg: 12px;  /* modal */

  /* --- Shadows (Dusk mode) --- */
  --shadow-dialog: 0 8px 16px rgba(0,0,0,0.24);
  --shadow-modal:  0 2px 8px rgba(0,0,0,0.4), 0 9px 20px rgba(0,0,0,0.4);
  --shadow-toast:  0 4px 12px rgba(0,0,0,0.32);

  /* --- Motion --- */
  --transition-fast: 120ms ease;
  --transition-default: 200ms ease;
}
```

## 2. Component specs

### 2.1 Dialog shell

| Property | Value |
|---|---|
| Max width | 1120px (`width/1120`) |
| Min height | 680px |
| Background | `--color-bg-surface` |
| Border radius | `--radius-md` (8px) |
| Shadow | `--shadow-dialog` |
| Padding | `--space-xl` (24px) |
| Close × | top-right, 24×24 hit area, Gray/600, hover Gray/800 |

### 2.2 Tab bar

| State | Background | Text | Indicator |
|---|---|---|---|
| Default (inactive) | transparent | `--color-text-muted` | none |
| Hover | `rgba(255,255,255,0.04)` | `--color-text-secondary` | none |
| Active | transparent | `--color-text-emphasis` | 2px bottom border `--color-primary` |

Tab padding: `var(--space-md) var(--space-lg)` (12px 16px). Font: `--text-caption-b`. Divider under tab bar: `1px solid var(--color-border-subtle)`.

### 2.3 Header (both pages)

| Element | Font | Color | Margin |
|---|---|---|---|
| Title (Page 1: "Combinator Curve Profile"; Page 2: "Edit Profile N") | `--text-title-2` | `--color-text-emphasis` | `var(--space-md) 0 var(--space-xs)` |
| Back arrow (Page 2) | 24×24 icon | `--color-text-primary` → hover `--color-text-emphasis` | right-margin `var(--space-md)` |
| Subtitle (breadcrumb) | `--text-caption` | `--color-text-muted` | `0 0 var(--space-lg)` |

### 2.4 Page 1 — section labels

"Selected Profile" / "Other Profiles" labels.

| Property | Value |
|---|---|
| Font | `--text-body-1-b` |
| Color | `--color-text-emphasis` |
| Margin | `var(--space-lg) 0 var(--space-sm)` |

### 2.5 Page 1 — Selected Profile card

| Property | Value |
|---|---|
| Background | `--color-bg-raised` |
| Border | `1px solid var(--color-primary-subtle)` (Blue/100 tint to indicate active) |
| Border radius | `--radius-md` |
| Padding | `var(--space-lg) var(--space-xl)` |
| Layout | grid: `[check] [name/meta] [Details]` |
| Check icon | 20×20, `--color-primary`, on left |
| Profile name | `--text-body-1-b`, `--color-text-emphasis` |
| Meta (e.g. "Active profile") | `--text-caption`, `--color-text-muted` |
| Details button | always visible; see 2.10 secondary-small |
| Cursor | default (body click is a no-op) |

### 2.6 Page 1 — Other Profile row

| Property | Value |
|---|---|
| Background | `--color-bg-raised` |
| Border | `1px solid var(--color-border-subtle)` between rows |
| Border radius | first/last row inherit list radius; inner rows none |
| Padding | `var(--space-md) var(--space-xl)` |
| Layout | grid: `[name] [spacer] [Details]` |
| Hover background | `--color-bg-raised-hover` |
| Hover cursor | pointer |
| Details button | **opacity 0 by default**, `opacity 1 on row hover`, transition `--transition-fast` |
| Click (body) | opens Select-confirm modal |

### 2.7 Page 1 — "+ Add Profile" row

| Property | Value |
|---|---|
| Height | matches Other Profile row height |
| Background | transparent |
| Border | `1px dashed var(--color-border-default)` |
| Border radius | `--radius-sm` |
| Text | "+ Add Profile", centered |
| Text font/color | `--text-caption-b`, `--color-text-secondary` |
| Hover | border color `--color-border-emphasis`, text `--color-text-emphasis`, bg `rgba(255,255,255,0.04)` |

### 2.8 Buttons

| Variant | Background | Text | Border | Height | Padding | Font |
|---|---|---|---|---|---|---|
| Primary | `--color-primary` | `--color-text-on-primary` | none | 40px | `0 var(--space-lg)` | `--text-caption-b` |
| Primary hover | `--color-primary-hover` | same | same | — | — | — |
| Primary disabled | `--color-primary` at opacity 0.5 | same | same | — | — | — |
| Secondary | `--color-bg-raised` | `--color-text-primary` | `1px solid var(--color-border-default)` | 40px | `0 var(--space-lg)` | `--text-caption-b` |
| Secondary hover | `--color-bg-raised-hover` | `--color-text-emphasis` | border `--color-border-emphasis` | — | — | — |
| Ghost | transparent | `--color-text-primary` | `1px solid var(--color-border-subtle)` | 40px | `0 var(--space-lg)` | `--text-caption-b` |
| Danger | transparent | `--color-danger` | `1px solid var(--color-danger-subtle)` | 40px | `0 var(--space-lg)` | `--text-caption-b` |
| Danger hover | `rgba(255,65,65,0.08)` | `--color-danger` | border `--color-danger` | — | — | — |
| Small (e.g. Details, row Delete) | same as variant | — | — | 32px | `0 var(--space-md)` | `--text-caption` (14–15px ok) |

Border radius for all buttons: `--radius-sm` (4px per Medium token) — matches Figma reference; if you prefer 6–8px rounded, call out and I'll flip.

### 2.9 Page 2 — editor layout

Keep current HTML's `.layout` grid: top-controls (profile selector removed in v2), chart grid, table, footer.

- Background: `--color-bg-surface` (inherits from dialog)
- Inner padding: `var(--space-lg)`
- Gap: `var(--space-lg)` between sections

### 2.10 Inputs (select / number inputs in the table)

| Property | Value |
|---|---|
| Background | `--color-bg-input` |
| Border | `1px solid var(--color-border-default)` |
| Border radius | `--radius-sm` |
| Height (min) | 36px |
| Padding | `0 var(--space-md)` |
| Font | `--text-caption` |
| Color | `--color-text-primary` |
| Focus | border `--color-primary`, outline none, slight glow `0 0 0 2px rgba(19,121,243,0.24)` |
| Invalid | border `--color-danger`, tooltip below on focus/hover showing rule |
| Disabled | opacity 0.5, cursor not-allowed |

### 2.11 Table

| Element | Value |
|---|---|
| Table background | `--color-bg-surface` (transparent over dialog) |
| Max height scroll | 360px |
| Header row background | `--color-bg-raised-hover` |
| Header text | `--text-caption-b`, `--color-text-secondary` |
| Header border-bottom | `1px solid var(--color-border-default)` |
| Body cell padding | `var(--space-sm) var(--space-md)` |
| Body cell border-top | `1px solid var(--color-border-subtle)` |
| Row No. cell | `--font-mono`, `--color-text-secondary` |
| Insert-row between rows | 26px tall, centered `+` in a 34×26 ghost button; row bg `rgba(255,255,255,0.02)` |

### 2.12 Chart card

| Property | Value |
|---|---|
| Background | `rgba(16,19,27,0.72)` (unchanged) |
| Border | `1px solid var(--color-border-subtle)` |
| Border radius | `--radius-sm` |
| Padding | `var(--space-sm)` |
| Title | `--text-caption-b`, `--color-text-secondary` |
| Canvas bg | linear-gradient subtle (current value works; keep) |
| Line colors | RPM `var(--color-warning)`; Pitch angle `var(--color-success)` |

### 2.13 Footer (Page 2)

Flex row: Delete Profile (left) | flex-grow spacer | Cancel, Save (right).

- Padding-top: `var(--space-lg)`
- Border-top: `1px solid var(--color-border-subtle)`
- Gap between right-side buttons: `var(--space-sm)`

### 2.14 Modals (Select confirm / Add Profile / Delete Profile / Unsaved guard)

| Property | Value |
|---|---|
| Overlay | `--color-bg-overlay` |
| Container width | 420px (`width/420`) |
| Container background | `--color-bg-raised` |
| Container border radius | `--radius-lg` |
| Shadow | `--shadow-modal` |
| Padding | `var(--space-xl)` |
| Title font | `--text-title-1` |
| Body font | `--text-body-1`, color `--color-text-primary` |
| Footer | flex row, `justify-content: flex-end`, gap `var(--space-sm)` |

Modal-specific notes:
- Add Profile modal: integer input with `type="number"` + `min=0` + `step=1`. Field label "Profile ID". Live validation shows error if ID already exists.
- Delete Profile modal: primary button uses Danger variant.
- Unsaved guard: **three** footer buttons (Save / Discard / Cancel). Save = primary, Discard = danger-ghost, Cancel = secondary.

### 2.15 Toasts

| Variant | Accent | Position | Duration |
|---|---|---|---|
| Success | left-border 2px `--color-success`, icon check | bottom-right, 24px from edges | 4s auto-dismiss |
| Undo (row delete) | left-border 2px `--color-text-secondary` + "Undo" text-button | bottom-right | 5s auto-dismiss |

Toast container: `--color-bg-raised`, `--radius-md`, `--shadow-toast`, padding `var(--space-md) var(--space-lg)`, min-width 280px.

### 2.16 Inline error banner

| Property | Value |
|---|---|
| Background | `rgba(255,65,65,0.08)` |
| Border | `1px solid rgba(255,65,65,0.32)` |
| Border radius | `--radius-sm` |
| Padding | `var(--space-md) var(--space-lg)` |
| Icon | alert triangle, `--color-danger` |
| Text | `--text-caption`, `--color-text-emphasis` |
| Retry button | ghost variant, inline on the right |
| Placement | above the editor body / above the Page 1 list |

### 2.17 Loading spinner (centered state)

| Property | Value |
|---|---|
| Spinner | 40×40, three-quarter arc, `--color-text-secondary` stroke 3px, animated rotate 1s linear infinite |
| Title text (below) | `--text-body-1-b`, `--color-text-emphasis`, e.g. "Loading profiles…" |
| Subtitle text | `--text-caption`, `--color-text-muted`, e.g. "Loading content. Please wait…" |
| Layout | centered in available space (flex center) |

### 2.18 Empty state

| Property | Value |
|---|---|
| Title | `--text-body-1-b`, `--color-text-emphasis` ("No profile ID is found") |
| Body | `--text-caption`, `--color-text-muted` (two-line copy, centered) |
| CTA | Primary button "Add Profile", margin-top `var(--space-lg)` |
| Layout | centered, vertical stack, gap `var(--space-md)` |

## 3. State variant reference (quick)

| State | What changes |
|---|---|
| Hover on button | background → `--color-primary-hover` (or equivalent) |
| Active/pressed on button | opacity 0.92 |
| Disabled button | opacity 0.5, cursor not-allowed |
| Focus on any interactive | outline: 2px `--color-primary` glow (box-shadow), outline: none native |
| Invalid input | border color → `--color-danger`, tooltip below/adjacent on focus |
| Dirty editor | Save button label text only ("Save" → "Save changes") |
| In-flight save | Save button replaced by spinner + "Saving…"; all inputs disabled |

## 4. What this mapping intentionally leaves unspecified

- **Exact icon SVGs.** I'll use lucide-inspired inline SVGs for check, chevron-left (back arrow), alert-triangle, trash, plus, x. If you have a preferred icon set, flag now.
- **Exact Korean ↔ English copy.** All UI strings default to English; Korean can be added via `lang="ko"` alternate strings after the structural work.
- **Responsive breakpoints.** Keeping the existing 980px breakpoint for narrow layouts; no new breakpoints introduced.
- **Animation beyond hover transitions.** No page-transition animation between Page 1 ↔ Page 2 in v1; if you want a slide transition, flag it.

## 5. Sign-off

If this mapping looks right, I'll proceed to implementation. Two implementation-order notes:

1. I'll ship the **token layer first** (`:root` vars only) so you can eyeball colors/spacing, then layer components on top.
2. I'll build **Page 1 from scratch** (it doesn't exist yet), then **refactor the existing editor into Page 2** (structural change but behavior-preserving), then **wire navigation**, then **build modals and toasts**, then **QA each state**.
