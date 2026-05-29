# Figma-migrate plugin (v0.1)

The production-shape Figma plugin for migrating HiNAS HTML mockups to design-system-backed Figma artboards. This folder is the shippable plugin scaffolding — the UI is final, the underlying build pipeline is not yet implemented.

## What ships in this folder

- **`manifest.json`** — Figma plugin metadata. Loads `code.js` for sandbox logic and `ui.html` for the panel UI.
- **`code.js`** — runs in Figma's plugin sandbox. Has the showUI call and a message-handler skeleton with stubs for each spec phase (parse, ds-sync, build). Each stub posts back an explicit "not yet implemented" error.
- **`ui.html`** — the production panel UI at real Figma plugin dimensions (380×800). One screen at a time, Screen 01 (Paste HTML) as the entry state.

## How to load and try in Figma

1. Open the Figma desktop app (web Figma doesn't support local plugins).
2. Open any design file.
3. **Plugins → Development → Import plugin from manifest…**
4. Select `/Users/younginsa/Documents/Claude/Projects/HiNAS/plugin/manifest.json`.
5. Run via **Plugins → Development → Figma-migrate**.

The plugin window opens at 380×800. You'll see the production Paste HTML view — no preview navigator, no gray surround. Buttons are wired to post messages back to `code.js`, but the handlers currently return errors because the parsing/building logic isn't implemented yet.

## What still needs implementation (v0.1 engineering)

The full scope is in `../figma-migrate-plugin-mvp-spec.md`. The four big pieces:

**HTML parser** (spec §4.1) — regex/DOM-parse the input HTML for states, modals, toasts, DS components, conditional visibility. Output a structured object the UI renders into Screen 02.

**DS sync** (spec §4.1) — call Figma Plugin API to sample the `Design system` page, list every COMPONENT/COMPONENT_SET, diff against a stored manifest. Show the result on Screen 02.

**Coverage map** (spec §4.1, §4.4) — for each DS component, decide which HTML elements it covers. Detect DS Candidates (structures not in the DS). Render into Screen 03 with the click-to-edit rows.

**Build pipeline** (spec §4.3) — for each artboard: import master via `importComponentSetByKeyAsync`, instantiate, toggle visibility, apply text overrides, build the auto-layout scaffold (Tab bar / Title / body / Footer), position overlays absolutely. Stream progress to the UI for Screen 04, finish with the Done summary on Screen 05.

Each of these has a stub in `code.js`. Wire each one to its corresponding UI screen and the state-machine flow falls out.

## State transitions in the UI (not yet wired)

The UI's screen-switcher needs to handle these transitions:

- Screen 01 → Screen 02: when `Parse HTML →` is clicked, post `{type: "parse-html", html: textarea.value}` to code.js; on response, switch the active `.strip__cell` to Screen 02.
- Screen 02 → Screen 03: on `Review DS mapping →` click, switch to Screen 03.
- Screen 03 → Screen 04: on `Build N artboards →` click, post `{type: "build", config: ...}` and switch to Screen 04. Listen for progress messages and update the stepper.
- Screen 04 → Screen 05: when code.js posts `{type: "build-complete", counts}`, switch to Screen 05.

The 11 screens are all present in `ui.html` — only one is `display: flex` (active) at a time. The state-switcher needs to listen to button clicks and toggle the `is-active` class on the right `.strip__cell`.

## Distribution (when v0.1 is functional)

**Internal-only (recommended for v0.1):** Keep the plugin in "Development" mode. Teammates clone the repo, import the manifest, run locally. No publishing required. Suits an internal tool not meant for the public.

**Avikus-wide via Figma Organization:** Publish as an organization-private plugin. Requires Avikus to be on a Figma Organization or Enterprise plan. The plugin appears in everyone's Plugins menu under the org's library. Best balance of distribution and control.

**Public Figma Community:** Submit to community.figma.com. Anyone in the world can install. Probably overkill and risky for v0.1 (the plugin is HiNAS-DS-hardcoded and would mislead non-HiNAS users).

The §8 stakeholder question about distribution in the spec needs an answer before publishing.

## Open spec questions still pending

Before v0.1 implementation kicks off, the six §8 questions in the spec need answers:

1. Token cost (BYOK or proxy) for v0.2's Claude integration
2. Plugin distribution channel (Organization vs Community)
3. DS-key configurability (single DS for v0.1 or planning for SVM/Cloud)
4. Source-of-truth posture (slash command vs plugin)
5. Slash command lifecycle (deprecate or keep both)
6. Privacy / data classification

## Difference vs `plugin-preview/`

- `plugin-preview/` is the design-review version with a custom navigator to step through all 11 screens. Used internally for stakeholder walkthroughs.
- `plugin/` (this folder) is the production shape — single-screen view, no navigator. Used when v0.1 implementation actually starts.

Both folders share the same panel CSS and HTML, just with different entry-state behavior.
