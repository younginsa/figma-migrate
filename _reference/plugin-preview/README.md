# Figma-migrate — plugin preview

Loads the v0.1 panel mockup as a real Figma plugin so the design can be reviewed at actual plugin dimensions inside Figma's UI. No real migration logic yet — clicking buttons does nothing. This folder is also the seed for the eventual v0.1 implementation; the manifest, code.js and ui.html scaffolding stay; the UI grows real behavior in subsequent phases.

## How to load

1. **Open Figma desktop.** Web Figma does not support importing local development plugins; only the desktop app does. Get it from <https://www.figma.com/downloads/> if needed.
2. **Open any Figma design file.** Plugins only run in the context of an open file.
3. **Menu bar → Plugins → Development → Import plugin from manifest…**
4. **Pick this folder's `manifest.json`:** `/Users/younginsa/Documents/Claude/Projects/HiNAS/plugin-preview/manifest.json`
5. Figma registers the plugin. Run it from **Plugins → Development → Figma-migrate (Preview)**.

The plugin window opens at 380×800 px showing Screen 01. Click the chevron arrows at the top, or use the keyboard ← / → arrow keys, to step through all 10 screens.

## Files

- `manifest.json` — Figma plugin metadata. The `id` is a placeholder; replace before publishing.
- `code.js` — runs in Figma's plugin sandbox. Currently just calls `figma.showUI()` to open the panel; no `figma.*` API calls yet. Stub `onmessage` handler for the eventual UI-to-sandbox bridge.
- `ui.html` — the panel UI. This is the mockup file (`../figma-migrate-plugin-panel-mockup.html`) with the doc-review layout suppressed and a screen-switcher added at the top. All 10 screens are present in the DOM; only one is `display: flex` at a time.

## Editing notes

If you update the master mockup at `../figma-migrate-plugin-panel-mockup.html`, the changes won't flow into `ui.html` automatically. Either rerun the copy + script-injection, or edit `ui.html` directly. (The injected pieces are: the `plugin-nav` HTML right after `<body>`, the screen-switcher `<script>` block at the bottom, and the "Plugin-mode overrides" CSS at the end of the `<style>` block.)

## Where the boundary is

This preview matches the spec in `../figma-migrate-plugin-mvp-spec.md`. What's *not* here:
- No HTML parser (Phase 1 / 4.1 in the spec)
- No DS sync / coverage map logic (Phase 1 / 4.1)
- No artboard build pipeline (Phase 3)
- No DS Candidate band (Phase 4)
- No Claude API calls (v0.2 only)

The UI states are static; nothing wired up.

## Next step toward a real plugin

The v0.1 implementation work is scoped in `../figma-migrate-plugin-mvp-spec.md`. Once §8 stakeholder questions are answered, the engineering spike builds out the deterministic rule modules (`rules/parse-html.js`, `rules/ds-sync.js`, etc. — see §3.1 of the spec) and wires the UI events to those modules through `code.js`.
