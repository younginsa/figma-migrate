#!/usr/bin/env bash
# Inline ui.css + libs + parser.js + ui.js into ui.html.
# Required by Figma's plugin runtime: UI is served via srcdoc into a null-origin
# iframe, so <link href> and <script src> can't load external files. Everything
# must live inside one ui.html.
#
# Run from plugin-v0.2/ after editing any source file:
#   ./build.sh
# Then reload the plugin in Figma.

set -euo pipefail
cd "$(dirname "$0")"

TEMPLATE="ui.template.html"
OUT="ui.html"

for f in "$TEMPLATE" ui.css parser.js ui.js lib/sortable.min.js lib/html2canvas.min.js; do
  [ -f "$f" ] || { echo "build.sh: missing $f" >&2; exit 1; }
done

awk '
  /\{\{INLINE_CSS\}\}/         { while ((getline line < "ui.css")                > 0) print line; close("ui.css");                next }
  /\{\{INLINE_SORTABLE\}\}/    { while ((getline line < "lib/sortable.min.js")   > 0) print line; close("lib/sortable.min.js");   next }
  /\{\{INLINE_HTML2CANVAS\}\}/ { while ((getline line < "lib/html2canvas.min.js")> 0) print line; close("lib/html2canvas.min.js");next }
  /\{\{INLINE_PARSER\}\}/      { while ((getline line < "parser.js")             > 0) print line; close("parser.js");             next }
  /\{\{INLINE_UI\}\}/          { while ((getline line < "ui.js")                 > 0) print line; close("ui.js");                 next }
  { print }
' "$TEMPLATE" > "$OUT"

echo "Built $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
