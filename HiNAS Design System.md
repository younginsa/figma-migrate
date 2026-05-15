# HiNAS Design System

_Global design language shared across all HiNAS products._
_Products: HiNAS Control · HiNAS SVM · HiNAS Cloud (planned)._
_Figma library file: `nCcEQ5xPIJ1d4pivt35Jkx` (HiNAS Design System)._

---

## 1. Theme

HiNAS supports **three theme modes** (Day / Dusk / Night) to cover the full 24h operating cycle of marine and wheelhouse environments. Each product opts into a subset.

### Modes

| Mode | Glyph | Use case |
|---|---|---|
| Day | 🔆 | Bright daylight, outdoor / desk operation. Light backgrounds. |
| Dusk | 🔅 | Transition periods, indoor low-light, default for most settings. Mid-darkness. |
| Night | 🌙 | Deep dark, preserves night vision. Lowest luminance, red-shifted accents. |

### Per-product mode adoption

| Product | Modes supported |
|---|---|
| HiNAS Control | Dusk only |
| HiNAS SVM | Dusk only |
| HiNAS Cloud | Day · Dusk · Night |

Light mode (Day) is **only** active for Cloud. Control and SVM are Dusk-only and may not have Day/Night assets defined.

---

## 2. Color tokens

All color tokens live in the Figma variable collection **`Colors`** (244 variables) within `nCcEQ5xPIJ1d4pivt35Jkx`. Every token is namespaced by mode prefix.

### Naming convention

```
{mode glyph} {mode name}/{family}/{step}
```

Examples:
- `🔅 Dusk mode/Gray/500`
- `🔆 Day mode/SemanticBlue/400`
- `🌙 Night mode/SemanticRed/500`

### Palette structure (per mode)

Each mode defines the same **8 color families**:

| Family | Steps | Typical use |
|---|---|---|
| Gray | 50 / 100–900 (Day adds 10, 20) | Backgrounds, surfaces, text, borders |
| SemanticRed | 100–900 | Destructive, error, danger |
| SemanticOrange | 100–900 | Warning, caution |
| SemanticYellow | 100–900 | Notice, pending |
| SemanticGreen | 100–900 | Success, healthy |
| SemanticBlue | 100–900 | Primary action, info |
| Magenta | 100–900 | Accent, special states |
| Olive | 100–900 | Neutral accent (maritime/nav specific) |

### Basic Foreground (mode-agnostic)

White and Black tokens with an opacity scale, used for overlays, glass effects, and shadows that need to work across all modes:

```
Basic Foreground/White/{opacity}
Basic Foreground/Black/{opacity}
```

Available opacities: **2, 4, 6, 8, 12, 20, 36, 64, 72, 100**.

### Semantic role mapping

Use this table to pick a step for a given UI role. Replace `{mode}` with the active mode glyph + name.

| Role | Token reference |
|---|---|
| Surface background | `{mode}/Gray/900` (Dusk/Night) · `{mode}/Gray/50` (Day) |
| Elevated surface | `{mode}/Gray/800` (Dusk/Night) · `{mode}/Gray/100` (Day) |
| Dividers, subtle borders | `Basic Foreground/White/8` (Dusk/Night) · `Basic Foreground/Black/8` (Day) |
| Default borders, separators | `Basic Foreground/White/12` (Dusk/Night) · `Basic Foreground/Black/12` (Day) |
| Text — primary | `{mode}/Gray/100` (Dusk/Night) · `{mode}/Gray/900` (Day) |
| Text — secondary | `{mode}/Gray/300` (Dusk/Night) · `{mode}/Gray/700` (Day) |
| Text — muted / placeholder | `{mode}/Gray/500` |
| Accent — primary | `{mode}/SemanticBlue/500` |
| Accent — hover | `{mode}/SemanticBlue/400` |
| Destructive | `{mode}/SemanticRed/500` |
| Success | `{mode}/SemanticGreen/500` |
| Warning | `{mode}/SemanticOrange/500` |
| Modal backdrop | `Basic Foreground/Black/64` |

---

## 3. Typography

| Property | Value |
|---|---|
| Typeface | Inter |
| Fallback | "Noto Sans KR", sans-serif |
| Rendering | Anti-aliased |

### Scale

| Role | Size | Weight | Line height |
|---|---|---|---|
| Heading / page title | 20 px | 600 Semi Bold | 28 px |
| Section label | 16 px | 600 Semi Bold | 24 px |
| Body default | 14 px | 400 Regular | 20 px |
| Body small | 13 px | 400 Regular | 18 px |
| Caption / breadcrumb | 12 px | 400 Regular | 16 px |
| Button label (size 48) | 14 px | 500 Medium | 20 px |
| Button label (size 36) | 13 px | 500 Medium | 18 px |

---

## 4. Spacing scale

Base unit: **4 px**.

| Token | Value | Common use |
|---|---|---|
| `--space-xs` | 4 px | Icon padding, tight gaps |
| `--space-sm` | 8 px | Inline gaps, compact padding |
| `--space-md` | 12 px | Button gap in footer CTA group |
| `--space-lg` | 16 px | Section internal padding |
| `--space-xl` | 24 px | Dialog edge margins |
| `--space-2xl` | 40 px | Content-to-footer gap |
| `--space-3xl` | 48 px | Section separators |

---

## 5. Border radius (Round style)

HiNAS uses a **rounded** style throughout. No sharp corners.

| Context | Radius |
|---|---|
| Dialog shell | 8 px |
| Cards / profile rows | 8 px |
| Buttons | 6 px |
| Input fields | 6 px |
| Toast / snackbar | 8 px |
| Modal | 12 px |
| Inline badges / chips | 999 px (pill) |

---

## 6. Iconography

| Property | Value |
|---|---|
| Library | Internal — `Icon_*` instances in DS Figma files |
| Default size | 24 × 24 px (container 40 × 40 px) |
| Small size | 16 × 16 px |
| Stroke weight | 1.5 px |
| Style | Outlined, rounded ends |

---

## 7. Shared component behavior

### Button

| Size | Height | Min-width | Padding (H) |
|---|---|---|---|
| 48 | 48 px | 120 px | 20 px |
| 36 | 36 px | 80 px | 16 px |

- **Primary**: `--color-accent-primary` fill, white label
- **Secondary**: transparent fill, `--color-border-default` border, `--color-text-primary` label
- **Destructive**: `--color-destructive` fill, white label
- **Disabled**: 40% opacity on fill and label; no pointer events

### Modal

| Property | Value |
|---|---|
| Shell border-radius | 12 px |
| Background | `--color-bg-elevated` `#1E1F25` |
| Backdrop | `rgba(0,0,0,0.48)` |
| Shadow | `0 16px 32px rgba(0,0,0,0.32)` |
| Close (×) icon position | Top-right corner, 16 px from top, 16 px from right |
| Close icon size | 24 × 24 px |
| Header padding | 24 px top · 24 px left/right · 16 px bottom |
| Body padding | 0 · 24 px left/right · 24 px bottom |
| Footer padding | 16 px top · 24 px left/right · 24 px bottom |
| Footer button order | Cancel (secondary) → Confirm (primary or destructive) |

```
┌─────────────────────────────────┐  ← border-radius 12px
│  Title                       ×  │  ← × at top-right: 16px from edges
│─────────────────────────────────│
│  Body content                   │
│                                 │
│─────────────────────────────────│
│                [Cancel] [Confirm]│  ← footer: secondary then primary
└─────────────────────────────────┘
```

### System states (Loading / Empty / Error)

Provided by the DS `System states` component. Visibility-toggle pattern:

| State | Icon | Text | Button |
|---|---|---|---|
| Loading | visible (spinner) | visible | hidden |
| Empty | hidden | visible | visible |
| Error | visible (error icon) | visible | visible (Retry) |

See `/figma-migrate` skill for the implementation pattern.

---

## 8. Elevation & shadow

| Level | Shadow | Usage |
|---|---|---|
| Surface | none | Base panel / dialog background |
| Raised | `0 4px 8px rgba(0,0,0,0.16)` | Cards, profile rows |
| Dialog | `0 8px 16px rgba(0,0,0,0.24)` | Dialog shell |
| Modal | `0 16px 32px rgba(0,0,0,0.32)` | Modal overlay |
| Toast | `0 4px 12px rgba(0,0,0,0.24)` | Toast / snackbar |

---

## 9. Product-specific extensions

Each product spec inherits this document and adds only product-specific overrides.

| Product | Spec file | Figma file |
|---|---|---|
| HiNAS Control | `Control/HiNAS Control Design spec.md` | `iSBKt82nnX2Uebb1hH4AfE` |
| HiNAS SVM | `SVM/HiNAS SVM Design spec.md` | TBD |
| HiNAS Cloud | `Cloud/HiNAS Cloud Design spec.md` | TBD |

**Inheritance rule:** if a rule is not overridden in the product spec, this document is authoritative.

---

_Last updated: 2026-04-30_
