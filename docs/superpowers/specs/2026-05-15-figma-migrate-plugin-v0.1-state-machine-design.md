# Figma-migrate plugin v0.1 — state machine, gap closures, and DS library/manual-match features

_Author: drafted by Claude in brainstorming session · 2026-05-15_
_Companion to: `figma-migrate-plugin-mvp-spec.md` (overall MVP scope), `.claude/commands/figma-migrate.md` (canonical workflow rules)._

---

## TL;DR

The plugin at `plugin/` is 80% wired already — the happy path 01→02→03→04→05 round-trips parse → DS-sync → coverage review → build → done. This design closes the remaining v0.1 gaps and adds three meaningful new capabilities that the original MVP spec deferred to v0.4.

**Scope of this design:**

1. **Close six wiring gaps** in the existing 11-screen UI: visible parse errors, parser-derived DS Candidates (no more hard-coded mockup data), working build cancel, build error retry path, DS sync as a hard gate on Build, and removal of the stale Done-screen Suggestions placeholder.
2. **Source the DS from a linked team library** (new Screen L) instead of requiring a `Design system` page in the same file. This was originally spec §4.6 v0.4 work; it's promoted here because a library-based DS is the realistic deployment shape.
3. **Map `data-ds-candidate` HTML elements to real DS components** (new Screen M). Replaces the placeholder candidate frames the slash command produces with user-picked DS instances.
4. **Manual rescue match for parser misses** (new Screen N). A two-field flow ("Select from HTML" + "Select from DS") that catches HTML elements the parser doesn't recognize and pairs them with DS components selected on the Figma canvas. Output lands in a new "Matched elements" band alongside DS Candidates.

**Explicitly NOT in scope:** DS conflict gate (Screen 06 dead UI stays dead), resume after panel close, inline placement of manual matches inside state artboards, per-file mapping isolation, multi-library merge, v0.2 Claude judgment-step automation.

---

## 1. Architecture

### 1.1 Screens

The eleven existing screens stay structurally as-is. Three new screens get inserted into the back-stack:

| ID | Title | Purpose | Entry |
|---|---|---|---|
| **L** | Choose DS library | List libraries from `getAvailableLibrariesAsync()`; user picks one; persisted in `clientStorage.dsLibrary` | First-run when no library configured, OR clicking the DS source chip on Screen 02 |
| **M** | Pick DS component for candidate | Searchable list of components from the chosen library, scoped to one candidate row | Per-candidate "Pick DS component" button on Screen 03 |
| **N** | Manual match — parser miss rescue | Two-field flow ([Select from HTML] + [Select from DS]) + HTML iframe + [Match complete] CTA | New "Manual matches" section on Screen 03 with `+ Add match` |

All three follow the existing `navigateTo` / `goBack` / `backStack` pattern in [ui.html:2693-2727](../../../plugin/ui.html#L2693-L2727).

### 1.2 DS source becomes dynamic

`dsSync()` in code.js stops requiring an in-file `Design system` page. Read order:

1. Read `clientStorage.dsLibrary`. If set, call `getAvailableLibrariesAsync()`, find the chosen library by key, enumerate its components, diff vs stored, return success.
2. If no library is configured, return `{ok: false, error: 'No DS library configured', needsLibrary: true}`. UI shows banner on Screen 02 prompting to open Screen L.
3. **Legacy fallback:** if no library is configured AND a `Design system` page exists in the current file, use the existing in-file flow (kept for the canonical Control DS file, not required elsewhere).

### 1.3 Build pipeline changes

The build pipeline gains one new output band and one routing change:

- **Candidate elements** (new code path — current pipeline does not yet emit a Candidates band; the slash command does). The build pipeline must consume the new `candidates` array on the `build` payload. For each candidate, if `clientStorage.candidateMappings[name]` exists, call `importComponentByKeyAsync(mapping.componentKey)` and instantiate that component as the artboard's body. If no mapping exists, create a labeled empty frame as a placeholder (matching the slash command's DS Candidates band behavior).
- **Matched elements band** (new): one new band after `DS Candidates`. One artboard per entry in `clientStorage.manualMatches`, named `Match — {componentName}`. Each artboard instantiates the user-picked DS component and applies text overrides from the matched HTML element's text content.
- Cancel works the same way for both new bands — `_cancelRequested` flag checked at each artboard boundary.

### 1.4 Storage

Three new keys on `figma.clientStorage`:

| Key | Shape | Lifecycle |
|---|---|---|
| `dsLibrary` | `{ key, name, lastSyncedAt, components: [{name, key, variants}] }` | Set on Screen L. Re-synced on Screen 02 banner refresh. |
| `candidateMappings` | `{ [candidateName]: { componentKey, componentName, variantName? } }` | Appended on Screen M [Match this component]. Read by build pipeline. |
| `manualMatches` | `[{ htmlSelector, htmlText, componentKey, componentName, variantName?, capturedAt }]` | Appended on Screen N [Match complete]. Read by build pipeline. Cap at 50 entries per file. |

### 1.5 Panel resize for Screen N

Screen N's HTML iframe needs more vertical room than 380×800 allows. Entering Screen N posts `resize-ui` to 800×900. Exit resets to 380×800. Same `figma.ui.resize` mechanism already used by the DS Candidate picker overlay in [ui.html:3712-3722](../../../plugin/ui.html#L3712-L3722).

---

## 2. Per-feature implementation design

### 2.1 Shared error helper (foundation)

New helper in ui.html script:

```
renderInlineError(screenCell, kind, message, actions)
```

- `screenCell` — DOM ref to a `.strip__cell`
- `kind` — `'parse' | 'ds-sync' | 'build' | 'library' | 'match'`
- `message` — string shown in banner body
- `actions` — array of `{label, onClick}` rendered as primary/secondary buttons

Mounts at the top of the target screen's `panel__body`. Reuses existing `.banner--error` / `.banner--warning` CSS. Auto-clears when `showScreen` navigates away (hook the cleanup into `showScreen`).

All five new/changed error paths route through this helper: parse error, DS sync gate, build error, library load error, manual match validation error.

### 2.2 Gap closures

**Gap 1 — Parse error UI** ([ui.html:3591](../../../plugin/ui.html#L3591)). Replace `console.error` with `renderInlineError(cells[0], 'parse', msg.error, [{label: 'Try again', onClick: dismiss}])`. Textarea content preserved so user can edit and retry.

**Gap 3 — DS Candidates derived from parser** ([code.js:148](../../../plugin/code.js#L148)). Extend `parseHtml` to scan for `data-ds-candidate="..."` attributes, dedupe, return as `candidates: [{name, htmlText?}]`. In ui.html, replace the hard-coded mockup `<li>` at [ui.html:1603-1611](../../../plugin/ui.html#L1603-L1611) with dynamic rendering from `msg.data.candidates`. Empty state shown if zero candidates.

**Gap 4 — Build cancel.**
- code.js: module-level `var _cancelRequested = false;`, reset at the start of each `buildArtboards` call, checked at each iteration in the main loop. On detection, post `build-result` with `{cancelled: true, counts: {…partial}}` and return.
- code.js: new `case "cancel":` in `figma.ui.onmessage` that sets the flag.
- ui.html: Screen 04 Cancel button (today calls `goBack`) posts `cancel`, waits for `build-result.cancelled`, then transitions to Screen 05 with "Cancelled — N of M built" in the Done title.

**Gap 5 — Build error retry.** `showBuildError` switches to using `renderInlineError(cells[3], 'build', err, [{label: 'Try again', onClick: repost}, {label: 'Back to coverage', onClick: goBack}])`. Cache `lastBuildPayload` in ui.html so Try again re-posts the identical payload.

**Gap 6 — DS sync gate (soft warning + hard gate on Build).**
- When `sync.ok === false`: Screen 02 shows a warning banner via `renderInlineError(cells[1], 'ds-sync', err, [{label: 'Choose library', onClick: () => navigateTo(L)}])`. User can still navigate forward to Screen 03 to review parse output.
- Screen 03 Build button stays **disabled** until `sync.ok === true`. Same banner repeated on Screen 03.

**Gap 7 — Done count placeholder.** [ui.html:3360](../../../plugin/ui.html#L3360). Remove the placeholder "0 Suggestions" list item entirely — defer until v0.2 implements suggestions.

### 2.3 Library import — Screen L

**Markup.** New 12th `.strip__cell` in ui.html. Topbar: "Choose DS library" + Back. Body: list rendered from `libraries-list` message, each row = library name + last-modified timestamp, single-select with blue outline. Footer: Cancel + "Use this library" (enabled when one selected).

**code.js `dsSync` rewrite** — see §1.2 above.

**New message handlers (code.js):**
- `list-libraries` → posts `libraries-list` with `{libraries: [{key, name, lastModified}]}`
- `select-library` → persists `{key, name}` to clientStorage, runs `dsSync()`, posts `library-set` with fresh sync result
- `list-library-components` → posts `library-components-list` with `{components: [{key, name, variants}]}` (used by Screen M)

**First-run flow.** Parse runs unconditionally regardless of library state. `parse-result.sync.needsLibrary === true` → Screen 02 banner prompts user to open Screen L. After library selected, banner refreshes green via `library-set`, Build button enables on Screen 03.

### 2.4 Candidate matching — Screen M

**Markup.** Topbar: "Pick DS component for {candidate name}" + Back. Body: search input at top + scrollable component list (rendered from `library-components-list`). Each row: component name + variant count, click to select. Footer: Cancel + "Match this component" (enabled when one selected).

**Screen 03 changes.** Each candidate row gets a sibling `Pick DS component` button next to the existing `Pick element`. Both coexist:
- `Pick element` — captures HTML preview (existing flow)
- `Pick DS component` — `navigateTo(M)` with `currentCandidate = name` in cross-screen state. On Screen M return, row updates to show "→ Button/size=36/style=primary" + ✓, persisted in `clientStorage.candidateMappings[name]`.

**Build pipeline change in `buildArtboards`.** Process the `candidates` array from the `build` payload (new code path — see §1.3). For each candidate: if `candidateMappings[name]` exists, call `importComponentByKeyAsync(mapping.componentKey)`, instantiate, apply text overrides from `htmlText` (if captured by Pick element). If absent, create a labeled empty frame as the placeholder.

### 2.5 Manual rescue match — Screen N

**Markup.** Topbar: "Manual match — for parser misses" + Back. Body grid:
- Top row: two field rows side-by-side
  - `[Select from HTML]` — empty state "Click an element below"; filled state shows tag + classes + text snippet
  - `[Select from DS]` — empty state "Select a component in Figma"; filled state shows component name + parent variant name; small "Browse library instead" link
- Bottom row: HTML iframe (`srcdoc = lastHtmlSource`)
- Footer: Cancel + `[Match complete]` (enabled when both fields filled)

**Panel resize.** Entering Screen N posts `resize-ui` to 800×900. Exit resets to 380×800.

**HTML iframe wiring.** Reuse the picker-injection pattern from [ui.html:3163-3217](../../../plugin/ui.html#L3163-L3217) — hover outline, click highlight, capture selection. Difference from the existing picker: click updates `[Select from HTML]` field live (no separate Capture button). Captures: element CSS selector path + text content.

**Selection listener (code.js):**
- Module-level `var _selectionListenerActive = false;`
- `start-selection-listener` → set flag true, register `figma.on("selectionchange", postSelectionUpdate)`, call `postSelectionUpdate()` immediately for initial state.
- `stop-selection-listener` → set flag false, deregister via `figma.off`.
- `postSelectionUpdate()` posts `selection-update` when current selection is exactly one COMPONENT or INSTANCE (INSTANCE resolved to its `mainComponent`). Payload: `{component: {key, name, parentName} | null}`. UI starts the listener on Screen N enter, stops on exit AND on plugin close.

**Browse-library fallback.** "Browse library instead" link → `navigateTo(M)` with `returnTarget: 'manual-match'` in cross-screen state. Screen M's "Match this component" updates Screen N's `[Select from DS]` field instead of registering as a candidate mapping.

**Storage.** `clientStorage.manualMatches` is an array, appended on each `[Match complete]`. Entry shape: `{htmlSelector, htmlText, componentKey, componentName, variantName?, capturedAt}`. Capped at 50 entries per file.

**Screen 03 list section.** New "Manual matches" section below DS Candidates. Each entry rendered with HTML element preview + DS component name + × Remove button. `+ Add match` CTA at bottom → `navigateTo(N)`.

**Build pipeline.** New band "Matched elements — manually mapped" after the DS Candidates band. One artboard per entry, named `Match — {componentName}`, instantiates the DS component, applies text overrides from `htmlText`. Counted separately in `build-complete.counts.manualMatches`. Done screen list gains a line for "Matched elements: N".

---

## 3. Validation, message contract, risks

### 3.1 Testing approach

No automated test framework exists in `plugin/` today. The plugin is loaded in Figma desktop via "Import plugin from manifest" and exercised by hand. v0.1 keeps that — automated testing is out of scope, but each feature gets a defined manual test path.

| Feature | Test path | Pass criterion |
|---|---|---|
| Gap 1 (parse error) | Paste malformed HTML (no `case '...':` blocks). Click Parse HTML. | Banner appears on Screen 01 with error + Try again. Console is no longer the only signal. |
| Gap 3 (candidates from parser) | Paste HTML with two `data-ds-candidate="X"` annotations. | Screen 03 lists exactly those two candidates, in source order, no mockup data. |
| Gap 4 (cancel) | Start a build that produces ≥5 artboards. Click Cancel after ~2 complete. | Build halts within ≤1 artboard of the click. Partial band remains on canvas. Done screen reads "Cancelled — 2 of N built". |
| Gap 5 (build retry) | Force a build error (e.g. provide a parsed payload missing required fields). | Error banner on Screen 04 with Try again + Back to coverage. Try again re-runs build with cached payload. |
| Gap 6 (DS sync gate) | Open plugin in a file with no library and no `Design system` page. | Parse succeeds. Screen 02 banner says "No DS library configured" + Choose library button. Screen 03 Build button disabled until library chosen. |
| Library import (Screen L) | Choose a linked team library from the list. Re-open plugin in same file. | Library persists. Subsequent runs use it without prompting. |
| Candidate matching (Screen M) | Pick a DS component for a candidate. Return to Screen 03. | Candidate row shows the matched component name + ✓. Build pipeline instantiates the real component in the Candidates band. |
| Manual rescue (Screen N) | Click HTML element in iframe → field 1 fills. Select component on Figma canvas → field 2 fills. Match complete. | Manual match appears on Screen 03's new Manual matches section. Build pipeline produces a `Match — {componentName}` artboard in the new band. |

**Smoke regression** — every change must still produce a working `Setting - CCP - Loading` artboard from `Control/cpp-setting-tab-mockup.html`. That's the golden-path canary.

### 3.2 Byte-equivalence with the slash command (spec §6 revisited)

Spec §6's v0.1 validation gate said: "byte-equivalent output to the slash command for `Control/cpp-setting-tab-mockup.html`." That goal stays valid for the **unchanged build pipeline** (states, modals, toasts, DS Candidates band header).

The new features (library import, candidate matching, manual matches) **break strict byte-equivalence by design** — the slash command has no equivalent for user-picked DS components or manual matches. The narrowed claim:

- **In scope of equivalence:** state artboards, modal artboards, toast artboards, DS Candidates band header — these must remain byte-equivalent when the candidate list is the same as today's CCP run AND no user mappings are set.
- **Out of scope of equivalence:** anything in the new "Matched elements" band, anything in the DS Candidates band when user mappings are set (those produce real DS instances vs the slash command's empty placeholders), the new "Manual matches" Screen 03 section.

### 3.3 Full message contract

Plugin sandbox (`code.js`) ↔ UI (`ui.html`) — final shape after this work:

| Direction | Type | Payload | Response |
|---|---|---|---|
| UI → code | `parse-html` | `{html}` | `parse-result` |
| code → UI | `parse-result` | `{ok, data, sync, variantSuggestions, variantLists, error?}` | — |
| UI → code | `ds-sync` | — | `ds-sync-result` |
| code → UI | `ds-sync-result` | `{sync}` | — |
| UI → code | `build` | `{parsed, filename, candidates, variantChoices, candidateMappings, manualMatches}` | streams `progress` then `build-complete` / `build-result` |
| code → UI | `progress` | `{phase: 'start'\|'building', index, total, name, section?}` | — |
| code → UI | `build-complete` | `{counts: {states, modals, toasts, candidates, manualMatches, warnings}}` | — |
| code → UI | `build-result` | `{ok, cancelled?, error?, counts?}` | — |
| UI → code | `cancel` | — | (flag set; build emits `build-result.cancelled`) |
| UI → code | `view-on-canvas` | — | (none) |
| UI → code | `list-pages` | — | `pages-list` |
| UI → code | `set-target-page` | `{pageName}` | `target-set` |
| UI → code | `create-page` | `{name}` | `pages-list` |
| UI → code | `resize-ui` | `{width, height}` | (none) |
| UI → code | `close` | — | (none) |
| UI → code | `list-libraries` | — | `libraries-list` |
| code → UI | `libraries-list` | `{libraries: [{key, name, lastModified}]}` | — |
| UI → code | `select-library` | `{key, name}` | `library-set` |
| code → UI | `library-set` | `{sync}` | — |
| UI → code | `list-library-components` | — | `library-components-list` |
| code → UI | `library-components-list` | `{components: [{key, name, variants}]}` | — |
| UI → code | `register-candidate-mapping` | `{candidateName, componentKey, componentName, variantName?}` | `mapping-set` |
| code → UI | `mapping-set` | `{candidateName}` | — |
| UI → code | `start-selection-listener` | — | (selection-update stream) |
| UI → code | `stop-selection-listener` | — | (none) |
| code → UI | `selection-update` | `{component: {key, name, parentName} \| null}` | — |
| UI → code | `register-manual-match` | `{htmlSelector, htmlText, componentKey, componentName, variantName?}` | `match-set` |
| code → UI | `match-set` | `{index}` | — |

### 3.4 Risks and watchouts

**Figma library API shape.** The exact field names on `getAvailableLibrariesAsync()` results and component enumeration need verification in implementation. The design is shape-agnostic about specific field names — implementation must validate the API surface against current Figma plugin docs before wiring UI rendering.

**Plugin sandbox timeout.** Spec §7 already calls this out for state-heavy builds. Adding the Matched elements band can push artboard count past the 40-soft / 100-hard threshold faster. Keep the soft warning at 40 total artboards including matches.

**Selection-listener leak.** `figma.on("selectionchange")` must always have a matching `figma.off`. If user navigates away from Screen N abnormally (e.g. closes plugin while it's open), the listener should still be stopped. Mitigation: register `stopSelectionListener` on `figma.on("close")` and use a UI `beforeunload` safety.

**Iframe srcdoc size.** Some HiNAS mockups are 80KB+. The Screen N iframe uses `srcdoc` to load. Browsers support arbitrary sizes but Figma plugin iframes have stricter limits. If a mockup exceeds the limit, fall back to opening the HTML as a `data:` URL or prune to head + body only.

**clientStorage capacity.** `figma.clientStorage` has a 5MB limit per plugin per file. Largest persistence is `manualMatches` with optional html2canvas preview bytes (PNG, ~10-50KB each). Cap at 50 manual matches per file or store previews ephemerally (memory only, not persisted).

**Library not subscribed.** If a user selects a library on machine A but opens the plugin on machine B without library access, `getAvailableLibrariesAsync()` won't return it. `dsSync` returns "Library no longer available — choose another", banner offers to re-pick.

### 3.5 Explicitly out of scope

- DS conflict gate (Screen 06 dead UI stays dead until a follow-up spec defines what "conflict" means programmatically)
- Resume after panel close mid-build
- Inline placement of manual matches within state artboards (band-only for v0.1)
- Per-HTML-file mapping isolation (mappings shared across files for v0.1 simplicity)
- Multi-library merge (one active library at a time)
- Browsing unlinked libraries
- v0.2 Claude judgment-step automation (manual review remains)
- Automated test framework

---

## 4. Open questions for implementation

These are not blockers for sign-off — they are decisions to make during implementation that the design has deliberately left flexible:

1. **Search heuristic on Screen M.** Substring match across component name + variant names is fine for v0.1. Consider fuzzy match (Levenshtein) if the library is large (~100+ components).
2. **HTML selector format on Screen N.** A simple selector like `.detail-page form input[name="email"]` is enough for display. Don't over-invest — selectors are informational, not re-parsed at build time.
3. **Text override source for matched elements.** Default is the matched HTML element's `textContent`. If element has no text (e.g. an icon-only button), fall back to nearby sibling text or skip overrides.
4. **Order of bands on canvas.** Today: states → DS Candidates. New: states → DS Candidates → Matched elements. Confirm the maxNewY + 200 spacing rule applies consistently across all bands.

---

_Status: ready for implementation planning via writing-plans skill._
