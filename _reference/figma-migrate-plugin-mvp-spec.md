# `/figma-migrate` as a Figma plugin — MVP scope

_Author: Avikus Product Design · Drafted: 2026-05-08_
_Companion to: `figma-migrate-vs-claude-design.md` (audience analysis), `.claude/commands/figma-migrate.md` (current rule set)._

---

## TL;DR

Port the `/figma-migrate` workflow into a Figma plugin so designers, PMs, and engineers without Claude Code + MCP can run it. Use a **hybrid architecture**: rules that are mechanical run as deterministic JS in the plugin sandbox; rules that require judgment optionally call the Claude API from inside the plugin (BYOK in v0.1). Keep `.claude/commands/figma-migrate.md` as the canonical rule source — the plugin reads from it where possible — so the slash command and the plugin do not drift.

**v0.1 MVP** ships the deterministic path only. A user pastes HTML, reviews a parse preview and a DS coverage map, confirms three gates if they fire, then watches a progress stepper as artboards are built into the currently-open Figma file. No Claude API key required, but at the cost of slightly more manual confirmation steps.

**v0.2** adds Claude-in-plugin to automate the judgment steps (parent-state picking, DS-candidate detection, coverage map auto-fill).

**v0.3+** is the differentiation work — re-run diffs, multi-DS support — and is out of MVP scope.

---

## 1. Why a Figma plugin (and not a web app)

Picked over a hosted web app for three reasons that hold for the foreseeable future:

The work destination is Figma. Putting the UI inside Figma collapses three separate questions ("which file?", "do you have OAuth set up?", "did the write actually land?") into none. The user has the file open already.

There is no server cost or auth surface in v0.1. Distribution is "install our plugin once," not "set up an account, OAuth your Figma, store an API token." This matters because the audience is internal Avikus and doesn't justify building a SaaS.

The runbook's rules are the product, and most of them call directly into the Figma Plugin API — the same surface the MCP wraps for the slash command today. A plugin is the shortest path between the rules and the canvas.

What we lose vs. the slash command: the agent's free-form reasoning across tool calls. The slash command can pause, re-read a file, change its mind. A plugin in pure JS cannot. We close that gap in v0.2 by calling the Claude API for the specific steps that need it (see §4).

---

## 2. Audience and success criteria

**Primary audience.** Avikus designers and PMs who today cannot run `/figma-migrate` because they do not have Claude Code installed or the Figma MCP server configured. The `figma-migrate-vs-claude-design.md` evaluation explicitly identifies this as the workflow's biggest adoption ceiling.

**Secondary audience (later).** Engineers who today *can* use the slash command but would prefer a UI for one-off runs without leaving Figma.

**Success looks like:**

A non-CLI Avikus designer opens `iSBKt82nnX2Uebb1hH4AfE`, opens the plugin, pastes the contents of `Control/cpp-setting-tab-mockup.html`, and produces a band of artboards visually indistinguishable from what `/figma-migrate` produces today, in under five minutes, without needing to ask an engineer for help.

The plugin's output is **byte-equivalent** to the slash command's output for the same HTML — same naming, same placement, same DS instances, same auto-layout structure. This is non-negotiable: drift between the two implementations would force teams to pick one and would defeat the point of the port.

The DS coverage map review step catches at least the same DS-candidate set as the CLI does today (Profile rows, inline banner, insert-row pill, editable data table, chart card, etc. — see Phase 1 output from 2026-05-08).

---

## 3. Architecture

### 3.1 Plugin shell

Standard Figma plugin layout:

```
figma-migrate-plugin/
├── manifest.json           network access for api.anthropic.com (v0.2+)
├── ui.html                 the panel UI — paste HTML, review, confirm, progress
├── ui.js                   panel logic; postMessage → code.js
├── code.js                 plugin sandbox; talks to figma.* Plugin API
├── rules/
│   ├── parse-html.js       HTML → state list, modal list, toast list
│   ├── ds-sync.js          sample Design system page, diff manifest
│   ├── coverage-map.js     DS components → HTML elements
│   ├── placement.js        4×N grid, origin math, naming
│   ├── scaffolding.js      auto-layout band hierarchy, sizing
│   ├── system-states.js    Loading / Empty / Error variants
│   ├── modals.js           one artboard per openModal*() call
│   ├── toasts.js           one artboard per showToast() call
│   ├── icons.js            DS icon lookup; glyph→variant table
│   └── ds-candidates.js    structures not in the DS
├── llm.js                  (v0.2+) Claude API wrapper for judgment steps
└── settings.html           API key entry, target page picker (v0.2+)
```

Plugin runs entirely in Figma's plugin sandbox. The UI panel is a separate iframe that posts messages to `code.js`, which is the only context that can call `figma.*`.

### 3.2 Where Claude lives — the hybrid decision

Three options were considered:

**Pure JS port.** Every rule is hard-coded. Lowest cost per run (no LLM tokens), highest cost to maintain (every edge case becomes a code change), and brittle when the HTML strays from convention. Rejected because the runbook is *living* — we have been editing it as new edge cases surface (the section-coords gotcha, the icon-from-DS rule, the auto-layout rewrite). Calcifying the rules in JS would force every edit to ship as a plugin update.

**Claude-in-plugin only.** The plugin makes API calls for everything; rules live in markdown and are read at runtime. Highest fidelity to the slash-command behavior, but slowest, most expensive, and adds a hard dependency on Anthropic's API for what should be deterministic operations (creating a frame, setting text, positioning a toast).

**Hybrid (chosen).** Mechanical rules run as JS. Judgment rules optionally call the Claude API. The split is documented in §4. v0.1 ships with all judgment steps surfaced as user-confirmation modals; v0.2 lets the user provide an API key and skip those modals. The user can always fall back to the manual path even with Claude enabled, so a network outage degrades gracefully.

### 3.3 API key handling (v0.2+)

Two paths:

**BYOK (bring your own key).** User enters an Anthropic API key in plugin settings, stored via `figma.clientStorage`. Simplest, no server. Good fit for an internal Avikus tool where every designer has access to the org's Anthropic account.

**Proxy through Avikus endpoint.** Plugin calls `claude.avikus.com/v1/messages`, which forwards to Anthropic with a centrally-held key. User never sees a key. Better for cost control and for sharing the plugin outside the design team. Adds server cost and OAuth-style auth.

**v0.1 ships neither — no Claude calls. v0.2 ships BYOK. Proxy is v0.3+ if Avikus decides to make the plugin available beyond design.**

---

## 4. Rule classification — deterministic vs judgment

This is where the porting work actually lives. Every rule in `commands/figma-migrate.md` is classified as **D**(eterministic — port to JS), **J**(udgment — Claude in v0.2, manual confirmation in v0.1), or **U**(I-only — surfaced as a confirmation modal regardless).

### 4.1 Phase 1 — Pre-flight

| Rule | Class | Notes |
|---|---|---|
| Sample Design system page, list COMPONENT/COMPONENT_SET | D | Direct Plugin API: iterate `dsPage.children`, filter by type. No reasoning needed. |
| Diff against `.claude/ds-manifest.json` | D | Compare names/keys/variants. Deterministic. |
| Print sync result + ask user to refresh on changes | U | Confirmation modal: "DS has changed since {date}. Update manifest, or use cached?" |
| Read & parse HTML → states | D | Regex / DOM parse: `case '<key>'` in switch + `[data-dev]` buttons. |
| Parse HTML → visible text per state | D | Match against state render functions, extract title/body/CTA strings. |
| Parse HTML → DS components used | D | Detect `.btn`, `.modal`, `.toast`, `.centered-state` etc. by class. |
| Parse HTML → conditional visibility | D | Track `state.{var} ? ... : ''` patterns. |
| **DS coverage map** — for every DS component, decide which HTML elements it covers | **J** | This is the central judgment step. v0.1 surfaces a pre-filled table for the user to review/correct; v0.2 has Claude pre-fill it from the parse + DS sample. |

### 4.2 Phase 2 — Defaults

All deterministic.

| Rule | Class | Notes |
|---|---|---|
| Placement = parallel band, origin (80, maxY+200) rounded to 1000, 4×N grid 1320×880 | D | Pure math. |
| Naming = `Setting - {Section} - {State}` | D/J | The `{Section}` derivation from filename ("CCP" from `cpp-setting-tab-mockup.html`) is a heuristic — strip `-mockup`, `-update`, `-tab`, uppercase short token. v0.1 ports the heuristic; v0.2 falls back to Claude when the heuristic produces a clearly wrong token. |
| State list = auto-derive from HTML | D | Already covered above. |
| One artboard per `openModal*()` call | D | grep the JS for `function openModal*()`. |
| Parent state for each modal (Add Profile → Empty, Delete → Edit, Unsaved guard → Edit dirty, Select confirm → Populated) | D/J | Hard-coded lookup for the canonical CCP HTML — deterministic. For unknown modals, the parse-preview step lets the user pick the parent state from a dropdown. v0.2 has Claude propose a default. |
| One artboard per distinct `showToast(...)` call | D | grep + dedupe by message. Demo-only toasts (`'Dialog closed (demo)'`) flagged for user confirmation rather than auto-excluded. |
| Toast variant mapping (`success`/`default` → `compact/success`; `error` → `compact/failed`) | D | Pure lookup table per the runbook. Long-error variants (`failed 2`, `failed 2-action`) selected by message length threshold. |
| DS Candidate band always created | D | At `(80, maxNewY + 200)`. |

### 4.3 Phase 3 — Per-artboard build

Mostly deterministic — these are mechanical Plugin API operations.

| Rule | Class | Notes |
|---|---|---|
| Inspect master layer tree (incl. hidden) | D | `collectLayers` recursion, exact pattern from runbook. |
| Create fresh instance via `importComponentSetByKeyAsync` | D | Direct API. |
| Toggle child visibility to match HTML | D/J | Mostly mechanical (HTML shows it → set visible), but resolving "what's the matching DS layer?" can need fuzzy matching. v0.1 uses exact-name match + reports unmatched; v0.2 lets Claude resolve fuzzy cases. |
| Apply text overrides (`loadFontAsync` → find by chars → assign) | D | Direct API; the find-by-chars pattern is exact. |
| Build with auto-layout: `VERTICAL` artboard → Tab → Title → body → Footer | D | Pure scaffolding; no judgment. |
| `body` uses CENTER for system-state screens, MIN for content | D | Decided by state type — derivable from parsed state. |
| Overlays escape via `layoutPositioning='ABSOLUTE'` | D | Apply to known overlay categories: close X, Toast, Modal+backdrop, dev panel. |
| Toast positioned center-bottom, 24px above bottom | D | Pure math. |
| Footer = HORIZONTAL, primaryAlign=MAX (or SPACE_BETWEEN for 3-button) | D | Decided by button count. |
| **Icons from DS** — search before falling back to text glyphs | **D** | Glyph→variant table is in the runbook (§Icons). Port to JS. The DS-search fallback for unknown glyphs is judgment in v0.2; v0.1 supports only the seven mapped glyphs and warns on others. |
| Verify live instance tree | D | Direct API. |

### 4.4 Phase 4 — DS Candidate band

| Rule | Class | Notes |
|---|---|---|
| Detect HTML structures not in the DS | **J** | Same judgment step as the coverage map. v0.1 surfaces the candidates from the coverage map review; v0.2 has Claude propose them. |
| Build at `(80, maxNewY+200)` with 32px label | D | Mechanical. |

### 4.5 Conditional gates

All UI-only — surface as inline modals over the progress stepper, regardless of Claude availability.

| Gate | Class | Trigger |
|---|---|---|
| **DS conflict** — master renders wrong in context | U | Detected programmatically (e.g. modal master with light fill in dark file); user picks fix-master / override / different-component. |
| **Bulk operation scope** — full pages vs. targeted | U | Triggered when re-run hits >3 existing artboards (v0.3 only). |
| **Section coords** verification | D | Auto-applied (verify with `absoluteBoundingBox`); not a user gate. |
| **Self-test on file edit** | OUT | Out of plugin scope — this is a slash-command-author rule, not a runtime user rule. |

### 4.6 Out of scope for v0.1

These rules from the runbook are deliberately not ported in MVP:

- **Self-test artboard generation** when the runbook is edited. Plugin users do not edit the runbook from inside Figma. This stays in the slash command.
- **2nd-Terminal status pane** (`migrate-mode.sh`, `rule.sh`). Replaced entirely by the in-plugin progress stepper.
- **Re-run diff against existing artboards.** v0.1 always builds a fresh band. Re-run handling is v0.3, including the runbook's "remove inherited content that contradicts the HTML" principle (stale toasts/modals on cloned parents). v0.1 sidesteps this by never cloning — every band is fresh.
- **Multi-DS support.** v0.1 hard-codes the HiNAS DS keys, same as the slash command. Configurable DS keys are v0.4.

---

## 5. UX flow

### 5.1 Happy path (v0.1)

1. **Open plugin.** User has `iSBKt82nnX2Uebb1hH4AfE` open in Figma. Runs Plugins → Avikus → figma-migrate. Panel opens (right side, 360×640 default).
2. **Paste HTML.** Single textarea + "Upload .html file" button. URL fetch is out of scope (CORS, security).
3. **Parse preview.** Plugin runs deterministic parse, shows: state count + list, modal count + list, toast count + list, DS components used. User can deselect demo-only toasts here ("Dialog closed (demo)" pre-flagged).
4. **DS sync.** Plugin samples Design system page, diffs manifest. If unchanged: small green confirmation. If changed: modal with diff + "use latest / use cached" choice.
5. **DS coverage review.** The central review step. Table shows every DS component → HTML elements it covers. Pre-filled by deterministic rules. User can: edit a coverage decision, mark an HTML element as DS candidate, or accept defaults. **Most workflows take 30 seconds here.**
6. **Confirm & build.** "Build N artboards" button. Progress stepper begins.
7. **Build progress.** Stepper shows current phase; per-artboard progress under "Phase 3: Building Edit Profile [5/17]". Conditional gates (DS conflict) appear as inline modals over the stepper without aborting the run.
8. **Done.** Summary card: "Built 17 artboards on `Claude output`. View band." Click jumps the canvas to the band origin.

### 5.2 Failure paths

- Parse fails (HTML doesn't have a recognizable state pattern) → error card with suggestions, no artboards created.
- DS sync fails to find `Design system` page → modal asking user to confirm page name or pick from a list.
- Plugin sandbox times out mid-build → resume button on the summary card; tracked via `figma.clientStorage`.
- User closes the panel mid-build → build continues, but progress stepper is lost. Reopen panel to resume.

### 5.3 Settings (v0.1 minimum)

- Target page name (default `Claude output`)
- Manifest cache freshness threshold (default 7 days; older → force resync)

### 5.4 Settings (v0.2 additions)

- Anthropic API key (BYOK)
- Toggle: "Use Claude for judgment steps" (default on if key present)

---

## 6. Phasing

### v0.1 — Deterministic MVP (target: 4 weeks)

Everything classified D in §4. UI confirmation modals for all J steps (DS coverage map review is the main one). No Claude API calls. Hard-coded HiNAS DS keys.

Validation: produce byte-equivalent output to the slash command for `Control/cpp-setting-tab-mockup.html`.

### v0.2 — Claude-in-plugin (target: +3 weeks)

BYOK key entry, optional Claude API calls for judgment steps. The user can still manually override every Claude suggestion.

Validation: end-to-end run with no manual intervention beyond the initial paste, on the same HTML.

### v0.3 — Re-run diff (target: +4 weeks)

Detect that this HTML maps to an existing band (by `Section` name + first artboard's stored plugin data). Diff state-by-state, update only changed artboards. Bulk operation gate fires here.

This is the first feature the plugin has that the slash command does not.

### v0.4 — Multi-DS support (target: +4 weeks)

Configurable DS keys in plugin settings. Allows running the plugin against `nCcEQ5xPIJ1d4pivt35Jkx` directly, or against an HiNAS SVM file once that DS exists.

Out of scope for the next two quarters: server-proxy auth, public distribution, accessibility audit features, brand-style ingestion (that is Claude Design's lane, not ours).

---

## 7. Risks and mitigations

**Plugin sandbox timeout.** Building 17+ artboards with hundreds of children can hit Figma's plugin operation timeouts. *Mitigation:* batch builds in groups of three artboards, yield to the event loop between batches with `await new Promise(r => setTimeout(r, 0))`, store progress in `figma.clientStorage` so resumes are possible.

**Rule drift between plugin and slash command.** The runbook is alive — every rule edit is now two implementations, not one. *Mitigation:* designate `commands/figma-migrate.md` as canonical. The plugin's rule modules each include a comment with the runbook section they implement and the runbook commit hash they were ported from. A CI check warns when the runbook changes without a corresponding plugin commit. Additionally, v0.2's Claude-in-plugin path reads the runbook directly, eliminating drift for judgment steps.

**HiNAS DS keys hard-coded.** Same risk the slash command has today. Same mitigation: keys live in one config file, easy to update on DS republish.

**Anthropic API outage (v0.2+).** Plugin should degrade gracefully — fall back to v0.1 manual confirmation modals, not block the run.

**Distribution.** Org-private plugins on Figma require an Organization plan. *Mitigation:* confirm Avikus is on Organization tier before scoping; if not, distribute as a community plugin with a config-gated activation.

**HTML parsing brittleness.** The parser depends on specific HTML conventions (dev panel switch, `[data-dev]`, `openModal*()`, `showToast()`). HTML that diverges silently produces wrong artboards. *Mitigation:* parse step explicitly reports what it found; if state count is zero or modal-call count doesn't match the dev-panel state count, refuse to proceed with a clear error.

**Performance ceiling.** This plugin is for state-heavy screens (~20 artboards). It is not a general-purpose Figma generator. *Mitigation:* surface a soft warning at >40 artboards in a single run; refuse at >100.

---

## 8. Open questions for stakeholders

These need a call before v0.1 starts:

1. **Token cost (v0.2):** BYOK or proxy through Avikus? BYOK means each user/team needs an Anthropic account. Proxy means Avikus owns the bill and needs a server.
2. **Plugin distribution:** Is Avikus on a Figma Organization plan? If not, do we publish as a community plugin?
3. **DS key configurability (v0.4):** Should we plan for SVM and Cloud DS support up-front, or wait until those DSes are published?
4. **Source-of-truth posture:** Are we comfortable making `commands/figma-migrate.md` canonical and treating the plugin's rule modules as derived? The alternative is dual-source, which I expect to drift.
5. **Slash command lifecycle:** Once the plugin reaches feature parity, do we deprecate the slash command, keep both indefinitely, or use the slash command for engineering pipelines and the plugin for designers? My recommendation is the third — they serve different audiences and don't conflict if rule sources are unified.
6. **Privacy:** HTML mockups occasionally contain placeholder text or screenshots that include unreleased product names. The plugin sees this content. Is there an internal classification we should mark on the plugin (Confidential, etc.)?

---

## 9. What this spec deliberately does not specify

- **Visual design of the plugin panel.** Comes after scope sign-off. Will follow the HiNAS Cloud / Day mode tokens since plugins inside Figma render against Figma's own light surface, not a HiNAS dark surface.
- **Copywriting for confirmation modals and error states.** Drafted at implementation time.
- **Performance budgets per phase.** Measured during v0.1 build, baselined for v0.2.
- **Telemetry and usage tracking.** Decide with privacy review.

---

## 10. Next step

If this scope holds, the work is:

1. Sign off on §8 questions with the design and engineering leads (~1 week, mostly async).
2. Spike v0.1's deterministic parse + scaffolding pipeline against the existing CCP HTML, validate byte-equivalence with the current slash-command output. Two-week spike, single engineer, single Figma file.
3. If the spike validates, build out v0.1 to scope.

If the scope does not hold, the most likely place it breaks is rule classification (§4) — specifically the line between D and J for the coverage map and visibility-toggle rules. A spike is the only way to know for sure.

---

_Last updated: 2026-05-08_
