# figma-migrate v0.2

## Load in Figma desktop

1. Run `./build.sh` from this directory (rebuilds `ui.html` from sources).
2. Figma → Plugins → Development → Import plugin from manifest…
3. Select `plugin-v0.2/manifest.json`.
4. Plugins → Development → "figma-migrate v0.2" launches the panel.

## Build step

Figma serves the plugin UI via `srcdoc` into a null-origin iframe, so `<link href>` and `<script src>` can't load external files — everything must be inlined into one `ui.html`.

After editing any of:

- `ui.template.html`
- `ui.css`
- `parser.js`
- `ui.js`

…run `./build.sh` before reloading the plugin in Figma. Never edit `ui.html` directly — it's a build artifact.

## Layout

- `manifest.json` — plugin manifest (points at `ui.html` and `code.js`)
- `code.js` — plugin-side (handles close + resize messages from UI)
- `ui.template.html` — UI shell with `{{INLINE_*}}` placeholders
- `ui.css` — all styles
- `parser.js` — `window.figmaMigrateParser` (autoDetect / capture / detect)
- `ui.js` — UI state machine + screen renderers
- `lib/sortable.min.js`, `lib/html2canvas.min.js` — bundled deps
- `build.sh` — concatenates the above into `ui.html`
- `ui.html` — **build artifact**, don't edit

v0.1 reference code lives under `_reference/plugin/` at the project root. See the top-level `CLAUDE.md` and `v0.2-decisions.md` for the architectural pivot.
