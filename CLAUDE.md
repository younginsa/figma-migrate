# figma-migrate plugin v0.2 — pattern-group approach

This folder hosts the v0.2 rewrite of the Figma plugin. The architecture is fundamentally different from v0.1 — read both docs below before writing any code.

## Required reading (before any code)

- **`v0.2-decisions.md`** — architecture, behavior rules, build order, non-goals
- **`figma-migrate-plugin-v0.2-mockup.html`** — UI spec, 8 screens, interactions

These two files are the source of truth. If something is unclear, ask Young — do not guess and do not fall back to v0.1 patterns.

## Architectural pivot (must remember)

**v0.1** was DS-first matching: plugin tries to match HTML elements to existing DS components, then renders DS instances. This approach was abandoned because matching accuracy was unreliable and failure modes were silent.

**v0.2** is pattern-group: plugin detects repeated patterns in HTML and creates its own component + instance structure. DS alignment is done by the designer working on the masters in Figma — never by the plugin matching.

## Hard rules (do not break)

- **No DS matching logic.** The plugin must not implement any logic that tries to map HTML elements to DS components by similarity, class hint, or any other signal. Anything resembling v0.1's `dsSync()` for matching is wrong.
- **No LLM / AI integration in v0.2.** Pattern detection is fully deterministic (structural hash + class string). LLM is v0.3+ backlog.
- **No coverage map UI.** No "review DS mapping" screens, no per-element drill-downs for matching decisions, no DS Candidate detection.
- **No big-bang rewrite.** Follow the phased build order in `v0.2-decisions.md` → "Migration plan from v0.1". One phase at a time. Smoke-test after each phase before moving on.

## Reference material (do not modify)

`_reference/` contains v0.1 code and docs, preserved for reference only:

- `_reference/plugin/` — v0.1 production code
- `_reference/plugin-preview/` — v0.1 design-review version
- `_reference/CLAUDE-v0.1.md` — v0.1's CLAUDE.md
- `_reference/.claude-v0.1/` — v0.1's Claude Code settings + slash commands
- `_reference/figma-migrate-plugin-mvp-spec.md` — v0.1 spec (historical context only)

Treat everything under `_reference/` as read-only. The v0.1 parser logic in `_reference/plugin/code.js` may potentially be reused, but only after Young explicitly agrees on what to port.

## Project artifacts

- Figma file: `iSBKt82nnX2Uebb1hH4AfE` (Control DS) — Young will confirm if this is still the target file for v0.2
- Test HTML mockups: `Control/` directory (multi-page HiNAS HTML)
- Design system context: `HiNAS Design System.md`

## Build workflow (Phase 5+)

The plugin UI is split into editable source files (`ui.template.html`, `ui.css`, `parser.js`, `ui.js`, plus `lib/sortable.min.js` and `lib/html2canvas.min.js`), but Figma's plugin runtime serves the UI via `srcdoc` into a null-origin iframe — `<link href>` and `<script src>` can't load external files. Everything must be inlined into a single `ui.html`.

`plugin-v0.2/build.sh` does the inlining. **After editing any source file (`ui.template.html` / `ui.css` / `parser.js` / `ui.js`), run `./build.sh` from `plugin-v0.2/` before reloading the plugin in Figma.**

`plugin-v0.2/ui.html` is a build artifact. Edit the sources, never `ui.html` directly. The manifest references `ui.html` so the name stays untouched.

## Workflow expectations

- Before any non-trivial code change, summarize the plan and wait for Young's OK.
- Run smoke tests against real HTML in `Control/` after each phase.
- If the work pulls toward DS matching, LLM, or coverage-map logic — stop and ask. These are intentionally excluded from v0.2.
- Young is a product designer, not an engineer. Explain technical decisions briefly, but assume the user wants to understand the *why* behind every architectural choice.
