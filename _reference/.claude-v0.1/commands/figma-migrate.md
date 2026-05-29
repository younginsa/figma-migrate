# /figma-migrate — HTML → Figma Artboard Migration Workflow

Migrate a HiNAS Control HTML mockup file into Figma artboards using live DS component instances.
Cross-reference: `HiNAS Control Design spec.md` for spacing/positioning rules.
Figma file: `iSBKt82nnX2Uebb1hH4AfE` (Control DS — Claude x Figma).

---

## Usage

```
/figma-migrate <absolute-path-to-html-file>
```

The HTML file path is `$ARGUMENTS`. If `$ARGUMENTS` is empty, ask the user once for a path, then proceed.

**Do not ask the user for clarification on placement, naming, modal/toast handling, or state list — proceed with the defaults below.** The user can request adjustments after the migration completes.

---

## Runtime checklist — use tasks, not text dumps

The compact runbook lives at `.claude/figma-migrate-checklist.md`. On each run:

1. **Read both files** — `commands/figma-migrate.md` (full rules) and `figma-migrate-checklist.md` (phase list).
2. **Create tasks** via TaskCreate for each top-level phase (Pre-flight / Defaults / Per-artboard / DS Candidate band) — *not* one task per checkbox. Per-artboard becomes one task per artboard inside the loop.
3. **Update task status** as you progress (`pending` → `in_progress` → `completed`).
4. **Never re-print the full checklist to the user.** The TaskCreate UI already shows the active phase compactly. Only mention items individually when reporting completion or when a conditional gate fires.
5. **Conditional gates** (DS conflict, scope ask, section coords, self-test) — surface these as one-off prompts when their trigger condition occurs; don't pre-create tasks for them.

This keeps the runtime view tight: the user sees only the active phase + a brief progress summary, instead of a 24-line wall of text every run.

## Live checklist (2nd Terminal view)

A separate Terminal window renders the always-on rules + this workflow's checklist. To keep it accurate during a `/figma-migrate` run. **Paths are relative to the project root** (Claude Code's working directory) — do not use `$CLAUDE_PROJECT_DIR`, it is not set inside Bash tool invocations.

**At the very start of the run (before Step 1):**
```bash
bash .claude/scripts/migrate-mode.sh on
```

**At the very end (after Step 7 verify, just before the final summary):**
```bash
bash .claude/scripts/migrate-mode.sh off
```

**As each checklist item is worked on**, mark its status using the exact label from `figma-migrate-checklist.md`:
```bash
bash .claude/scripts/rule.sh "DS sync" running   # before doing the work
bash .claude/scripts/rule.sh "DS sync" done      # after the work passes
```

For workflow items, use the bold name (e.g. `"DS sync"`, `"Read & parse HTML"`, `"Icons from DS"`) or the leading text up to ` — ` / ` = ` (e.g. `"Placement"`, `"Naming"`, `"Toggle visibility to match HTML"`). Done state stays solid until `migrate-mode.sh off` clears it.

**Retrofits and follow-up fixes count too.** Any session work that touches `/figma-migrate` outputs — DS conformance fixes (e.g. swapping a custom frame for a DS instance), text override corrections, layout retrofits, mass icon swaps, etc. — should also turn migrate-mode on, fire the relevant rule(s), and turn it off when done. The 2nd Terminal view is for any active migration work, not just the initial run.

---

## Defaults (do not ask the user — just apply)

| Question | Default answer |
|---|---|
| Placement | `(A) Parallel set` — create a new band of artboards on the page below all existing content. Origin starts at `(80, maxExistingY + 200)` rounded to the next 1000. Use a 4×N grid with stride `1320×880`. |
| Artboard naming | `Setting - {Section} - {State}` where `{Section}` is derived from the HTML filename (e.g. `cpp-setting-tab-mockup-update.html` → `CCP`; strip `-mockup`, `-update`, `-tab`, etc., then uppercase the remaining short token). If unclear, use the first capitalized word from the HTML's `<h1>` / `dialog-title`. |
| State list | Auto-derive from HTML: every `case '<key>':` in the dev panel switch + `[data-dev]` button labels. Don't ask for confirmation. |
| Modal handling | Always create one artboard per `openModal*()` / `openConfirm*()` function call in the HTML, named `Setting - {Section} - Modal {Title}`. Parent state = the most natural one (Add Profile → Empty; Delete → Edit; Unsaved guard → Edit dirty; Select confirm → Populated). Use `Modal/type=Confirm` master with backdrop. If HTML has 3 buttons, hide inner Button-dual children and add 3 standalone size=36 Buttons in the modal's footer band. |
| Toast handling | Always create one artboard per distinct `showToast(...)` invocation in the HTML, named `Setting - {Section} - Toast {short label}`. Use `Toast/width=compact, type=success` for `success` and `default` variants; `width=compact, type=failed` for errors. Position center, 24px above bottom. |
| DS-candidate band | Always create. Place at `(80, maxNewY + 200)` with a 32px label "DS Candidates — HTML structures not yet in DS". |

---

## Core principles

1. **HTML is the source of truth.** When existing Figma artboards differ from the imported HTML (old structure, stale text, outdated content), refresh the artboards to match the HTML. Cloning an old artboard for scaffolding is fine, but always diff its content against the HTML and update accordingly. Never ship a migrated artboard that contradicts the HTML.

2. **HTML structures missing from the DS become DS-candidate artboards.** If the HTML uses a UI element that does not exist as a DS component (e.g., a custom list row, banner, composer, or section header), do not just draw it ad-hoc inside the screen artboards. Also produce a separate isolated artboard named `DS Candidate — {ComponentName}` so the user can absorb it into the design system. Place these candidate artboards in a clearly labeled "DS Candidates" band on the canvas.

3. **Remove inherited content that contradicts the HTML.** When cloning a parent artboard, strip any leftover toasts, modals, or other overlay content that the HTML does not show in that state. Add only the overlays the HTML specifies.

---

## Scaffolding pattern — auto-layout

Build every screen artboard as a **nested vertical auto-layout stack** (Tab bar → Title → body → optional Footer). Overlays escape the flow via `layoutPositioning='ABSOLUTE'`.

**Why:** layout intent is declarative, not computed. Auto-layout handles centering, sizing, and reflow for you — eliminating per-child position math and the "visible content vs. box bounds" debates that haunted the earlier System states rules.

### Standard band hierarchy

```
Artboard 1120×680 (VERTICAL, FIXED W & H, no padding, no gap)
├── Tab bar       — HORIZONTAL, FILL W, FIXED H=48, hairline-bottom-stroke
│   └── Tab cell  — VERTICAL,  HUG  W, FIXED H=48, padding 0/24/0/24,
│                   primaryAlign=CENTER, counterAlign=CENTER
│       └── Text  — HUG W, HUG H
├── Title         — VERTICAL, FILL W, HUG H, gap 8, padding 24/24/0/24
│   ├── h1 text   — FILL W, HUG H
│   └── subtitle  — FILL W, HUG H
├── body          — VERTICAL, FILL W, FILL H (layoutGrow=1),
│                   gap 16, padding 24/24/24/24,
│                   primaryAlign / counterAlign depend on state
│                   (CENTER for system-state screens, MIN for content screens)
│   └── (state-specific content)
└── Footer        — HORIZONTAL, FILL W, HUG H, gap 12, padding 24/24/24/24,
                    primaryAlign=MAX (right-anchored) or SPACE_BETWEEN (3-button)
                    — only when state has CTAs
```

### Rules

1. **Top-level artboard is `VERTICAL` auto-layout.** No padding (bands handle their own); no gap (bands butt up; hairlines are 1px strokes or rects inside bands).

2. **Set sizing explicitly on every child.** Never rely on defaults:
   ```js
   child.layoutSizingHorizontal = 'FILL';  // or 'HUG' / 'FIXED'
   child.layoutSizingVertical   = 'FILL';
   child.layoutGrow             = 1;       // on body, to consume leftover height
   ```

3. **`body` is the FILL band — auto-layout centers content for you.**
   ```js
   body.layoutMode = 'VERTICAL';
   body.layoutSizingHorizontal = 'FILL';
   body.layoutSizingVertical   = 'FILL';
   body.layoutGrow = 1;
   body.primaryAxisAlignItems  = 'CENTER';  // for system-state screens
   body.counterAxisAlignItems  = 'CENTER';
   ```
   Drop the System states instance into `body` — **no centering math required**. This replaces all the previous System states centering rules.

4. **Overlays escape the flow with absolute positioning.**
   ```js
   closeBtn.layoutPositioning = 'ABSOLUTE';
   closeBtn.x = parent.width - 24 - closeBtn.width;
   closeBtn.y = 12;
   ```
   Apply to: tab bar's close (×), Toast, Modal backdrop + panel, dev panel chrome — anything that overlays rather than stacks.

5. **DS components are already auto-layout-ready.** Drop them in unmodified — the master owns its internal layout (e.g., the Toast's title + action frames). Don't override; if the master is wrong, fix the master.

6. **Tab cells let text drive width.** Each tab cell uses `HUG` horizontal sizing with `paddingLeft/Right=24`, so longer labels widen the cell automatically. No hard-coded x positions per tab.

### When NOT to use auto-layout

- **Inside DS component instances.** Override = drift from the master. Edit the master instead.
- **For artboard-level overlays** (modal backdrop, modal panel, toast, dev panel). Their internal content can still be auto-layout — but their placement on the artboard uses `layoutPositioning='ABSOLUTE'`.
- **For chart canvases or data tables with fixed intrinsic dimensions.** Wrap them in a FIXED-sized cell that participates in the auto-layout flow as a single block.

---

## Icons — search the DS first, never fall back to text glyphs

Before drawing any icon-shaped UI element (close ×, check ✓, plus +, back chevron ‹, forward chevron ›, trash 🗑, alert ⚠), **search the connected DS libraries** for a matching component instance. Use the actual DS instance — not a Unicode character, emoji, or hand-drawn vector.

**Rationale:** Unicode glyphs and emoji render inconsistently across fonts and platforms, don't honor design tokens, and break visual consistency with the rest of the DS. Every DS component you've already imported (Button, Modal, Toast) was authored against the icon set; using a text `×` next to a DS Toast that contains a real `Icon_Close_large` instance produces visible drift.

**Workflow:**
1. List subscribed libraries (`get_libraries` MCP call) to confirm which DS your file is connected to.
2. Search the DS (`search_design_system`) for the icon by name — try the obvious term ("close", "check"), then the symbol if the name search fails.
3. Inspect the matched component set's variants — most DS icon sets use a single component set with `type=…, size=…` variants.
4. Import via `figma.importComponentSetByKeyAsync(key)`, find the variant, call `.createInstance()`, position it where you would have placed the text glyph, and remove the text.

**Glyph → variant mapping for HiNAS DS / "General":**
| Glyph in HTML / placeholder | DS variant |
|---|---|
| `×` (close) | `type=x, size=24` |
| `✓` (check / selected) | `type=check, size=24` |
| `+` (add) | `type=+, size=24` |
| `‹` (back / left chevron) | `type=chevron - <, size=24` |
| `›` (forward / right chevron) | `type=chevron - >, size=24` |
| `🗑` (delete) | `type=trash-delete, size=24` |
| `⚠` (alert / warning) | `type=alert - triangle, size=24` |

**Recoloring:** General icons are vectors with strokes. To match a target color (e.g. `text-muted` for an inactive close button), walk the instance's descendants for `VECTOR` nodes and set their `strokes` (or `fills` if the icon is filled rather than stroked):
```js
function recolorIcon(inst, hex) {
  const color = hex2rgb(hex);
  inst.findAll(n => n.type === 'VECTOR').forEach(v => {
    if (v.strokes && v.strokes.length) v.strokes = [{type:'SOLID', color}];
    if (v.fills   && v.fills.length)   v.fills   = [{type:'SOLID', color}];
  });
}
```

**Centering inside a button frame:** the icon is 24×24 and most icon-button containers are 32×32 — so center with 4px padding each side: `icon.x = (container.width - 24)/2`, `icon.y = (container.height - 24)/2`.

**Don't pre-emptively skip the search.** Even simple-looking glyphs ("+", "✓") have DS variants. Searching takes one tool call and prevents the kind of systematic drift that we discovered after-the-fact in the first CCP migration.

---

## DS sync — check for updates each migration

Before formatting imported HTML, sample the Design system and compare against the last known state. **Always surface the sync result to the user, even when nothing has changed.** Never skip the check or run it silently — the user should see that the verification happened on every run.

### Flow

1. **Sample the DS** — list every `COMPONENT` / `COMPONENT_SET` on the `Design system` page (name, key, variant names). This requires `setCurrentPageAsync` to that page; restore `Claude output` (or whichever working page) when done.
2. **Compare to the last sample** stored at `.claude/ds-manifest.json` (project-local).
3. **Always print the sync result** to the user as the first thing in the run:
   - **Changed:** list every diff (added / removed / renamed sets and variants), then ask:
     > *"DS has changed since last migration: {summary}. Use the most recent version?"*
   - **Unchanged:** print
     > *"DS sync — no changes since {lastSyncedAt}. Proceeding with current manifest."*
4. **On user yes** (changed case) — refresh `.claude/ds-manifest.json` and use the latest.
   **On user no** — proceed with the previous manifest (warn if a referenced component is no longer present).

### Manifest shape

A small JSON file at `.claude/ds-manifest.json`:

```json
{
  "lastSyncedAt": "2026-05-07T...",
  "sets": [
    { "name": "Button", "key": "...", "variants": ["...", "..."] },
    { "name": "Modal",  "key": "...", "variants": ["...", "..."] }
  ]
}
```

---

## Scope — ask before bulk operations

Before applying any workflow that affects multiple artboards (auto-layout rebuild, retrofit pass, mass icon swap, mass DS-component swap, etc.), **ask the user to confirm the scope** in plain language:

> *"Apply this to **all pages** of this migration, or only the **targeted pages** that are currently broken / asked about? — full pages vs. targeted pages?"*

Wait for the user's call before proceeding. Don't infer scope from the immediate problem.

**Why this rule exists:** the natural tendency is to scope a fix narrowly to the artboard the user just pointed at. But rules in this file (auto-layout scaffolding, DS-instance usage, icon-from-DS) are universal — they apply to every screen, not just the broken ones. Skipping scope confirmation produces half-applied rules across the migration, which gets re-discovered later as gaps.

**When this rule fires (non-exhaustive):**
- Rebuilding artboards under a new structural rule (auto-layout, sizing scheme).
- Replacing a UI primitive across artboards (icon class, input style, modal master).
- Retrofitting layout adjustments after a DS update.
- Re-applying any rule that didn't exist when an artboard was originally built.

If the user picks "targeted pages," surface what's left untouched in your summary and offer to extend later — don't pretend the work is done file-wide.

---

## DS conflicts — ask before patching

When a DS component, variant, or token doesn't render correctly in the working context (wrong color, missing slot, light-theme master in a dark-theme file, etc.), **stop and surface the mismatch to the user** before applying any local override.

Do **not** silently fix the symptom with an instance-level override (e.g. setting `inst.fills` to a hard-coded color). That creates *instance drift* from the master, hides the underlying issue, and makes future DS updates painful to reconcile.

**Workflow:**
1. Detect the mismatch (e.g. modal master rendering with light fill in a dark file).
2. Pause the migration.
3. Report to the user with the specifics:
   > *"`Modal/type=input field` master is rendering with a light-mode fill (`#FFFFFF`-ish) in this artboard. The rest of the design is dark-themed. Likely cause: this page doesn't have the DS's color-theme variable mode set, or the master's bound variable doesn't have a dark mode value. Options: (a) set the page's variable mode to the DS's dark mode, (b) request a dark-mode variant from the DS team, (c) accept an instance fill override here. Which do you want?"*
4. Wait for the user's call. Do not pick a default.

**Why this rule exists:** silent patches violate the *"DS is the source of truth"* principle, and they often reveal misconfigured variable modes or missing tokens that should be raised, not papered over.

---

## Self-test when this file is updated

Whenever a rule in this file changes, build a focused test artboard so the user can review the new behavior before it ships in a full migration.

**When to trigger:**
- Immediately after Claude edits this file in a session — *but only for **visual rules***.
- On the next `/figma-migrate` invocation, if this file has been modified since the most recent dated test section in the target Figma file (e.g., its mtime is newer than the latest `figma-migrate test — …` section's date) — same caveat: visual rules only.

**Visual rule vs. process rule (decides whether to ask):**
| Kind | Definition | Example | Trigger a test? |
|---|---|---|---|
| **Visual** | Changes what an artboard *looks like* — positions, sizes, formulas, text, layout | "center System states with `inst.y = (H − inst.height) / 2`" | **Yes** — ask the user. |
| **Process** | Changes *how Claude writes the code or runs the workflow*; a correctly-built artboard looks the same either way | "after `section.appendChild(frame)`, re-set `.x` / `.y` to section-local coords" | **No** — note in commit/summary; do not ask. Asking would build a test artboard identical to existing ones, which is theater, not verification. |

When in doubt, ask: *"would the artboard look different if I followed the new rule vs. the old one?"* If yes, visual. If no, process.

**Flow:**
1. Ask the user: *"I updated the **{rule}** rule — want me to build a test artboard so you can review the new behavior?"*
2. If yes, ask which Figma file URL to drop the test into.
3. Resolve the HTML input: reuse the **most recently migrated HTML** in this project. Do **not** ask the user for a new HTML file unless they offer one.
4. Process **only the slice** affected by the rule, in full-screen-artboard form with surrounding context (tabs, header, etc.) — never the whole HTML.
5. Drop the result into a section named:
   ```
   figma-migrate test — {YYYY-MM-DD} — {rule}
   ```
6. One test artboard per rule edited. If a single edit touches multiple rules, the section contains one artboard per rule.

**Scope rules:**
- **Slice, not full migration.** Example: an edit to the System states centering block produces only a Loading-state artboard (or Empty / Error if those better exercise the change) — not the full 17-artboard set.
- **In context, not isolated.** The test artboard is a real screen artboard with tabs, header, and the affected element placed by the new rule — so the rule's effect is visually verifiable. Not a bare instance on a blank frame.
- **Reuse the last HTML.** The previously migrated HTML is the source so the user can visually diff the test artboard against the corresponding artboard from the prior migration.
- **Additive only.** Do not modify or delete any existing artboards. The dated test section is throwaway — the user deletes it after signing off.

**Section coords gotcha (when wrapping artboards in a Section):**
Children of a `SECTION` use **section-local coordinates** — the same way frames work, NOT page-absolute coords. If you build artboards as page-level frames first (at absolute coords like `y=6800`) and then `section.appendChild(frame)`, Figma keeps the frame's `.x` / `.y` values verbatim but now interprets them as local offsets from the section's top-left — landing the children far outside the section's visible bounds. Two safe patterns:
- **(a) Build with section-local coords from the start.** Set `frame.x = PAD + i * STRIDE`, `frame.y = PAD` *after* `section.appendChild(frame)`.
- **(b) Append first, then re-set coords.** `section.appendChild(frame)`, then `frame.x = …`, `frame.y = …` using section-local values.
Verify with `frame.absoluteBoundingBox` — if it doesn't land where you expect on the canvas, you've mixed coordinate spaces.

---

## Step 1 — Pre-flight: read and parse the HTML

Read the target HTML file and extract:

- All **states** rendered per page (e.g. loading, empty, populated, dirty, saving, error)
- All **visible text** per state: titles, body copy, button labels, toast messages, error messages
- Which **DS components** are used: System states, Toast, Button, Modal
- Any **conditional visibility**: elements shown/hidden per state

```js
// Grep for state render functions to capture all text per state
// e.g. renderLoadingPage(), renderEmptyPage(), renderListPage()
```

---

## Step 2 — Inspect the master component before touching instances

**Always inspect the master component layer tree first**, including hidden layers.
This reveals every child that may be visibility-toggled in instances.

```js
function collectLayers(node, depth = 0) {
  const row = {
    depth,
    name: node.name,
    type: node.type,
    visible: node.visible,
    chars: node.type === 'TEXT' ? node.characters : undefined,
    w: Math.round(node.width),
    h: Math.round(node.height),
  };
  const rows = [row];
  if ('children' in node) {
    for (const c of node.children) rows.push(...collectLayers(c, depth + 1));
  }
  return rows;
}

// Import the component set and inspect the target variant
const set = await figma.importComponentSetByKeyAsync('<componentKey>');
const comp = set.children.find(c => c.name === 'type=<VariantName>');
return JSON.stringify(collectLayers(comp), null, 2);
```

Key things to note from the master:
- Which depth-1 children exist (icon, text group, button, etc.)
- Which are `visible: false` by default in the master
- What the default text is for each TEXT node (you'll need the exact string to target overrides)

---

## Step 3 — Create a fresh instance (never reuse a modified one)

If an instance was previously modified or recreated outside of a full reset, remove it and create fresh.
A stale instance may be missing children that exist in the master.

```js
// Remove old instance
const old = frame.children.find(c => c.type === 'INSTANCE' && c.name === 'System states');
if (old) old.remove();

// Create fresh from master component
const set = await figma.importComponentSetByKeyAsync('<componentKey>');
const comp = set.children.find(c => c.name === 'type=<VariantName>');
const inst = comp.createInstance();
frame.appendChild(inst);
```

---

## Step 4 — Toggle child visibility to match the HTML

Compare the master layer tree against the HTML state. Toggle `visible` on instance children to match.
Do **not** add separate frame-level components for things that already exist inside the DS component.

```js
// Hide a child by name (e.g. icon frame)
const iconFrame = inst.children.find(c =>
  'children' in c && c.children.some(cc => cc.name === 'Icon_Route')
);
if (iconFrame) iconFrame.visible = false;

// Show a child that is hidden in the master (e.g. internal Button)
const internalBtn = inst.children.find(c => c.name === 'Button');
if (internalBtn) internalBtn.visible = true;
```

Rule: if the HTML shows a UI element, make the matching DS layer visible. If the HTML omits it, hide it.
Never add a separate component instance to the frame when the DS component already contains that element.

---

## Step 5 — Apply text overrides

Target text nodes by their **current character content** (not by layer name, which can be generic).
Always call `figma.loadFontAsync` before writing.

```js
function findTextByChars(node, chars) {
  if (node.type === 'TEXT' && node.characters === chars) return node;
  if ('children' in node) {
    for (const c of node.children) {
      const found = findTextByChars(c, chars);
      if (found) return found;
    }
  }
  return null;
}

async function setText(root, oldChars, newChars) {
  const t = findTextByChars(root, oldChars);
  if (!t) return `NOT FOUND: "${oldChars}"`;
  await figma.loadFontAsync(t.fontName);
  t.characters = newChars;
  return `OK: "${oldChars}" → "${newChars}"`;
}

// Usage
results.push(await setText(inst, 'Place holding text', 'No profile ID is found'));
```

---

## Step 6 — Apply positioning rules

These rules apply **after** the auto-layout scaffolding from the "Scaffolding pattern — auto-layout" section is in place. Follow `HiNAS Control Design spec.md` for spec values.

**System states** (Loading / Empty / Error) — handled by the `body` band:
- Drop the instance into `body` as a child. Do **not** set `inst.x` / `inst.y`.
- The `body` band's `primaryAxisAlignItems='CENTER'` + `counterAxisAlignItems='CENTER'` centers the instance within whatever vertical space is left after the Tab bar and Title bands.
- This replaces the old centering math entirely — no `(H − inst.height) / 2`, no manual offsets, no "visible content vs. box bounds" debate.

**Toast** (artboard overlay — absolute positioning):
```js
// Toast is a sibling of the auto-layout bands at the artboard's top level,
// but escapes the vertical flow via layoutPositioning='ABSOLUTE'.
toast.layoutPositioning = 'ABSOLUTE';
toast.x = (artboard.width  - toast.width)  / 2;
toast.y =  artboard.height - toast.height - 24;
```

Rules:
- The `24` is the spec'd bottom margin — do not change it and do not stack additional `± Npx` offsets.
- Do not visible-content-center; use the instance's reported `width` / `height` as-is.
- If the toast looks misaligned, the fix is in the master component (or a different variant) — not in the instance placement.

**Footer CTAs** (auto-layout band — *not* absolute):
```js
const footer = figma.createFrame();
footer.name = 'Footer';
footer.layoutMode = 'HORIZONTAL';
footer.itemSpacing = 12;                          // 12px gap between buttons
footer.paddingLeft  = footer.paddingRight  = 24;  // 24px side margins
footer.paddingTop   = footer.paddingBottom = 24;  // 24px top + bottom margins
footer.primaryAxisAlignItems = 'MAX';             // right-anchored chain
footer.counterAxisAlignItems = 'CENTER';
artboard.appendChild(footer);
footer.layoutSizingHorizontal = 'FILL';
footer.layoutSizingVertical   = 'HUG';

// Append in left-to-right visual order. With primaryAlign='MAX' they push to the right;
// the rightmost is the last appended.
footer.appendChild(secondaryBtn);  // e.g. Close / Cancel
footer.appendChild(primaryBtn);    // e.g. Save / Select
```

For 3-button **spread** layouts (e.g. Unsaved Changes: Discard | Cancel + Save):
```js
footer.primaryAxisAlignItems = 'SPACE_BETWEEN';
footer.appendChild(discardBtn);

const rightCluster = figma.createFrame();
rightCluster.layoutMode = 'HORIZONTAL';
rightCluster.itemSpacing = 8;
rightCluster.layoutSizingHorizontal = 'HUG';
rightCluster.layoutSizingVertical   = 'HUG';
footer.appendChild(rightCluster);
rightCluster.appendChild(cancelBtn);
rightCluster.appendChild(saveBtn);
```

Rules:
- The numeric values `24` (margins), `12` (gap), `48` (button height from DS) come from the design spec — do not change them and do not stack additional `± Npx` offsets.
- Append children in **visual left-to-right order**. With `primaryAlign='MAX'` they push right; with `'SPACE_BETWEEN'` the first goes left, the last goes right.
- Do not compute per-button x positions manually (the old `rightEdge - .width` chain). The auto-layout `itemSpacing` and `primaryAlign` handle it — and the cluster reflows correctly when labels change.
- Do not measure each button's visible glyph bounds and re-anchor on those.
- If the cluster looks misaligned, the fix is in the button master or label text — not in placement code.

---

## Step 7 — Verify

Re-inspect the live instance to confirm the layer tree matches intent.

```js
// Re-run collectLayers on the instance and check:
// - correct children visible/hidden
// - correct text characters
// - no leftover external instances at frame level that duplicate DS component internals
const tree = collectLayers(inst);
return JSON.stringify(tree, null, 2);
```

Also check frame.children for any stale external instances (Button, Toast, etc.)
that should instead be internal to a DS component.

---

## DS Component Keys

### Control DS — Claude x Figma

| Component | Key |
|---|---|
| Button | `7c92ef0f897733a3d7404896249e5e87d3cb90ae` |
| Modal | `62cf4b4cf7ca1f217b6f11f1aa333f23a5019e14` |
| Toast | `126b94d2d5cf246c6deef2ad44c8ae5d6aaa179c` |
| System states | `8c2a8ec7fa065c3350a34754dd2dd2060260aeed` |

### HiNAS Design System

| Component | Key | Variants |
|---|---|---|
| General (icons) | `52e47bfd646912389f112962f9e098c9c565f213` | `type=check, size=24` · `type=x, size=24` · `type=+, size=24` · `type=trash-delete, size=24` · `type=chevron - <, size=24` · `type=chevron - >, size=24` · `type=alert - triangle, size=24` |

## Artboard naming

```
Setting {depth} — {Screen name} ({State})
```

e.g. `Setting 1 — Empty`, `Setting 2 - Edit (Dirty)`
