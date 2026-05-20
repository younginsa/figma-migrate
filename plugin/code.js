// Figma-migrate — v0.1 plugin entry
//
// This is the production-shape plugin: the UI looks like the real plugin will,
// but the actual parsing / building logic is not yet wired up. The buttons
// in the UI fire messages back here, but the handlers below are stubs.
//
// To make this a fully functional plugin, implement the message handlers below.
// Each one corresponds to a step from `../figma-migrate-plugin-mvp-spec.md`.

figma.showUI(__html__, {
  width: 380,
  height: 800,
  title: "Figma-migrate",
});

figma.on("close", function () {
  if (_selectionListenerActive) {
    _selectionListenerActive = false;
    try { figma.off("selectionchange", _postSelectionUpdate); } catch (eClose) {}
  }
});

// ============================================================
// Selection listener — for Phase E manual rescue match (Screen N).
// UI starts the listener when entering Screen N, captures the user's
// current Figma selection, and stops it when leaving. Only one
// COMPONENT or INSTANCE selection produces an update.
// ============================================================

var _selectionListenerActive = false;

function _postSelectionUpdate() {
  if (!_selectionListenerActive) return;
  var sel = figma.currentPage.selection;
  if (sel && sel.length === 1 && (sel[0].type === "COMPONENT" || sel[0].type === "INSTANCE")) {
    var node = sel[0];
    var keyNode = node.type === "INSTANCE" ? node.mainComponent : node;
    if (!keyNode) {
      figma.ui.postMessage({ type: "selection-update", component: null });
      return;
    }
    figma.ui.postMessage({
      type: "selection-update",
      component: {
        key: keyNode.key,
        id: keyNode.id, // file-local id — primary lookup for resolveDsComponent
        name: keyNode.name,
        parentName: keyNode.parent ? keyNode.parent.name : null,
      },
    });
  } else {
    figma.ui.postMessage({ type: "selection-update", component: null });
  }
}

// ============================================================
// Storage scoping — keep per-file state isolated.
// ============================================================
// Scope a clientStorage key by the current Figma file, so mappings
// from one DS file don't bleed into another. figma.fileKey is the
// stable file identifier. When fileKey is unavailable (older API
// fallbacks), bucket into a shared "no-file" namespace so reads
// don't silently miss writes.
function fileScoped(key) {
  var fid = figma.fileKey || "no-file";
  return "f__" + fid + "__" + key;
}

// ============================================================
// DS sync — Design-system-page-only.
// Walks the in-file "Design system" page for components and
// persists them to clientStorage.dsComponents for Phase D's
// component picker. Library import is deferred post-v0.1.
// ============================================================

async function dsSync() {
  var pages = figma.root.children;
  var dsPage = null;
  for (var i = 0; i < pages.length; i++) {
    if (pages[i].name === "Design system") {
      dsPage = pages[i];
      break;
    }
  }

  if (!dsPage) {
    return {
      ok: false,
      source: null,
      error:
        "No 'Design system' page in this file. Add a page named 'Design system' containing your DS components, then re-parse.",
    };
  }

  // Walk the page for components.
  var originalPage = figma.currentPage;
  var needRestore = originalPage !== dsPage;
  if (needRestore) await figma.setCurrentPageAsync(dsPage);

  var components = [];
  function walkComponents(node) {
    if (node.type === "COMPONENT_SET" || node.type === "COMPONENT") {
      components.push({
        name: node.name,
        key: node.key,
        id: node.id, // file-local stable identifier (works for local + library)
        type: node.type,
        variants:
          node.type === "COMPONENT_SET" && node.children
            ? node.children.map(function (c) {
                return {
                  name: c.name,
                  id: c.id,
                  key: c.key,
                };
              })
            : [],
      });
      return; // don't recurse into components
    }
    if ("children" in node) {
      for (var j = 0; j < node.children.length; j++) walkComponents(node.children[j]);
    }
  }
  walkComponents(dsPage);

  if (needRestore) await figma.setCurrentPageAsync(originalPage);

  // Persist components so Phase D's Screen M (Pick DS component picker)
  // can render them without re-walking the page on every open.
  var current = {
    source: "page",
    sourceName: "Design system",
    components: components,
    timestamp: new Date().toISOString(),
  };
  await figma.clientStorage.setAsync(fileScoped("dsComponents"), current);

  return {
    ok: true,
    source: "page",
    sourceName: "Design system",
    changed: false,
    lastSyncedAt: current.timestamp,
    componentCount: components.length,
  };
}

function manifestsEqual(a, b) {
  if (!a || !b) return false;
  if (a.source !== b.source) return false;
  var aComps = a.components || [];
  var bComps = b.components || [];
  if (aComps.length !== bComps.length) return false;
  var byName = {};
  for (var i = 0; i < bComps.length; i++) {
    byName[bComps[i].name] = bComps[i];
  }
  // Normalize a variants entry to a comparable string. Variants used to be
  // bare names ("size=lg"); after the node-ID upgrade they're {name, id, key}.
  // Support both shapes so a stale manifest doesn't trigger a spurious diff.
  function variantKey(v) {
    if (v && typeof v === "object") return v.name || "";
    return String(v || "");
  }
  for (var j = 0; j < aComps.length; j++) {
    var match = byName[aComps[j].name];
    if (!match) return false;
    var av = (aComps[j].variants || []).map(variantKey).sort();
    var bv = (match.variants || []).map(variantKey).sort();
    if (av.length !== bv.length) return false;
    for (var k = 0; k < av.length; k++) {
      if (av[k] !== bv[k]) return false;
    }
  }
  return true;
}

// ============================================================
// Resolve a user-mapped DS component using a 3-tier strategy:
//   1) figma.getNodeByIdAsync(id) — works for any local node, fast
//   2) importComponentByKeyAsync(key) — works for published library
//      components; fails with 404 on local-only components
//   3) Walk the in-file "Design system" page by name — last-ditch
//      fallback robust against ID/key drift across DS edits
// Returns the component node or null.
// ============================================================
async function resolveDsComponent(mapping) {
  if (!mapping) return null;
  // 1) Try by ID (local components, instant lookup)
  if (mapping.componentId) {
    try {
      var byId = await figma.getNodeByIdAsync(mapping.componentId);
      if (byId && (byId.type === "COMPONENT" || byId.type === "COMPONENT_SET")) {
        return byId;
      }
    } catch (eId) { /* fall through */ }
  }
  // 2) Try by key (published library components)
  if (mapping.componentKey) {
    try {
      var byKey = await figma.importComponentByKeyAsync(mapping.componentKey);
      if (byKey) return byKey;
    } catch (eKey) { /* fall through */ }
  }
  // 3) Last-ditch: scan the in-file Design system page for a name match
  if (mapping.componentName) {
    try {
      var pages = figma.root.children;
      for (var pi = 0; pi < pages.length; pi++) {
        if (pages[pi].name === "Design system") {
          var dsPage = pages[pi];
          var found = null;
          function walk(n) {
            if (found) return;
            if (n.type === "COMPONENT" || n.type === "COMPONENT_SET") {
              if (n.name === mapping.componentName) {
                found = n;
                return;
              }
            }
            if ("children" in n && n.children) {
              for (var k = 0; k < n.children.length; k++) walk(n.children[k]);
            }
          }
          walk(dsPage);
          if (found) return found;
        }
      }
    } catch (eName) { /* fall through */ }
  }
  return null;
}

// ============================================================
// HTML parser — extracts states/modals/toasts/DS components
// from HiNAS HTML mockup conventions. Brittle regex-based for
// v0.1; will be replaced with a proper DOM-based parser later.
// ============================================================

function parseHtml(html) {
  var states = [];
  var seenStates = {};
  var statePattern = /case\s+['"]([^'"]+)['"]\s*:/g;
  var match;
  while ((match = statePattern.exec(html)) !== null) {
    if (!seenStates[match[1]]) {
      seenStates[match[1]] = true;
      states.push(match[1]);
    }
  }

  // Walk modal functions for title/body text.
  // Best-effort regex extraction; v0.1 covers the common patterns we see
  // in HiNAS mockups. v0.2 would replace with a proper AST parser.
  // Each entry is now an object { name, title, body } (was: bare string).
  // Downstream consumers must read `.name` for the function-call label.
  var modals = [];
  var seenModals = {};
  // Match function signature with any args (HiNAS has both empty signatures
  // and destructured/named args like `(profileId)` or `({ onSave, ... })`).
  // Capture body as everything from the first `{` up to a closing `\n  }` —
  // 2-space indent matches the HiNAS mockup convention.
  var modalFuncPattern = /function\s+(open[A-Z]\w*(?:Modal|Confirm)\w*)\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/g;
  while ((match = modalFuncPattern.exec(html)) !== null) {
    var fnName = match[1];
    var fnBody = match[2];
    if (seenModals[fnName]) continue;
    seenModals[fnName] = true;
    // Try to extract title + body
    var title = "";
    var body = "";
    // Pattern A: openModal('Title', 'Body', ...) or openConfirm('Title', 'Body')
    var openCall = /\bopen(?:Modal|Confirm)\w*\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/.exec(fnBody);
    if (openCall) {
      title = openCall[1];
      body = openCall[2];
    } else {
      // Pattern B: <h1|h2|h3>Title</h*> + <p>Body</p> inside template literal
      var h = /<h[1-6][^>]*>([^<]+)<\/h[1-6]>/.exec(fnBody);
      if (h) title = h[1].trim();
      var p = /<p[^>]*>([^<]+)<\/p>/.exec(fnBody);
      if (p) body = p[1].trim();
      // Pattern B2: <div class="modal__body">Body</div> (HiNAS convention)
      if (!body) {
        var bodyDiv = /<div[^>]*class\s*=\s*["'][^"']*\bmodal__body\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/.exec(fnBody);
        if (bodyDiv) {
          // Strip nested HTML tags; collapse whitespace.
          body = String(bodyDiv[1] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        }
      }
    }
    modals.push({
      name: fnName + "()",
      title: title,
      body: body,
    });
  }

  var toasts = [];
  var seenToasts = {};
  // Match showToast('message', 'variant') or showToast(`message`, 'variant')
  var toastPattern = /showToast\(\s*[`'"]([^`'"]+)[`'"]\s*(?:,\s*[`'"]?(\w+)[`'"]?)?\s*[,)]/g;
  while ((match = toastPattern.exec(html)) !== null) {
    var msg = match[1];
    var variant = match[2] || "default";
    var key = msg + "::" + variant;
    if (!seenToasts[key]) {
      seenToasts[key] = true;
      var isDemo = /\(demo\)|placeholder|todo|\[wip\]|\(test\)|stub/i.test(msg);
      toasts.push({
        message: msg,
        variant: variant === "default" ? "success" : variant,
        isDemo: isDemo,
      });
    }
  }
  // showUndoToast(message) = failed-action variant
  var undoPattern = /showUndoToast\(\s*[`'"]([^`'"]+)[`'"]/g;
  while ((match = undoPattern.exec(html)) !== null) {
    var msg = match[1] + " (+ Undo)";
    if (!seenToasts[msg]) {
      seenToasts[msg] = true;
      toasts.push({ message: msg, variant: "failed-action", isDemo: false });
    }
  }

  var dsComponents = [];
  function addDS(name) {
    if (dsComponents.indexOf(name) === -1) dsComponents.push(name);
  }
  if (/class\s*=\s*["'][^"']*\bdialog\b/.test(html)) addDS("Setting dialog");
  if (/class\s*=\s*["'][^"']*\btabs?\b/.test(html)) addDS("tab");
  if (/centered-state|class\s*=\s*["'][^"']*\bspinner\b/.test(html))
    addDS("System states");
  if (/class\s*=\s*["'][^"']*\bmodal\b|openModal/.test(html)) addDS("Modal");
  if (/class\s*=\s*["'][^"']*\btoast\b|showToast/.test(html)) addDS("Toast");
  if (/<input\b/.test(html)) addDS("input");
  if (/class\s*=\s*["'][^"']*\bbtn\b/.test(html)) addDS("Button");

  // Tabs — extract labels from <button class="tab" ...>Label</button>
  // and similar patterns so the build can rename "Tab" placeholders
  // inside the Setting dialog instance with the real names.
  // Skips entries with `tab-close` (and similar utility classes) so
  // the close button label doesn't end up as a tab name.
  var tabs = [];
  var seenTabs = {};
  var tabPatterns = [
    /<button[^>]*class\s*=\s*["'][^"']*\btab\b[^"']*["'][^>]*>([\s\S]*?)<\/button>/gi,
    /<a[^>]*class\s*=\s*["'][^"']*\btab\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<div[^>]*class\s*=\s*["'][^"']*\btab\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<li[^>]*class\s*=\s*["'][^"']*\btab\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
  ];
  for (var tp = 0; tp < tabPatterns.length; tp++) {
    var tabRe = tabPatterns[tp];
    while ((match = tabRe.exec(html)) !== null) {
      var classAttr = match[0].match(/class\s*=\s*["']([^"']+)["']/);
      var classes = classAttr ? classAttr[1] : "";
      // Skip utility variants — close buttons, icons, etc.
      if (/\btab-close\b|\btab-icon\b|\btab-spacer\b/.test(classes)) continue;
      // Strip nested tags from the label text.
      var raw = String(match[1] || "").replace(/<[^>]+>/g, "").trim();
      if (!raw || seenTabs[raw]) continue;
      seenTabs[raw] = true;
      tabs.push(raw);
    }
  }

  // data-ds-candidate annotations — HTML elements explicitly marked as
  // structures missing from the DS. Build creates one artboard per
  // distinct value. Authors add these annotations manually to mockups.
  var candidates = [];
  var seenCandidates = {};
  var candPattern = /data-ds-candidate\s*=\s*["']([^"']+)["']/g;
  while ((match = candPattern.exec(html)) !== null) {
    var candName = match[1].trim();
    if (!candName || seenCandidates[candName]) continue;
    seenCandidates[candName] = true;
    // v0.1: skip text extraction entirely — the regex-based capture
    // stops at the first descendant closing tag and frequently picks up
    // icon glyphs instead of the meaningful body. v0.2 should use a
    // proper DOM walker; D3 has fallback behavior for missing text.
    candidates.push({ name: candName, htmlText: "" });
  }

  // ============================================================
  // Pattern signature extraction (Phase H)
  // Scans HTML for every element with at least one class, computes a
  // "pattern signature" = tag + sorted (stripped) class list, dedupes,
  // counts instances. Phase H wires Screen 03 + mapping table + build
  // pipeline on top of this output.
  //
  // Utility classes are stripped before signature computation so layout
  // utilities (mr-*, text-*, flex, etc.) don't fragment signatures into
  // hundreds of false-distinct buckets. Convention list covers Tailwind
  // + Bootstrap. Future improvement: user-configurable allow list.
  // ============================================================

  var UTILITY_CLASS_PATTERNS = [
    // Spacing
    /^m[trblxy]?-/, /^p[trblxy]?-/, /^space-[xy]-/, /^gap-/,
    // Sizing
    /^w-/, /^h-/, /^max-w-/, /^min-w-/, /^max-h-/, /^min-h-/, /^size-/,
    // Typography (utility variants — semantic ones like .text-error stay)
    /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|left|center|right|justify)$/,
    /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|sans|serif|mono)$/,
    /^leading-/, /^tracking-/,
    // Color utility variants (.bg-blue-500). Keep semantic colors (.bg-error).
    /^bg-(red|blue|green|yellow|purple|pink|indigo|gray|slate|zinc|neutral|stone|orange|amber|lime|emerald|teal|cyan|sky|violet|fuchsia|rose)-/,
    /^text-(red|blue|green|yellow|purple|pink|indigo|gray|slate|zinc|neutral|stone|orange|amber|lime|emerald|teal|cyan|sky|violet|fuchsia|rose)-/,
    /^border-(red|blue|green|yellow|purple|pink|indigo|gray|slate|zinc|neutral|stone|orange|amber|lime|emerald|teal|cyan|sky|violet|fuchsia|rose)-/,
    // Flex/grid layout primitives
    /^flex(-|$)/, /^grid(-|$)/, /^col(-|$)/, /^row(-|$)/, /^justify-/, /^items-/, /^content-/, /^self-/,
    /^place-/, /^order-/,
    // Borders/rounded
    /^rounded(-|$)/, /^border(-|$)/, /^divide-/, /^ring-/,
    // Bootstrap-style utilities
    /^col-/, /^offset-/, /^d-/, /^m[trblxy]?-\d+$/, /^p[trblxy]?-\d+$/, /^mb-/, /^mt-/, /^ms-/, /^me-/, /^px-/, /^py-/,
    // Display + position
    /^block$/, /^inline$/, /^inline-block$/, /^hidden$/, /^absolute$/, /^relative$/, /^fixed$/, /^sticky$/, /^static$/,
    /^top-/, /^bottom-/, /^left-/, /^right-/, /^inset-/, /^z-/,
    // Hover/focus/responsive modifiers (Tailwind variants)
    /^(hover|focus|active|disabled|sm|md|lg|xl|2xl|dark|first|last|even|odd):/,
    // Common state utilities (.hidden, .active are kept because they're often semantic;
    // these are the obvious noise patterns):
    /^opacity-/, /^cursor-/, /^pointer-events-/, /^select-/, /^overflow(-|$)/, /^truncate$/,
    /^transition(-|$)/, /^duration-/, /^ease-/, /^transform$/, /^translate-/, /^rotate-/, /^scale-/,
    /^shadow(-|$)/, /^outline-/, /^appearance-/, /^resize(-|$)/,
  ];

  function isUtilityClass(cls) {
    if (!cls) return false;
    for (var i = 0; i < UTILITY_CLASS_PATTERNS.length; i++) {
      if (UTILITY_CLASS_PATTERNS[i].test(cls)) return true;
    }
    return false;
  }

  // Build dynamic-expression markers via fromCharCode so this source file's
  // brace count stays balanced. The smoke-parser test extracts parseHtml via
  // naive brace counting; literal braces inside string/regex would otherwise
  // throw off that count and pull extra code into the extracted body.
  var OPEN_BRACE = String.fromCharCode(123);
  var CLOSE_BRACE = String.fromCharCode(125);
  var DOLLAR_BRACE = "$" + OPEN_BRACE;
  var DOUBLE_BRACE = OPEN_BRACE + OPEN_BRACE;
  function computeSignature(tag, rawClassAttr) {
    if (!tag) return null;
    var classes = (rawClassAttr || "")
      .split(/\s+/)
      .filter(Boolean)
      .filter(function (c) {
        // Drop dynamic class expressions (e.g. $-brace-classes, double-brace
        // mustaches, [bg-red] arbitrary Tailwind values).
        if (c.indexOf(DOLLAR_BRACE) !== -1 || c.indexOf(DOUBLE_BRACE) !== -1) return false;
        // Drop arbitrary-value Tailwind classes like [bg-red] or [w-100px].
        if (c.charAt(0) === "[" && c.charAt(c.length - 1) === "]") return false;
        return true;
      })
      .filter(function (c) { return !isUtilityClass(c); });
    if (classes.length === 0) return null;
    classes.sort();
    return tag.toLowerCase() + "." + classes.join(".");
  }

  var patterns = {}; // signature → entry with signature, tag, classes, count, exampleText
  // Match every opening tag with a class attribute. We don't try to capture
  // the element's inner text via a backreference (that pattern only fires
  // once for the outermost <html>...</html>); instead, after matching an
  // open tag we slice forward to the next "<" to get a quick text snippet.
  var openTagPattern = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  var elMatch;
  // Skip script/style/meta and other non-semantic tags.
  var SKIP_TAGS = { script: 1, style: 1, link: 1, meta: 1, head: 1, title: 1, br: 1, hr: 1, img: 1, "!doctype": 1 };
  while ((elMatch = openTagPattern.exec(html)) !== null) {
    var tag = elMatch[1].toLowerCase();
    if (SKIP_TAGS[tag]) continue;
    var attrs = elMatch[2] || "";
    // Extract class attribute
    var classAttrMatch = /class\s*=\s*["']([^"']+)["']/.exec(attrs);
    if (!classAttrMatch) continue; // No class → no signature
    var sig = computeSignature(tag, classAttrMatch[1]);
    if (!sig) continue;
    if (!patterns[sig]) {
      // First occurrence — peek forward for a short text snippet (everything
      // up to the next "<" or 80 chars, whichever is shorter).
      var tagEnd = openTagPattern.lastIndex;
      var nextLt = html.indexOf("<", tagEnd);
      var snippetEnd = nextLt === -1 ? Math.min(tagEnd + 80, html.length) : Math.min(nextLt, tagEnd + 80);
      var textSnippet = html.slice(tagEnd, snippetEnd).replace(/\s+/g, " ").trim();
      var sigClasses = sig.split(".").slice(1);
      patterns[sig] = {
        signature: sig,
        tag: tag,
        classes: sigClasses,
        count: 0,
        exampleText: textSnippet,
      };
    }
    patterns[sig].count++;
  }

  // Convert to array, sort by count descending so most-frequent patterns
  // surface first in the UI.
  var patternList = Object.keys(patterns).map(function (k) { return patterns[k]; });
  patternList.sort(function (a, b) { return b.count - a.count; });

  // ============================================================
  // Per-state body element extraction (Phase H4-refactor)
  // For each parsed state, find the render function the dev-panel
  // switch calls for it, extract that function body, then walk the
  // body for pattern signatures.
  // Output is stateBodies indexed by state name; each entry is an
  // array of signature/tag/text rows.
  //
  // NOTE: this file is brace-sensitive (smoke-parser uses naive brace
  // counting to extract parseHtml). Any literal brace chars in
  // comments or strings must come in matched pairs, or be replaced
  // with the OPEN_BRACE / CLOSE_BRACE constants.
  // ============================================================

  var stateBodies = {};

  // Step A: map state name → render function name.
  //
  // HiNAS-style switch blocks set `state.page = 'X'` (and sometimes call
  // navigateToEdit) instead of directly returning a render function.
  // We scan each case body for clues:
  //   1. If the case body assigns `state.page = 'X'` → renderXPage
  //   2. Else if it calls `navigateToEdit(...)` → renderEditPage
  //   3. Else fallback to the first identifier after the colon
  //      (covers older `case 'X': return renderX(...)` style).
  // Render-function names are normalized to TitleCase + "Page" suffix
  // (e.g. 'list' → renderListPage). If the corresponding function
  // doesn't exist in the source, extraction falls back to no body.
  var stateToFunction = {};
  // Collect case start positions in declaration order so we can slice
  // each case body up to the next `case ` or closing of switch.
  var casePositions = [];
  var caseHeadRe = /case\s+['"]([^'"]+)['"]\s*:/g;
  var cm;
  while ((cm = caseHeadRe.exec(html)) !== null) {
    casePositions.push({ name: cm[1], start: cm.index, end: cm.index + cm[0].length });
  }
  function capitalize(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  for (var ci = 0; ci < casePositions.length; ci++) {
    var entry = casePositions[ci];
    var bodyStart = entry.end;
    var bodyEnd = ci + 1 < casePositions.length ? casePositions[ci + 1].start : Math.min(bodyStart + 4000, html.length);
    var caseBody = html.slice(bodyStart, bodyEnd);
    var fn = null;
    var pageM = /state\.page\s*=\s*['"]([a-zA-Z0-9-]+)['"]/.exec(caseBody);
    if (pageM) {
      fn = "render" + capitalize(pageM[1]) + "Page";
    } else if (/navigateToEdit\s*\(/.test(caseBody)) {
      fn = "renderEditPage";
    } else {
      var idM = /(?:return\s+)?([A-Za-z_]\w*)\s*\(/.exec(caseBody);
      if (idM) fn = idM[1];
    }
    if (fn) stateToFunction[entry.name] = fn;
  }

  // Regex special-character escape (used inside RegExp source strings).
  // Source must keep braces matched for the smoke-parser test; we
  // build the char class with `new RegExp` and the brace constants.
  var REGEX_SPECIAL_RE = new RegExp(
    "[" + "\\.\\*\\+\\?\\^\\$" + OPEN_BRACE + CLOSE_BRACE + "\\(\\)\\|\\[\\]\\\\]",
    "g"
  );
  function escapeRegExp(s) {
    return String(s).replace(REGEX_SPECIAL_RE, "\\$&");
  }

  // Step B: extract a function's body slice using brace counting.
  // We find the function-declaration start, locate the first opening
  // brace after the signature, then scan forward counting open/close
  // braces until depth returns to zero. Template-literal interpolations
  // are also brace-balanced, so plain counting handles them. Comments
  // and strings could in theory throw this off, but HiNAS-style render
  // functions are predictable enough for v0.1.
  function extractFunctionBody(fnName, source) {
    var esc = escapeRegExp(fnName);
    var headerRe = new RegExp(
      "(?:function\\s+" + esc + "\\s*\\(|const\\s+" + esc + "\\s*=\\s*(?:async\\s+)?(?:function\\s*)?\\()",
      ""
    );
    var hm = headerRe.exec(source);
    if (!hm) return null;
    // Find first open-brace after the header.
    var openIdx = source.indexOf(OPEN_BRACE, hm.index + hm[0].length);
    if (openIdx === -1) return null;
    var depth = 0;
    var i = openIdx;
    while (i < source.length) {
      var ch = source.charAt(i);
      if (ch === OPEN_BRACE) depth++;
      else if (ch === CLOSE_BRACE) {
        depth--;
        if (depth === 0) {
          return source.slice(openIdx + 1, i);
        }
      }
      i++;
    }
    return source.slice(openIdx + 1, Math.min(openIdx + 8000, source.length));
  }

  // Step C: walk a body string for elements with class signatures.
  function walkBodyElements(body) {
    if (!body) return [];
    var els = [];
    var SKIP_TAGS_BODY = { script: 1, style: 1, link: 1, meta: 1, head: 1, title: 1, br: 1, hr: 1, img: 1 };
    var elRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
    var em;
    while ((em = elRe.exec(body)) !== null) {
      var tagB = em[1].toLowerCase();
      if (SKIP_TAGS_BODY[tagB]) continue;
      var attrsB = em[2] || "";
      var clsM = /class\s*=\s*["']([^"']+)["']/.exec(attrsB);
      if (!clsM) continue;
      var sigB = computeSignature(tagB, clsM[1]);
      if (!sigB) continue;
      var afterIdx = em.index + em[0].length;
      var nextLt = body.indexOf("<", afterIdx);
      var snippet = body.slice(afterIdx, nextLt === -1 ? afterIdx + 80 : nextLt).trim().slice(0, 80);
      els.push({ signature: sigB, tag: tagB, text: snippet });
    }
    return els;
  }

  Object.keys(stateToFunction).forEach(function (state) {
    var fnName = stateToFunction[state];
    var body = extractFunctionBody(fnName, html);
    stateBodies[state] = body ? walkBodyElements(body) : [];
  });

  return {
    states: states,
    modals: modals,
    toasts: toasts,
    dsComponents: dsComponents,
    tabs: tabs,
    candidates: candidates,
    patterns: patternList,
    stateBodies: stateBodies,
  };
}

// ============================================================
// Build pipeline (spec §4.3 + §4.4)
// ------------------------------------------------------------
// Deterministic build: for each parsed state/modal/toast we
// create one artboard with the standard auto-layout scaffold
// (Tab → Title → body → Footer), drop in DS instances when
// applicable, and lay everything out on a 4×N grid.
//
// v0.1 limitations (intentional):
//   - Icons are skipped if the General icon component isn't
//     importable from the current file (library-only).
//   - Per-state internal visibility toggling on Setting dialog
//     is NOT done — the body is left as a clean scaffold for
//     the user to populate (or for v0.2+ Claude pass to fill).
//   - Text overrides apply to the scaffold text we create
//     (h1, tab label), not into DS instance internals.
// ============================================================

// Cancel flag — set by the UI's `cancel` message during a build.
// Checked at each artboard boundary in buildArtboards(); on detection,
// the build emits build-result.cancelled and returns immediately.
var _cancelRequested = false;

// Per-state DOM captures (Phase H8). Populated by the UI's `state-captures`
// message after parse-html succeeds. Each entry has the form
// {state, elements, screenshot: number[]|null, bodyWidth, bodyHeight}.
// Stored in module memory (NOT clientStorage) because screenshots can be
// multiple MB each; N states would blow the 5MB clientStorage cap.
// Build pipeline (Task H4-v2, later) reads from this.
var _stateCaptures = [];

// DS component keys (mirrors .claude/ds-manifest.json + runbook).
// Hard-coded for v0.1 per spec §4.6 ("Multi-DS support" is v0.4).
var DS_KEYS = {
  Button: "7c92ef0f897733a3d7404896249e5e87d3cb90ae",
  Modal: "62cf4b4cf7ca1f217b6f11f1aa333f23a5019e14",
  Toast: "126b94d2d5cf246c6deef2ad44c8ae5d6aaa179c",
  SystemStates: "8c2a8ec7fa065c3350a34754dd2dd2060260aeed",
  Input: "9ed9c5f4c6180f1286c442449ddc14cb95ca50f3",
  SettingDialog: "5ee6102f66df68ece4e12644c1319e1dff3fba38",
  Tab: "a053ad04e27497ae1e036f76c0e942401cf0dabd",
  Icons: "52e47bfd646912389f112962f9e098c9c565f213", // library-only; soft-fetch
};

// Grid constants (spec §4.2 / runbook Defaults table).
var ARTBOARD_W = 1120;
var ARTBOARD_H = 680;
var GRID_STRIDE_X = 1320;
var GRID_STRIDE_Y = 880;
var GRID_COLS = 4;
var BAND_X = 80;
var BAND_PADDING_TOP = 200;

// Map common HTML state keys → System states variant name.
// Anything not in this table is treated as a "content" state
// (no system-state instance, body uses MIN alignment).
var SYSTEM_STATE_MAP = {
  loading: "type=Loading state",
  loadingpage: "type=Loading state",
  empty: "type=Empty state",
  emptypage: "type=Empty state",
  error: "type=Error state",
  errorpage: "type=Error state",
};

// Modal-name → parent state (spec §4.2 lookup).
// Match is substring/case-insensitive on the modal function name.
var MODAL_PARENT_HINTS = [
  { test: /addprofile|add_profile|adduser/i, parent: "empty" },
  { test: /delete|remove/i, parent: "edit" },
  { test: /unsaved|discard|guard/i, parent: "edit dirty" },
  { test: /select|confirm/i, parent: "populated" },
];

// ---- Helpers --------------------------------------------------

// Strip filename suffixes ("-mockup", "-update", "-tab") and
// uppercase the remaining short token. Falls back to "Setting".
function deriveSection(filename) {
  if (!filename) return "Setting";
  var base = String(filename)
    .replace(/^.*[\\/]/, "")        // strip path
    .replace(/\.[^.]+$/, "");       // strip extension
  // Strip well-known suffix tokens
  base = base.replace(/-(mockup|update|tab|setting|settings)/gi, "");
  // Take the first remaining alpha token
  var match = base.match(/[a-zA-Z]+/);
  if (!match) return "Setting";
  var token = match[0];
  // Short token (≤4 chars) → uppercase as initialism (CCP, NMS).
  // Longer token → Title Case.
  if (token.length <= 4) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

// Compute the band origin: (80, ceil((maxY+200)/1000)*1000).
// maxY = bottom of every existing top-level node on the page.
function computeBandOrigin(page) {
  var maxY = 0;
  if (page && page.children) {
    for (var i = 0; i < page.children.length; i++) {
      var n = page.children[i];
      if (typeof n.y === "number" && typeof n.height === "number") {
        var bottom = n.y + n.height;
        if (bottom > maxY) maxY = bottom;
      }
    }
  }
  if (maxY === 0) return { x: BAND_X, y: BAND_X };
  var raw = maxY + BAND_PADDING_TOP;
  var rounded = Math.ceil(raw / 1000) * 1000;
  return { x: BAND_X, y: rounded };
}

// Detect system-state screens by name (loading/empty/error).
// Returns the System states variant name, or null for content states.
function systemStateVariant(stateName) {
  if (!stateName) return null;
  var key = String(stateName).toLowerCase().replace(/[^a-z]/g, "");
  // 1) Exact-key match (existing behavior)
  if (SYSTEM_STATE_MAP[key]) return SYSTEM_STATE_MAP[key];
  // 2) Fuzzy fallback — any state containing "error" / "loading" / "empty"
  //    in its name maps to that System states variant. Catches names like
  //    'select-error', 'edit-save-error', 'page-loading' that don't exactly
  //    match the canonical map keys.
  var lower = String(stateName).toLowerCase();
  if (lower.indexOf("error") !== -1) return "type=Error state";
  if (lower.indexOf("loading") !== -1) return "type=Loading state";
  if (lower.indexOf("empty") !== -1) return "type=Empty state";
  return null;
}

// Pick a parent state for a modal based on its function name.
// Returns the matched state from `states` or the first state.
function parentStateForModal(modalName, states) {
  if (!states || states.length === 0) return null;
  for (var i = 0; i < MODAL_PARENT_HINTS.length; i++) {
    var hint = MODAL_PARENT_HINTS[i];
    if (hint.test.test(modalName)) {
      var hintLower = hint.parent.toLowerCase();
      for (var j = 0; j < states.length; j++) {
        if (String(states[j]).toLowerCase().indexOf(hintLower) !== -1) {
          return states[j];
        }
      }
    }
  }
  return states[0];
}

// Hardcoded variant lists per DS component (mirror ds-manifest.json).
// Sent to the UI on parse-result so the mapping screen's dropdowns can
// offer the full set without re-importing each component there.
var VARIANT_LISTS = {
  systemStates: [
    "type=Loading state",
    "type=Empty state",
    "type=Error state",
  ],
  modal: [
    "type=Confirm",
    "type=input field",
    "type=file select",
  ],
  toast: [
    "width=compact, type=processing",
    "width=compact, type=success",
    "width=compact, type=failed",
    "width=compact, type=failed-action",
    "width=compact, type=failed 2",
    "width=compact, type=failed 2-action",
    "width=full, type=processing",
    "width=full, type=success",
    "width=full, type=failed",
    "width=full, type=failed-action",
    "width=full, type=failed 2",
    "width=full, type=failed 2-action",
  ],
};

// Build per-item variant suggestions from parsed data. The UI renders
// each row with the suggestion pre-selected; the user can confirm or
// change before clicking Build.
function computeVariantSuggestions(parsed) {
  parsed = parsed || {};
  var states = parsed.states || [];
  var modals = parsed.modals || [];
  var toasts = parsed.toasts || [];

  // System-state rows: only states that map to a System states variant
  // (loading/empty/error). Other states are content states with no
  // system-state instance.
  var systemRows = [];
  for (var s = 0; s < states.length; s++) {
    var sv = systemStateVariant(states[s]);
    if (sv) {
      systemRows.push({ state: states[s], suggested: sv });
    }
  }

  // Modal rows: one per parsed modal function call.
  // modals[m] is now an object { name, title, body } from parseHtml.
  var modalRows = [];
  for (var m = 0; m < modals.length; m++) {
    var modalObj = modals[m] || {};
    var modalName = String(modalObj.name || "").replace(/[()]/g, "");
    modalRows.push({
      name: modalName,
      title: modalObj.title || "",
      body: modalObj.body || "",
      suggested: modalVariantForName(modalName),
    });
  }

  // Toast rows: one per parsed toast.
  var toastRows = [];
  for (var t = 0; t < toasts.length; t++) {
    toastRows.push({
      message: toasts[t].message,
      variant: toasts[t].variant,
      isDemo: !!toasts[t].isDemo,
      suggested: toastVariantName(toasts[t]),
    });
  }

  return {
    systemStates: systemRows,
    modals: modalRows,
    toasts: toastRows,
  };
}

// Pick a Modal variant name based on the modal function's name.
// The Modal master has 3 variants: Confirm | input field | file select.
// add/new/create/edit modals likely contain text inputs → input field.
// select/file/choose/pick modals likely show a chooser → file select.
// Everything else (delete, unsaved guard, generic confirm) → Confirm.
function modalVariantForName(modalName) {
  var name = String(modalName || "").toLowerCase();
  if (/\b(file|browse|upload|attach)\b/.test(name)) return "type=file select";
  if (/\b(add|new|create|edit|rename)\b/.test(name)) return "type=input field";
  return "type=Confirm";
}

// Pick a Toast variant name from the parsed toast.
function toastVariantName(toast) {
  if (!toast) return "width=compact, type=success";
  var v = (toast.variant || "success").toLowerCase();
  // Long-error message threshold (spec §4.2). Over 80 chars → use "failed 2".
  var isLong = (toast.message || "").length > 80;
  if (v === "failed-action") {
    return isLong
      ? "width=compact, type=failed 2-action"
      : "width=compact, type=failed-action";
  }
  if (v === "error" || v === "failed" || v === "danger") {
    return isLong
      ? "width=compact, type=failed 2"
      : "width=compact, type=failed";
  }
  // success / default / processing / anything else → success
  if (v === "processing") return "width=compact, type=processing";
  return "width=compact, type=success";
}

// Soft-import a master component by key. Returns the
// component (variant) or null + reason on failure.
// Also handles single-COMPONENT keys (Setting dialog).
async function importMaster(key, variantName) {
  try {
    // Try as component set first.
    var set = await figma.importComponentSetByKeyAsync(key);
    if (variantName && set.children) {
      for (var i = 0; i < set.children.length; i++) {
        if (set.children[i].name === variantName) return set.children[i];
      }
      // Variant not found — return first variant + warning.
      return set.children[0] || null;
    }
    return set.defaultVariant || (set.children && set.children[0]) || null;
  } catch (eSet) {
    // Try as single component (Setting dialog).
    try {
      var comp = await figma.importComponentByKeyAsync(key);
      return comp;
    } catch (eComp) {
      return null;
    }
  }
}

// Walk an instance's children to find a TEXT node whose current
// characters match `oldChars` (or contain it case-insensitively).
// Returns null if none found. Used to retarget placeholder text
// (tab label, h1) inside an instantiated DS component.
function findTextByChars(node, oldChars) {
  if (node.type === "TEXT") {
    if (
      node.characters === oldChars ||
      String(node.characters || "").toLowerCase().indexOf(String(oldChars).toLowerCase()) !== -1
    ) {
      return node;
    }
  }
  if ("children" in node && node.children) {
    for (var i = 0; i < node.children.length; i++) {
      var found = findTextByChars(node.children[i], oldChars);
      if (found) return found;
    }
  }
  return null;
}

// Walk an instance to find a child Frame by name (case-insensitive
// substring match). Used to find the body / content area inside a
// Setting dialog instance so we can drop System states into it.
function findFrameByName(node, partialName) {
  var lower = String(partialName).toLowerCase();
  if (
    (node.type === "FRAME" || node.type === "INSTANCE") &&
    String(node.name || "").toLowerCase().indexOf(lower) !== -1
  ) {
    return node;
  }
  if ("children" in node && node.children) {
    for (var i = 0; i < node.children.length; i++) {
      var found = findFrameByName(node.children[i], partialName);
      if (found) return found;
    }
  }
  return null;
}

// Walk every visible descendant of `node` and return the true
// extent of all rendered content in node-local coordinates.
// Why: instances often have children that extend past their reported
// bounds (a "Contents" frame wider than its parent dialog, an X close
// button positioned at parent.width-N, etc.). `node.width` reports the
// node's own bounds, NOT the union of descendant bounds. We need the
// union so the wrapper artboard contains everything visible.
function computeContentExtent(node) {
  // Start the bounding box at the node's own bounds.
  var minX = 0;
  var minY = 0;
  var maxX = typeof node.width === "number" ? node.width : 0;
  var maxY = typeof node.height === "number" ? node.height : 0;

  function walk(n, offsetX, offsetY) {
    if (!n.visible) return;
    var x = (typeof n.x === "number" ? n.x : 0) + offsetX;
    var y = (typeof n.y === "number" ? n.y : 0) + offsetY;
    var w = typeof n.width === "number" ? n.width : 0;
    var h = typeof n.height === "number" ? n.height : 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
    if ("children" in n && n.children) {
      for (var i = 0; i < n.children.length; i++) {
        walk(n.children[i], x, y);
      }
    }
  }
  if ("children" in node && node.children) {
    for (var i = 0; i < node.children.length; i++) {
      walk(node.children[i], 0, 0);
    }
  }
  return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

// Build one artboard wrapper. Returns { artboard, dialog } where
// `dialog` is the Setting dialog instance (or null if not importable).
//
// We use the DS Setting dialog component as the screen chrome so
// the artboards inherit DS colors and typography. The wrapper frame
// gives us a stable parent for overlays (Modal, Toast) — instances
// can't take ABSOLUTE-positioned children, but a regular Frame can.
//
// IMPORTANT: createInstance() drops the new node onto the current
// page at (0,0). If we fail to re-parent it, it stays orphaned at
// the page origin — so any failure here MUST clean up the instance
// before re-throwing.
async function buildArtboardWithDialog(name) {
  var artboard = figma.createFrame();
  artboard.name = name;
  // Wrapper background is transparent — the Setting dialog provides
  // the visible screen background. White fill caused empty padding
  // when the dialog instance was smaller than the wrapper.
  artboard.fills = [];
  artboard.clipsContent = true;

  var dialog = null;
  var dialogComp = await importMaster(DS_KEYS.SettingDialog, null);
  if (dialogComp) {
    var dialogInst = dialogComp.createInstance();
    try {
      artboard.appendChild(dialogInst);
      dialogInst.x = 0;
      dialogInst.y = 0;
      // Do NOT resize the dialog. Earlier we tried to force it to a
      // hardcoded spec target (ARTBOARD_W/ARTBOARD_H = 1120×680), but
      // the master's actual width is whatever the designer authored
      // (e.g. 1200). Forcing it smaller breaks internal HUG-sized
      // children that were laid out for the master's natural width —
      // a 1152-wide internal frame ends up overflowing a 1120 wrapper.
      // Trust the master's size and let the wrapper grow to fit it.

      // Compute the TRUE extent of all visible content inside the
      // dialog. Catches children that overflow the dialog's reported
      // bounds (X close button at parent.width-N, etc.) so the wrapper
      // is sized to contain everything visible.
      var ext = computeContentExtent(dialogInst);
      var w = Math.max(1, Math.round(ext.maxX - ext.minX));
      var h = Math.max(1, Math.round(ext.maxY - ext.minY));
      artboard.resize(w, h);
      // If any descendant sat at negative x/y relative to the dialog
      // (overflow on the left or top), shift the dialog so that ext.min*
      // aligns with the wrapper origin — every visible bit now lives
      // inside the wrapper.
      if (ext.minX < 0) dialogInst.x = -ext.minX;
      if (ext.minY < 0) dialogInst.y = -ext.minY;

      // Match the wrapper's bg to the dialog's bg so any small gap
      // between dialog.width and the visible body still reads as one
      // continuous surface (carries library color-variable bindings).
      try {
        if (dialogInst.fills && dialogInst.fills.length) {
          artboard.fills = dialogInst.fills;
        }
      } catch (e) {}
      dialog = dialogInst;
    } catch (eAppend) {
      // Orphan cleanup — see comment at top of function.
      try { dialogInst.remove(); } catch (_) {}
      // Wrapper is empty: at least give it the spec size so the grid
      // still slots correctly.
      artboard.resize(ARTBOARD_W, ARTBOARD_H);
      artboard.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    }
  } else {
    // No dialog — fall back to a plain white wrapper at spec size.
    artboard.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    artboard.resize(ARTBOARD_W, ARTBOARD_H);
  }

  return { artboard: artboard, dialog: dialog };
}

// Safely create an instance of a DS master and overlay it on a host
// frame at the given position. Cleans up the orphan if appendChild
// fails — preventing the "stray instance at page (0,0)" bug.
async function safeOverlayInstance(host, key, variantName, x, y) {
  var comp = await importMaster(key, variantName);
  if (!comp) return { ok: false, reason: "master not importable" };
  var inst = comp.createInstance();
  try {
    host.appendChild(inst);
    inst.x = Math.round(x);
    inst.y = Math.round(y);
    return { ok: true, instance: inst };
  } catch (e) {
    // Orphan cleanup — never leave the new instance at page (0,0).
    try { inst.remove(); } catch (_) {}
    return { ok: false, reason: e.message || String(e) };
  }
}

// Convert a modal function name like "openSelectConfirmModal" into a
// human-readable title like "Select Confirm". Strips the "open" prefix
// and the trailing "Modal"/"Confirm" suffix (when redundant), then
// splits CamelCase into spaced words. Used as a fallback modal title
// until the parser captures real modal title/body text from HTML.
function humanizeModalName(name) {
  if (!name) return "Modal";
  var s = String(name).replace(/\(\)\s*$/, ""); // strip trailing "()"
  s = s.replace(/^open/, ""); // strip "open" prefix
  s = s.replace(/Modal$/, ""); // strip "Modal" suffix
  // Split CamelCase: insert a space before each capital that follows
  // a lowercase letter or another capital followed by a lowercase.
  s = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  s = s.replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
  s = s.trim();
  return s || "Modal";
}

// Walk an instance and collect ALL text nodes whose current characters
// (case-insensitively, exact or stripped) match `placeholder`. Used
// to retarget every "Tab" placeholder in the Setting dialog (the
// previous one-shot find caused 5 of 6 tabs to stay literally "Tab").
function findAllTextByChars(node, placeholder) {
  var out = [];
  function walk(n) {
    if (n.type === "TEXT") {
      var current = String(n.characters || "").trim();
      if (current.toLowerCase() === String(placeholder).toLowerCase()) {
        out.push(n);
      }
    }
    if ("children" in n && n.children) {
      for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
    }
  }
  walk(node);
  return out;
}

// Try to retarget the visible labels inside a Setting dialog instance.
// `tabs` is the parsed list of tab labels from the HTML (in order);
// when present, every "Tab" placeholder gets a real label assigned by
// position. When tabs is empty, we fall back to repeating the section
// name (so at least nothing reads "Tab Tab Tab Tab Tab").
async function retargetDialogLabels(dialog, section, stateLabel, tabs) {
  if (!dialog) return;
  tabs = tabs || [];

  // --- Tab labels: retarget every "Tab" placeholder, in document order
  var tabNodes = findAllTextByChars(dialog, "Tab");
  for (var i = 0; i < tabNodes.length; i++) {
    var label = tabs[i] || tabs[tabs.length - 1] || section || "Tab";
    try {
      await figma.loadFontAsync(tabNodes[i].fontName);
      tabNodes[i].characters = label;
    } catch (e) {}
  }
  // The first tab in the dialog master might be named "CCP" (or
  // whatever the original section was) instead of "Tab". Retarget
  // any leftover hardcoded section name to the parsed first tab.
  if (tabs.length > 0) {
    var sectionNodes = findAllTextByChars(dialog, "CCP");
    for (var s = 0; s < sectionNodes.length; s++) {
      try {
        await figma.loadFontAsync(sectionNodes[s].fontName);
        sectionNodes[s].characters = tabs[0];
      } catch (e) {}
    }
  }

  // --- Title / h1 — substring match still works (placeholder text
  // is usually unique). Replace with the current state label.
  var titleCandidates = ["Title", "Heading", "Place holding text"];
  for (var j = 0; j < titleCandidates.length; j++) {
    var tn = findTextByChars(dialog, titleCandidates[j]);
    if (tn) {
      try {
        await figma.loadFontAsync(tn.fontName);
        tn.characters = stateLabel;
      } catch (e) {}
      break;
    }
  }
}

// Walk an instance and collect samples of its text styles + bg fill.
// We use these samples to "borrow" the file's library bindings for
// any text/frames we create from scratch (candidate cards, band header).
// By copying textStyleId / fills from real DS-styled nodes, our new
// nodes inherit the library text styles + variable color bindings.
function collectStyleSamples(rootInstance) {
  if (!rootInstance) return null;
  var texts = [];
  function walk(node) {
    if (node.type === "TEXT") texts.push(node);
    if ("children" in node && node.children) {
      for (var i = 0; i < node.children.length; i++) walk(node.children[i]);
    }
  }
  walk(rootInstance);
  if (texts.length === 0) {
    return { title: null, body: null, caption: null, bgFills: rootInstance.fills || null };
  }
  // Sort by font size (descending). Largest = title; smallest = caption.
  texts.sort(function (a, b) {
    var aS = typeof a.fontSize === "number" ? a.fontSize : 0;
    var bS = typeof b.fontSize === "number" ? b.fontSize : 0;
    return bS - aS;
  });
  var title = texts[0];
  var body = texts[Math.floor(texts.length / 2)];
  var caption = texts[texts.length - 1];
  return {
    title: snapshotTextStyle(title),
    body: snapshotTextStyle(body),
    caption: snapshotTextStyle(caption),
    bgFills: rootInstance.fills && rootInstance.fills.length ? rootInstance.fills : null,
  };
}

// Snapshot a text node's style fields so we can reapply them later.
// We capture both the textStyleId (preserves library binding) AND the
// concrete font/size/color (used as a fallback when the style ID isn't
// resolvable on a freshly-created node).
function snapshotTextStyle(node) {
  if (!node) return null;
  var snap = {};
  try { snap.textStyleId = node.textStyleId || ""; } catch (e) {}
  try { snap.fontName = node.fontName; } catch (e) {}
  try { snap.fontSize = node.fontSize; } catch (e) {}
  try { snap.lineHeight = node.lineHeight; } catch (e) {}
  try { snap.letterSpacing = node.letterSpacing; } catch (e) {}
  try { snap.fills = node.fills; } catch (e) {}
  return snap;
}

// Apply a snapshot to a target text node. Loads the font first so
// font + characters writes don't throw. Tries the textStyleId path
// first (keeps library binding); if that fails, falls back to the
// concrete font/size/color values.
async function applyTextStyle(target, snap) {
  if (!target || !snap) return;
  // Load the source font if available (needed before changing fontName
  // OR before assigning a textStyleId whose font isn't loaded).
  if (snap.fontName) {
    try { await figma.loadFontAsync(snap.fontName); } catch (e) {}
  }
  // Path A: try to bind the library text style directly.
  if (snap.textStyleId) {
    try {
      // The async setter is the modern API; older sandboxes accept the
      // direct property assignment too. Try both forms.
      if (typeof target.setRangeTextStyleIdAsync === "function") {
        await target.setRangeTextStyleIdAsync(0, target.characters.length, snap.textStyleId);
      } else {
        target.textStyleId = snap.textStyleId;
      }
      // Style applied — fills may also be controlled by the style;
      // skip the literal copy below to avoid breaking the binding.
      return;
    } catch (e) {
      // Fall through to concrete-property copy.
    }
  }
  // Path B: copy concrete font + size + color values.
  try { if (snap.fontName) target.fontName = snap.fontName; } catch (e) {}
  try { if (typeof snap.fontSize === "number") target.fontSize = snap.fontSize; } catch (e) {}
  try { if (snap.lineHeight) target.lineHeight = snap.lineHeight; } catch (e) {}
  try { if (snap.letterSpacing) target.letterSpacing = snap.letterSpacing; } catch (e) {}
  try { if (snap.fills) target.fills = snap.fills; } catch (e) {}
}

// ---- Main orchestrator ---------------------------------------

async function buildArtboards(payload) {
  _cancelRequested = false;
  // Load persisted candidate-to-DS-component mappings (set via the
  // per-candidate "Pick DS component" flow in Screen M). Used in the
  // DS Candidates band loop below to instantiate the real DS component
  // instead of the placeholder screenshot frame.
  var candidateMappings = (await figma.clientStorage.getAsync(fileScoped("candidateMappings"))) || {};
  // Persisted manual rescue matches (E4): array of
  //   { name, componentKey, componentName, htmlText }
  // One artboard per entry is emitted in a "Matched elements" band
  // after the DS Candidates band below.
  var manualMatches = (await figma.clientStorage.getAsync(fileScoped("manualMatches"))) || [];
  // Persisted pattern→DS-component mappings (H3): signature →
  // { componentKey, componentName, variantName }. Phase H4-refactor
  // instantiates one DS instance per matching HTML element inside each
  // content-state's dialog body (no separate showcase band).
  var patternMappings = (await figma.clientStorage.getAsync(fileScoped("patternMappings"))) || {};
  var parsed = (payload && payload.parsed) || {};
  var filename = (payload && payload.filename) || "";
  var states = parsed.states || [];
  var modals = parsed.modals || [];
  var toasts = parsed.toasts || [];
  var tabs = parsed.tabs || [];
  // User's variant choices from Screen 03's mapping dropdowns. Each
  // overrides the corresponding name-based heuristic. Shape:
  //   { systemStates: {stateName: variant}, modal: {fnName: variant}, toast: {message: variant} }
  var variantChoices = (payload && payload.variantChoices) || null;
  function pickVariant(kind, key, fallback) {
    if (variantChoices && variantChoices[kind] && variantChoices[kind][key]) {
      return variantChoices[kind][key];
    }
    return fallback;
  }

  // 1. Resolve target page
  var targetName =
    (await figma.clientStorage.getAsync(fileScoped("targetPageName"))) || "Claude output";
  var targetPage = null;
  for (var p = 0; p < figma.root.children.length; p++) {
    if (figma.root.children[p].name === targetName) {
      targetPage = figma.root.children[p];
      break;
    }
  }
  if (!targetPage) {
    targetPage = figma.createPage();
    targetPage.name = targetName;
  }
  await figma.setCurrentPageAsync(targetPage);

  // 2. Preload fonts (text overrides + scaffold text need these)
  try {
    await Promise.all([
      figma.loadFontAsync({ family: "Inter", style: "Regular" }),
      figma.loadFontAsync({ family: "Inter", style: "Medium" }),
    ]);
  } catch (e) {
    // Font may not be available — fall back to default font silently.
  }

  // 3. Plan artboards
  var section = deriveSection(filename);
  var plan = [];
  for (var s = 0; s < states.length; s++) {
    plan.push({
      kind: "state",
      stateName: states[s],
      name: "Setting - " + section + " - " + states[s],
    });
  }
  for (var m = 0; m < modals.length; m++) {
    // modals[m] is now an object { name, title, body }.
    var modalObj = modals[m] || {};
    var modalLabel = String(modalObj.name || "").replace(/[()]/g, "");
    plan.push({
      kind: "modal",
      modalName: modalLabel,
      modalTitle: modalObj.title || "",
      modalBody: modalObj.body || "",
      stateName: parentStateForModal(modalLabel, states) || "Edit",
      name: "Setting - " + section + " - Modal " + modalLabel,
    });
  }
  for (var t = 0; t < toasts.length; t++) {
    var toast = toasts[t];
    var label = (toast.message || "").slice(0, 32);
    plan.push({
      kind: "toast",
      toast: toast,
      stateName: states[0] || "Default",
      name: "Setting - " + section + " - Toast " + label,
    });
  }

  // Always emit at least an initial progress so UI knows we started
  figma.ui.postMessage({
    type: "progress",
    phase: "start",
    total: plan.length,
    section: section,
  });

  if (plan.length === 0) {
    figma.ui.postMessage({
      type: "build-result",
      ok: false,
      error:
        "Nothing to build — parsed HTML produced 0 states, 0 modals, 0 toasts.",
    });
    return;
  }

  // 4. Compute band origin (after target page is resolved)
  var origin = computeBandOrigin(targetPage);

  // 5. Build each artboard
  var counts = { states: 0, modals: 0, toasts: 0, candidates: 0, warnings: 0, patterns: 0 };
  var warnings = [];
  var createdNodes = [];

  // After the first dialog instance is built, we sample its text styles
  // + bg fill so we can borrow the file's library text-style bindings
  // for the candidate cards + band header. Populated once, reused.
  var sampledStyles = null;

  for (var i = 0; i < plan.length; i++) {
    if (_cancelRequested) {
      figma.ui.postMessage({
        type: "build-result",
        ok: false,
        cancelled: true,
        counts: counts,
      });
      return;
    }
    // Yield to event loop so a `cancel` message posted between iterations
    // can be processed before we start the next artboard.
    await new Promise(function (r) { setTimeout(r, 0); });
    var spec = plan[i];
    var col = i % GRID_COLS;
    var row = Math.floor(i / GRID_COLS);
    var x = origin.x + col * GRID_STRIDE_X;
    var y = origin.y + row * GRID_STRIDE_Y;

    figma.ui.postMessage({
      type: "progress",
      phase: "building",
      index: i,
      total: plan.length,
      name: spec.name,
    });

    try {
      var sysVariant = pickVariant(
        "systemStates",
        spec.stateName,
        systemStateVariant(spec.stateName)
      );
      var artboard;
      var dialog = null;

      // Branch A: system-state screens (loading/empty/error) — build
      // with the SAME Setting dialog wrapper as content states so they
      // share header/tabs chrome. Then drop the System states component
      // into the dialog body and hide the default body children to
      // avoid visual overlap with the dialog's own empty-state content.
      if (sysVariant) {
        var built = await buildArtboardWithDialog(spec.name);
        if (!built || !built.artboard) {
          warnings.push(spec.name + ": Setting dialog wrapper failed to build");
          counts.warnings++;
          // Fall through to bare-frame fallback so the artboard still slots.
          artboard = figma.createFrame();
          artboard.name = spec.name;
          artboard.fills = [];
          artboard.clipsContent = true;
          artboard.resize(ARTBOARD_W, ARTBOARD_H);
          targetPage.appendChild(artboard);
          artboard.x = x;
          artboard.y = y;
        } else {
          artboard = built.artboard;
          dialog = built.dialog;
          targetPage.appendChild(artboard);
          artboard.x = x;
          artboard.y = y;

          // Find the dialog body (the "body" or content frame inside the
          // dialog) and replace its default contents with the System
          // states component.
          var dialogBody = dialog
            ? (dialog.findOne(function (n) {
                return n.type === "FRAME" && /^body$/i.test(n.name);
              }) || dialog.findOne(function (n) {
                return n.type === "FRAME" && /content/i.test(n.name);
              }))
            : null;
          if (dialogBody) {
            // Hide existing body children so they don't show through behind
            // the System states overlay we add to the artboard below.
            for (var bi = 0; bi < dialogBody.children.length; bi++) {
              try { dialogBody.children[bi].visible = false; } catch (eVis) {}
            }
          }

          // Append System states to the ARTBOARD (not dialogBody) — the dialog
          // body is typically an auto-layout frame where inst.x/y is a no-op,
          // causing the centering math to silently fail. The artboard is a
          // plain frame; the System states will render above the dialog in
          // z-order and we can center it freely.
          var sysRes = await safeOverlayInstance(
            artboard,
            DS_KEYS.SystemStates,
            sysVariant,
            0, 0
          );
          if (sysRes.ok && sysRes.instance) {
            // Mark it ABSOLUTE-positioned so any auto-layout inheritance from
            // the artboard (rare but possible) doesn't override our centering.
            try { sysRes.instance.layoutPositioning = "ABSOLUTE"; } catch (eLP) {}
            var siW = sysRes.instance.width;
            var siH = sysRes.instance.height;
            sysRes.instance.x = Math.round((artboard.width - siW) / 2);
            sysRes.instance.y = Math.round((artboard.height - siH) / 2);
          } else {
            warnings.push(spec.name + ": System states overlay — " + (sysRes.reason || "unknown"));
            counts.warnings++;
          }

          // Retarget the dialog labels (title, tabs) so the wrapper
          // reads as the same section/state as content-state screens.
          if (dialog) {
            try {
              await retargetDialogLabels(dialog, section, spec.stateName, tabs);
            } catch (eR) {
              // non-fatal: label retarget failure shouldn't block build.
            }
            if (!sampledStyles) {
              sampledStyles = collectStyleSamples(dialog);
            }
          }
        }
      } else {
        // Branch B: content states + modal/toast carriers — build with
        // Setting dialog as the screen chrome.
        // Surface a debug warning so the user can see WHY a state was
        // treated as content (no system-state overlay). Helps debug
        // mismatches against SYSTEM_STATE_MAP / fuzzy fallback.
        warnings.push(spec.name + ": treated as content state (no system-state variant matched for '" + spec.stateName + "')");
        var built = await buildArtboardWithDialog(spec.name);
        artboard = built.artboard;
        dialog = built.dialog;
        targetPage.appendChild(artboard);
        artboard.x = x;
        artboard.y = y;

        if (!dialog) {
          warnings.push(spec.name + ": Setting dialog master not importable");
          counts.warnings++;
        } else {
          // Best-effort: retarget tab + title placeholders to this state.
          await retargetDialogLabels(dialog, section, spec.stateName, tabs);
          if (!sampledStyles) {
            sampledStyles = collectStyleSamples(dialog);
          }

          // The Setting dialog master ships with a default empty-state body
          // ("No profile ID is found / Add Profile"). For content states
          // (edit, edit-dirty, edit-invalid, populated), we don't want
          // that default content showing through — Phase G will fill the
          // body with per-element DS components based on the HTML. For
          // now, hide the master's default body children so the artboard
          // reads as an intentionally-blank content slot.
          // Mirrors the system-state branch above (lines ~1060-1073).
          var dialogBodyContent = dialog.findOne(function (n) {
            return n.type === "FRAME" && /^body$/i.test(n.name);
          }) || dialog.findOne(function (n) {
            return n.type === "FRAME" && /content/i.test(n.name);
          });
          if (dialogBodyContent) {
            for (var bi2 = 0; bi2 < dialogBodyContent.children.length; bi2++) {
              try { dialogBodyContent.children[bi2].visible = false; } catch (eVis2) {}
            }
          }

          // Phase H4-v2: populate dialog body with pattern-mapped DS instances
          // using the per-state DOM capture from H8 (stored in _stateCaptures).
          // Elements come with bounding boxes from the actual rendered DOM,
          // so we can place them in approximate position rather than auto-layout
          // stack. Pixel-perfect layout is v0.2+ (would need CSS-flexbox→Figma
          // auto-layout translation).
          var stateName_h4v2 = spec.stateName;
          var stateCapture = null;
          if (_stateCaptures && _stateCaptures.length > 0) {
            for (var sc = 0; sc < _stateCaptures.length; sc++) {
              if (_stateCaptures[sc].state === stateName_h4v2) {
                stateCapture = _stateCaptures[sc];
                break;
              }
            }
          }

          // Phase H4-v2: embed the captured state screenshot as the dialog
          // body's background fill. Designer sees the COMPLETE rendered page;
          // pattern-mapped DS components are overlaid on top at their
          // bounding-box positions. Unmapped elements remain visually present
          // via the screenshot — designer fills them in manually after build.
          if (stateCapture && stateCapture.screenshot && stateCapture.screenshot.length > 0 && dialogBodyContent) {
            try {
              // Convert number[] back to Uint8Array for figma.createImage
              var pngBytes = new Uint8Array(stateCapture.screenshot);
              var img = figma.createImage(pngBytes);
              dialogBodyContent.fills = [{
                type: "IMAGE",
                scaleMode: "FIT",
                imageHash: img.hash,
              }];
            } catch (eImgFill) {
              warnings.push(stateName_h4v2 + ": failed to embed screenshot — " + (eImgFill.message || String(eImgFill)));
              counts.warnings++;
            }
          }

          if (stateCapture && stateCapture.elements) {
            // H4-v2 diagnostic — surface mapping coverage for this state.
            var mappedCount = 0;
            var unmappedSigs = {};
            for (var di = 0; di < stateCapture.elements.length; di++) {
              var dsig = stateCapture.elements[di].signature;
              if (patternMappings[dsig]) {
                mappedCount++;
              } else if (!unmappedSigs[dsig]) {
                unmappedSigs[dsig] = true;
              }
            }
            var mappingsCount = Object.keys(patternMappings).length;
            if (mappingsCount > 0 && mappedCount === 0) {
              // Likely signature mismatch — surface top 5 captured signatures
              // and top 5 mapped signatures so user can see the gap.
              var capturedTop = Object.keys(unmappedSigs).slice(0, 5);
              var mappedTop = Object.keys(patternMappings).slice(0, 5);
              warnings.push(stateName_h4v2 + ": 0 of " + stateCapture.elements.length + " captured elements matched any of " + mappingsCount + " pattern mappings. Captured sigs (first 5): " + capturedTop.join(" | ") + ". Mapped sigs (first 5): " + mappedTop.join(" | "));
              counts.warnings++;
            }
          }

          if (stateCapture && stateCapture.elements && stateCapture.elements.length > 0 && dialogBodyContent) {
            // For positioning: scale captured bounding boxes to fit inside the
            // dialog body. We use the CAPTURED viewport size (bodyWidth/Height)
            // as the source dimensions.
            var srcW = stateCapture.bodyWidth || 1200;
            var srcH = stateCapture.bodyHeight || 800;
            var dstW = dialogBodyContent.width || ARTBOARD_W;
            var dstH = dialogBodyContent.height || ARTBOARD_H;
            var scaleX = dstW / srcW;
            var scaleY = dstH / srcH;
            // Use the smaller scale to preserve aspect ratio
            var scale = Math.min(scaleX, scaleY);

            // Find every element with a pattern mapping
            for (var ei = 0; ei < stateCapture.elements.length; ei++) {
              if (_cancelRequested) break;
              var el = stateCapture.elements[ei];
              var mapping = patternMappings[el.signature];
              if (!mapping || !mapping.componentKey) continue;

              try {
                var elComp = await resolveDsComponent(mapping);
                if (!elComp) {
                  warnings.push(stateName_h4v2 + ": could not resolve " + (mapping.componentName || mapping.componentKey || "component") + " for " + el.signature + " (tried id/key/name)");
                  counts.warnings++;
                  continue;
                }
                var elInst = elComp.createInstance();
                dialogBodyContent.appendChild(elInst);
                if (!elInst.visible) {
                  try { elInst.visible = true; } catch (eVis) {}
                }
                // Position relative to dialog body using scaled bounding box.
                // The captured x/y are in iframe viewport coords; the dialog
                // body's content area starts at (0, 0) in its local space.
                try { elInst.layoutPositioning = "ABSOLUTE"; } catch (eLP) {}
                var localX = Math.round(el.x * scale);
                var localY = Math.round(el.y * scale);
                elInst.x = localX;
                elInst.y = localY;

                // Apply text override from captured text content
                if (el.text) {
                  try {
                    var textNodes = elInst.findAll(function (n) { return n.type === "TEXT"; });
                    if (textNodes && textNodes.length > 0) {
                      await figma.loadFontAsync(textNodes[0].fontName);
                      textNodes[0].characters = el.text.slice(0, 200);
                    }
                  } catch (eText) {}
                }

                counts.patterns = (counts.patterns || 0) + 1;
              } catch (eImport) {
                warnings.push(stateName_h4v2 + ": " + (eImport.message || String(eImport)));
                counts.warnings++;
              }
            }
          }
        }
      }

      // Use the wrapper's actual size for overlay positioning.
      var wW = artboard.width;
      var wH = artboard.height;

      // Modal overlay (centered). Variant prefers user choice from the
      // mapping screen; falls back to modal-name heuristic.
      if (spec.kind === "modal") {
        var modalVariant = pickVariant(
          "modal",
          spec.modalName || spec.name,
          modalVariantForName(spec.modalName || spec.name)
        );
        var modalComp = await importMaster(DS_KEYS.Modal, modalVariant);
        if (modalComp) {
          var mW = modalComp.width || 0;
          var mH = modalComp.height || 0;
          var modalRes = await safeOverlayInstance(
            artboard,
            DS_KEYS.Modal,
            modalVariant,
            (wW - mW) / 2,
            (wH - mH) / 2
          );
          if (!modalRes.ok) {
            warnings.push(spec.name + ": Modal overlay — " + modalRes.reason);
            counts.warnings++;
          } else if (modalRes.instance) {
            // Title: prefer parsed title from HTML (Issue 3 — parser now
            // captures title/body from openModal('Title','Body',...) calls
            // or <h*>+<p> template literals). Falls back to humanized
            // function name when the parser couldn't extract a title.
            try {
              var humanTitle = spec.modalTitle || humanizeModalName(spec.modalName || spec.name);
              var titlePlaceholders = ["Place holding text", "Title", "Heading"];
              var titleNode = null;
              for (var pj = 0; pj < titlePlaceholders.length; pj++) {
                titleNode = findTextByChars(modalRes.instance, titlePlaceholders[pj]);
                if (titleNode) break;
              }
              if (titleNode) {
                try {
                  await figma.loadFontAsync(titleNode.fontName);
                  titleNode.characters = humanTitle;
                } catch (eTxt) {}
              }

              // Body override (Issue 3): if the parser captured body text,
              // find a SECOND placeholder text node (after the title) and
              // override it. The Modal master typically has 2 such nodes —
              // title + body. We collect all placeholders, skip the title
              // node we just wrote, and write the body into the next one.
              if (spec.modalBody) {
                var allPlaceholders = [];
                for (var pk = 0; pk < titlePlaceholders.length; pk++) {
                  var hits = findAllTextByChars(modalRes.instance, titlePlaceholders[pk]);
                  for (var hj = 0; hj < hits.length; hj++) allPlaceholders.push(hits[hj]);
                }
                var bodyNode = null;
                for (var bp = 0; bp < allPlaceholders.length; bp++) {
                  if (allPlaceholders[bp] !== titleNode) {
                    bodyNode = allPlaceholders[bp];
                    break;
                  }
                }
                if (bodyNode) {
                  try {
                    await figma.loadFontAsync(bodyNode.fontName);
                    bodyNode.characters = spec.modalBody;
                  } catch (eBodyTxt) {}
                } else {
                  warnings.push(spec.name + ": Modal body text parsed ('" + spec.modalBody.slice(0, 40) + "...') but no second placeholder text node found in the master to override.");
                  counts.warnings++;
                }
              }
            } catch (eModalText) { /* non-fatal */ }
          }
        } else {
          warnings.push(spec.name + ": Modal master not importable");
          counts.warnings++;
        }
      }

      // Toast overlay (center-bottom, 24px above bottom edge).
      // Variant prefers user choice from mapping screen; falls back to
      // message+variant heuristic.
      if (spec.kind === "toast") {
        var toastKey = spec.toast && spec.toast.message;
        var toastVariant = pickVariant(
          "toast",
          toastKey,
          toastVariantName(spec.toast)
        );
        var toastComp = await importMaster(DS_KEYS.Toast, toastVariant);
        if (toastComp) {
          var tW = toastComp.width || 0;
          var tH = toastComp.height || 0;
          var toastRes = await safeOverlayInstance(
            artboard,
            DS_KEYS.Toast,
            toastVariant,
            (wW - tW) / 2,
            wH - tH - 24
          );
          if (!toastRes.ok) {
            warnings.push(spec.name + ": Toast overlay — " + toastRes.reason);
            counts.warnings++;
          }
        } else {
          warnings.push(spec.name + ": Toast master not importable");
          counts.warnings++;
        }
      }

      createdNodes.push(artboard);
      if (spec.kind === "state") counts.states++;
      else if (spec.kind === "modal") counts.modals++;
      else if (spec.kind === "toast") counts.toasts++;
    } catch (err) {
      warnings.push(spec.name + ": " + (err.message || String(err)));
      counts.warnings++;
    }
  }

  // 6. DS Candidates band — embed user-supplied screenshots.
  // For each candidate that the user attached a screenshot to, we
  // create a named frame in the band with the image as a FIT-scaled
  // image fill. Candidates without a screenshot are skipped (the
  // band header still notes how many were flagged total).
  // candidates is now an array of { name, imageBytes (Uint8Array | null) }.
  var candidates = (payload && payload.candidates) || [];
  var candidatesWithImages = [];
  for (var ck = 0; ck < candidates.length; ck++) {
    var c = candidates[ck];
    if (c && c.imageBytes && c.imageBytes.length > 0) {
      candidatesWithImages.push(c);
    }
  }
  var candidateBandY =
    origin.y + Math.ceil(plan.length / GRID_COLS) * GRID_STRIDE_Y + BAND_PADDING_TOP;
  var candidateNodes = [];

  // Header label — adapts based on how many candidates have screenshots.
  var bandLabel = figma.createText();
  try {
    await figma.loadFontAsync({ family: "Inter", style: "Medium" });
    bandLabel.fontName = { family: "Inter", style: "Medium" };
  } catch (e) {}
  var labelText;
  if (candidates.length === 0) {
    labelText = "DS Candidates — none flagged";
  } else if (candidatesWithImages.length === 0) {
    labelText =
      "DS Candidates — " + candidates.length +
      " flagged · use 'Pick element' on Screen 03 to capture each from the HTML";
  } else {
    labelText =
      "DS Candidates — " + candidatesWithImages.length +
      " of " + candidates.length + " captured from HTML";
  }
  bandLabel.characters = labelText;
  bandLabel.fontSize = 24;
  if (sampledStyles && sampledStyles.title) {
    await applyTextStyle(bandLabel, sampledStyles.title);
    try { bandLabel.fontSize = 24; } catch (e) {}
  }
  bandLabel.x = BAND_X;
  bandLabel.y = candidateBandY;
  targetPage.appendChild(bandLabel);

  // Lay out candidate frames on a 4×N grid below the header label.
  var CAND_W = 480;
  var CAND_H = 320;
  var CAND_GAP_X = 40;
  var CAND_GAP_Y = 80; // extra room for the title above each frame
  var CAND_COLS = 3;
  var candidateOriginY = candidateBandY + 80;

  for (var ci = 0; ci < candidatesWithImages.length; ci++) {
    if (_cancelRequested) {
      counts.candidates = candidateNodes.length;
      figma.ui.postMessage({
        type: "build-result",
        ok: false,
        cancelled: true,
        counts: counts,
      });
      return;
    }
    // Yield to event loop so a `cancel` message posted between iterations
    // can be processed before we start the next artboard.
    await new Promise(function (r) { setTimeout(r, 0); });
    var ca = candidatesWithImages[ci];
    var ccol = ci % CAND_COLS;
    var crow = Math.floor(ci / CAND_COLS);
    var cellX = BAND_X + ccol * (CAND_W + CAND_GAP_X);
    var cellY = candidateOriginY + crow * (CAND_H + CAND_GAP_Y);

    // Title above the frame so users can scan candidates without
    // selecting them. Library text style if we sampled one.
    var candTitle = figma.createText();
    try { candTitle.fontName = { family: "Inter", style: "Medium" }; } catch (e) {}
    candTitle.characters = ca.name;
    if (sampledStyles && sampledStyles.body) {
      await applyTextStyle(candTitle, sampledStyles.body);
    } else {
      candTitle.fontSize = 14;
      candTitle.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.22, b: 0.28 } }];
    }
    candTitle.x = cellX;
    candTitle.y = cellY;
    targetPage.appendChild(candTitle);

    // If this candidate has a user-picked DS component mapping (set
    // via Screen M's "Pick DS component" flow), try to instantiate
    // the real component instead of the placeholder screenshot frame.
    var mapping = candidateMappings[ca.name];
    var instanceCreated = false;
    if (mapping && (mapping.componentKey || mapping.componentId)) {
      try {
        var comp = await resolveDsComponent(mapping);
        if (comp) {
          var inst = comp.createInstance();
          inst.name = "DS Candidate — " + ca.name;
          targetPage.appendChild(inst);
          inst.x = cellX;
          inst.y = cellY + Math.round(candTitle.height) + 8;
          candidateNodes.push(inst);
          instanceCreated = true;
        }
      } catch (e) {
        // Fall back to placeholder; surface a warning in the build log.
        figma.ui.postMessage({
          type: "progress",
          phase: "building",
          index: ci,
          total: candidatesWithImages.length,
          section: "candidates",
          name: "(warn) failed to import '" + (mapping.componentName || mapping.componentKey) + "' for " + ca.name + ": " + (e.message || String(e)),
        });
        warnings.push("DS Candidate " + ca.name + ": import '" + (mapping.componentName || mapping.componentKey) + "' failed — " + (e.message || String(e)));
        counts.warnings++;
      }
    }

    if (!instanceCreated) {
      // Frame containing the screenshot. createImage() throws if bytes
      // aren't a valid image — wrap defensively so one bad upload
      // doesn't kill the whole build.
      try {
        var imgNode = figma.createImage(ca.imageBytes);
        var candFrame = figma.createFrame();
        candFrame.name = "DS Candidate — " + ca.name;
        candFrame.resize(CAND_W, CAND_H);
        candFrame.fills = [
          { type: "IMAGE", scaleMode: "FIT", imageHash: imgNode.hash },
        ];
        // Subtle border so the frame is visible even on the same color
        // as the canvas bg.
        candFrame.strokes = [
          { type: "SOLID", color: { r: 0.85, g: 0.86, b: 0.88 } },
        ];
        candFrame.strokeWeight = 1;
        candFrame.cornerRadius = 6;
        targetPage.appendChild(candFrame);
        candFrame.x = cellX;
        candFrame.y = cellY + Math.round(candTitle.height) + 8;
        candidateNodes.push(candFrame);
      } catch (eImg) {
        warnings.push("DS Candidate " + ca.name + ": image embed failed — " + (eImg.message || String(eImg)));
        counts.warnings++;
      }
    }
  }
  counts.candidates = candidateNodes.length;

  // ---- Matched elements band ----
  // One artboard per persisted manual match (E4). Real DS instance +
  // text overrides from the captured htmlText. Positioned in a new
  // band below the DS Candidates band. Skipped entirely when there
  // are no manual matches — no header, no artboards.
  var matchedNodes = [];
  counts.manualMatches = 0;
  if (manualMatches.length > 0) {
    // Compute the lowest Y used so far by the candidates band (the
    // candidate frames sit at candidateOriginY + crow rows). If no
    // candidates rendered, anchor below the band header instead.
    var candRowCount = Math.ceil(candidatesWithImages.length / CAND_COLS);
    var candidatesMaxY = candidatesWithImages.length > 0
      ? candidateOriginY + candRowCount * (CAND_H + CAND_GAP_Y)
      : candidateBandY + 80;
    var matchBandY = candidatesMaxY + 200;
    // Round up to next 1000 for visual consistency with other bands.
    matchBandY = Math.ceil(matchBandY / 1000) * 1000;

    var matchHeader = figma.createText();
    try {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      matchHeader.fontName = { family: "Inter", style: "Regular" };
    } catch (eFont) {
      // Default font fallback
    }
    matchHeader.fontSize = 32;
    matchHeader.characters = "Matched elements — manually mapped";
    matchHeader.x = BAND_X;
    matchHeader.y = matchBandY;
    targetPage.appendChild(matchHeader);
    matchedNodes.push(matchHeader);

    var matchArtboardY = matchBandY + 80;

    for (var mi = 0; mi < manualMatches.length; mi++) {
      if (_cancelRequested) {
        counts.manualMatches = mi;
        figma.ui.postMessage({
          type: "build-result",
          ok: false,
          cancelled: true,
          counts: counts,
        });
        return;
      }
      // Yield to event loop so cancel messages can be processed
      await new Promise(function (r) { setTimeout(r, 0); });

      var match = manualMatches[mi];
      var matchArtboard = figma.createFrame();
      matchArtboard.name = "Match — " + match.componentName;
      matchArtboard.fills = [];
      matchArtboard.clipsContent = true;
      // Start at standard size; we'll resize after the instance is in place
      // so we know the component's natural dimensions (Issue 3).
      matchArtboard.resize(ARTBOARD_W, ARTBOARD_H);
      targetPage.appendChild(matchArtboard);
      matchArtboard.x = BAND_X + (mi % GRID_COLS) * GRID_STRIDE_X;
      matchArtboard.y = matchArtboardY + Math.floor(mi / GRID_COLS) * GRID_STRIDE_Y;
      matchedNodes.push(matchArtboard);

      // Defensive: skip entries with no componentKey AND no componentId
      // (shouldn't happen after the screenNComplete guard, but protects
      // against legacy entries persisted before the guard was added).
      if (!match.componentKey && !match.componentId) {
        warnings.push("Match — " + (match.componentName || "(unnamed)") + ": componentKey/id missing; the DS picker did not capture a valid component. Re-add the match via Screen N.");
        counts.warnings++;
        counts.manualMatches = mi + 1;
        continue;
      }
      try {
        var matchComp = await resolveDsComponent(match);
        if (!matchComp) {
          warnings.push("Match — " + match.componentName + ": could not resolve via id/key/name. The component may have been deleted, renamed, or its key is stale.");
          counts.warnings++;
          counts.manualMatches = mi + 1;
          continue; // skip this match entirely — no instance to create
        }
        var matchInst = matchComp.createInstance();
        matchArtboard.appendChild(matchInst);
        // Diagnostic: verify the instance is visible + has size (Issue 4).
        // Empty-looking artboards in this band usually trace back to one of:
        //   - instance.visible=false (rare — DS authoring oversight)
        //   - zero width/height (variant referenced has no content)
        //   - user picked a variant label, not a component instance, on canvas
        if (!matchInst.visible) {
          warnings.push("Match — " + match.componentName + ": instance was created but visible=false. Setting visible=true.");
          counts.warnings++;
          try { matchInst.visible = true; } catch (eVis) {}
        }
        if (matchInst.width === 0 || matchInst.height === 0) {
          warnings.push("Match — " + match.componentName + ": instance has zero dimensions (" + matchInst.width + "×" + matchInst.height + "). Component may not render. Check the DS component in Figma.");
          counts.warnings++;
        }
        // If component is a variant inside a component-set, .key refers to the variant.
        // importComponentByKeyAsync should resolve it, but log if name shows variant syntax.
        if (match.componentName && /=/.test(match.componentName)) {
          warnings.push("Match — " + match.componentName + ": this looks like a variant name (contains '='). Make sure the user selected a component INSTANCE on the canvas, not a variant label in the layer panel.");
          counts.warnings++;
        }
        // Ensure ABSOLUTE positioning so the centering math below isn't a no-op
        // when the artboard inherits auto-layout from anywhere upstream.
        try { matchInst.layoutPositioning = "ABSOLUTE"; } catch (eLP) {}
        // Size artboard to component's natural dimensions + padding,
        // so small components (inputs, buttons) don't look "empty" in a
        // huge artboard. (Issue 3)
        var pad = 80;
        var minDim = 160; // minimum so very small components stay readable
        var aW = Math.max(minDim, matchInst.width + pad * 2);
        var aH = Math.max(minDim, matchInst.height + pad * 2);
        matchArtboard.resize(aW, aH);
        // Center the instance within the resized artboard
        matchInst.x = Math.round((aW - matchInst.width) / 2);
        matchInst.y = Math.round((aH - matchInst.height) / 2);
        // Apply text override from htmlText if available
        if (match.htmlText) {
          var textNodes = matchInst.findAll(function (n) { return n.type === "TEXT"; });
          if (textNodes && textNodes.length > 0) {
            try {
              await figma.loadFontAsync(textNodes[0].fontName);
              textNodes[0].characters = match.htmlText.slice(0, 200);
            } catch (eText) { /* non-fatal */ }
          }
        }
      } catch (eImport) {
        warnings.push("Match — " + match.componentName + ": " + (eImport.message || String(eImport)));
        counts.warnings++;
      }

      counts.manualMatches = mi + 1;
      figma.ui.postMessage({
        type: "progress",
        phase: "building",
        index: mi,
        total: manualMatches.length,
        section: "manual-matches",
        name: matchArtboard.name,
      });
    }
  }

  // 7. Save IDs of all created nodes so view-on-canvas can scroll
  // and zoom directly to them. Storing IDs (not coords) lets Figma
  // compute the correct viewport even if the user has manually moved
  // the artboards around between builds.
  var allNodeIds = [];
  for (var n = 0; n < createdNodes.length; n++) allNodeIds.push(createdNodes[n].id);
  for (var n2 = 0; n2 < candidateNodes.length; n2++) allNodeIds.push(candidateNodes[n2].id);
  for (var n3 = 0; n3 < matchedNodes.length; n3++) allNodeIds.push(matchedNodes[n3].id);
  if (bandLabel && bandLabel.id) allNodeIds.push(bandLabel.id);

  await figma.clientStorage.setAsync(fileScoped("lastBuiltBand"), {
    pageName: targetName,
    nodeIds: allNodeIds,
    timestamp: new Date().toISOString(),
  });

  // 8. Done
  figma.ui.postMessage({
    type: "build-complete",
    ok: true,
    counts: counts,
    warnings: warnings,
    section: section,
  });
}

figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "parse-html": {
      try {
        const result = parseHtml(msg.html);
        // Treat empty parse results as a soft error: if the HTML has no
        // states/modals/toasts, the build can't produce anything useful.
        // Surface it as a parse error rather than navigating to a useless
        // Screen 02 with zeros everywhere. (Spec §5.2)
        if (
          result.states.length === 0 &&
          result.modals.length === 0 &&
          result.toasts.length === 0
        ) {
          figma.ui.postMessage({
            type: "parse-result",
            ok: false,
            error:
              "No states, modals, or toasts found in this HTML. Make sure it has a dev-panel switch with `case '<state>':` blocks, plus `openModal*()` / `showToast(...)` calls. See `Control/cpp-setting-tab-mockup.html` for the expected shape.",
          });
          break;
        }
        const sync = await dsSync();
        const suggestions = computeVariantSuggestions(result);
        figma.ui.postMessage({
          type: "parse-result",
          ok: true,
          data: result,
          sync: sync,
          variantSuggestions: suggestions,
          variantLists: VARIANT_LISTS,
        });
      } catch (e) {
        figma.ui.postMessage({
          type: "parse-result",
          ok: false,
          error: e.message || String(e),
        });
      }
      break;
    }

    case "ds-sync": {
      try {
        const sync = await dsSync();
        figma.ui.postMessage({ type: "ds-sync-result", sync: sync });
      } catch (e) {
        figma.ui.postMessage({
          type: "ds-sync-result",
          sync: { ok: false, error: e.message || String(e) },
        });
      }
      break;
    }

    case "list-ds-components": {
      try {
        var stored = await figma.clientStorage.getAsync(fileScoped("dsComponents"));
        if (!stored || !stored.components) {
          figma.ui.postMessage({
            type: "ds-components-list",
            components: [],
            error: "No DS components synced yet. Parse HTML first.",
          });
          break;
        }
        figma.ui.postMessage({
          type: "ds-components-list",
          components: stored.components,
          sourceName: stored.sourceName,
        });
      } catch (e) {
        figma.ui.postMessage({
          type: "ds-components-list",
          components: [],
          error: e.message || String(e),
        });
      }
      break;
    }

    case "register-candidate-mapping": {
      try {
        var existing = (await figma.clientStorage.getAsync(fileScoped("candidateMappings"))) || {};
        existing[msg.candidateName] = {
          componentKey: msg.componentKey,
          componentId: msg.componentId || null,
          componentName: msg.componentName,
          variantName: msg.variantName || null,
          variantId: msg.variantId || null,
        };
        await figma.clientStorage.setAsync(fileScoped("candidateMappings"), existing);
        figma.ui.postMessage({
          type: "mapping-set",
          candidateName: msg.candidateName,
          componentName: msg.componentName,
        });
      } catch (e) {
        figma.ui.postMessage({
          type: "mapping-set",
          error: e.message || String(e),
        });
      }
      break;
    }

    case "list-candidate-mappings": {
      try {
        var existingMappings = (await figma.clientStorage.getAsync(fileScoped("candidateMappings"))) || {};
        figma.ui.postMessage({
          type: "candidate-mappings-list",
          mappings: existingMappings,
        });
      } catch (e) {
        figma.ui.postMessage({
          type: "candidate-mappings-list",
          mappings: {},
          error: e.message || String(e),
        });
      }
      break;
    }

    case "remove-candidate-mapping": {
      try {
        var existingForRemove = (await figma.clientStorage.getAsync(fileScoped("candidateMappings"))) || {};
        delete existingForRemove[msg.candidateName];
        await figma.clientStorage.setAsync(fileScoped("candidateMappings"), existingForRemove);
        figma.ui.postMessage({
          type: "mapping-removed",
          candidateName: msg.candidateName,
        });
      } catch (e) {
        figma.ui.postMessage({
          type: "mapping-removed",
          error: e.message || String(e),
        });
      }
      break;
    }

    case "register-pattern-mapping": {
      try {
        var existingPatternMappings = (await figma.clientStorage.getAsync(fileScoped("patternMappings"))) || {};
        existingPatternMappings[msg.signature] = {
          componentKey: msg.componentKey,
          componentId: msg.componentId || null,
          componentName: msg.componentName,
          variantName: msg.variantName || null,
          variantId: msg.variantId || null,
          // Phase H5 will add: wrapperConsumesChildren: false (default)
        };
        await figma.clientStorage.setAsync(fileScoped("patternMappings"), existingPatternMappings);
        figma.ui.postMessage({
          type: "pattern-mapping-set",
          signature: msg.signature,
          componentName: msg.componentName,
        });
      } catch (e) {
        figma.ui.postMessage({
          type: "pattern-mapping-set",
          error: e.message || String(e),
        });
      }
      break;
    }

    case "list-pattern-mappings": {
      try {
        var patternMappingsList = (await figma.clientStorage.getAsync(fileScoped("patternMappings"))) || {};
        figma.ui.postMessage({
          type: "pattern-mappings-list",
          mappings: patternMappingsList,
        });
      } catch (e) {
        figma.ui.postMessage({
          type: "pattern-mappings-list",
          mappings: {},
          error: e.message || String(e),
        });
      }
      break;
    }

    case "remove-pattern-mapping": {
      try {
        var existingPatternForRemove = (await figma.clientStorage.getAsync(fileScoped("patternMappings"))) || {};
        delete existingPatternForRemove[msg.signature];
        await figma.clientStorage.setAsync(fileScoped("patternMappings"), existingPatternForRemove);
        figma.ui.postMessage({
          type: "pattern-mapping-removed",
          signature: msg.signature,
        });
      } catch (e) {
        figma.ui.postMessage({
          type: "pattern-mapping-removed",
          error: e.message || String(e),
        });
      }
      break;
    }

    case "start-selection-listener": {
      if (!_selectionListenerActive) {
        _selectionListenerActive = true;
        figma.on("selectionchange", _postSelectionUpdate);
      }
      _postSelectionUpdate(); // emit current state immediately
      break;
    }

    case "stop-selection-listener": {
      if (_selectionListenerActive) {
        _selectionListenerActive = false;
        figma.off("selectionchange", _postSelectionUpdate);
      }
      break;
    }

    case "register-manual-match": {
      try {
        // Defensive: the UI guard already blocks empty componentKey,
        // but a second check here prevents a bad write if the message
        // shape changes or a future caller forgets the guard.
        if (!msg.componentKey) {
          figma.ui.postMessage({
            type: "match-set",
            error: "Cannot register match: componentKey is missing. Select a DS instance in Figma, or use 'Browse library instead'.",
          });
          break;
        }
        var matches = (await figma.clientStorage.getAsync(fileScoped("manualMatches"))) || [];
        if (matches.length >= 50) {
          figma.ui.postMessage({
            type: "match-set",
            error: "Cap of 50 manual matches reached for this file.",
          });
          break;
        }
        matches.push({
          htmlSelector: msg.htmlSelector,
          htmlText: msg.htmlText || "",
          componentKey: msg.componentKey,
          componentId: msg.componentId || null,
          componentName: msg.componentName,
          variantName: msg.variantName || null,
          variantId: msg.variantId || null,
          capturedAt: new Date().toISOString(),
        });
        await figma.clientStorage.setAsync(fileScoped("manualMatches"), matches);
        figma.ui.postMessage({
          type: "match-set",
          index: matches.length - 1,
          matches: matches,
        });
      } catch (e) {
        figma.ui.postMessage({
          type: "match-set",
          error: e.message || String(e),
        });
      }
      break;
    }

    case "list-manual-matches": {
      try {
        var manualMatches = (await figma.clientStorage.getAsync(fileScoped("manualMatches"))) || [];
        figma.ui.postMessage({ type: "manual-matches-list", matches: manualMatches });
      } catch (e) {
        figma.ui.postMessage({
          type: "manual-matches-list",
          matches: [],
          error: e.message || String(e),
        });
      }
      break;
    }

    case "remove-manual-match": {
      try {
        var matchesForRemove = (await figma.clientStorage.getAsync(fileScoped("manualMatches"))) || [];
        if (typeof msg.index === "number" && msg.index >= 0 && msg.index < matchesForRemove.length) {
          matchesForRemove.splice(msg.index, 1);
          await figma.clientStorage.setAsync(fileScoped("manualMatches"), matchesForRemove);
        }
        figma.ui.postMessage({ type: "manual-matches-list", matches: matchesForRemove });
      } catch (e) {
        figma.ui.postMessage({
          type: "manual-matches-list",
          matches: [],
          error: e.message || String(e),
        });
      }
      break;
    }

    case "build": {
      // Run the build pipeline. Streams `progress` messages while it runs;
      // emits `build-complete` (success) or `build-result` (error) at the end.
      try {
        await buildArtboards({
          parsed: msg.parsed || {},
          filename: msg.filename || "",
          candidates: msg.candidates || [],
          variantChoices: msg.variantChoices || null,
        });
      } catch (e) {
        figma.ui.postMessage({
          type: "build-result",
          ok: false,
          error: "Build pipeline crashed: " + (e.message || String(e)),
        });
      }
      break;
    }

    case "view-on-canvas": {
      // Jump the canvas viewport to the most recently built band.
      // We saved the IDs of every created node at the end of the
      // build, so we can resolve them and use scrollAndZoomIntoView
      // for an automatic fit. Falls back to a page-jump if the
      // saved IDs are missing or stale.
      const lastBand = await figma.clientStorage.getAsync(fileScoped("lastBuiltBand"));
      const pageName =
        (lastBand && lastBand.pageName) ||
        (await figma.clientStorage.getAsync(fileScoped("targetPageName"))) ||
        "Claude output";
      const targetPage = figma.root.children.find((p) => p.name === pageName);
      if (!targetPage) break;
      await figma.setCurrentPageAsync(targetPage);

      const ids = (lastBand && lastBand.nodeIds) || [];
      const nodes = [];
      for (let i = 0; i < ids.length; i++) {
        try {
          const n = await figma.getNodeByIdAsync(ids[i]);
          if (n && !n.removed) nodes.push(n);
        } catch (e) {}
      }
      if (nodes.length > 0) {
        try {
          figma.viewport.scrollAndZoomIntoView(nodes);
        } catch (e) {
          // Some old plugin versions only accept arrays of SceneNodes
          // on the current page; the page-jump above already covers
          // the worst case.
        }
      }
      break;
    }

    case "list-pages": {
      // List every page in the current Figma file and the currently-selected
      // target. Used by the Target page dropdown in the UI.
      const pages = figma.root.children.map((p) => ({
        name: p.name,
        id: p.id,
      }));
      let currentTarget = await figma.clientStorage.getAsync(fileScoped("targetPageName"));
      // If the persisted target no longer exists in the file (e.g., the user
      // deleted it in Figma), treat it as missing so we fall back to a default.
      // Otherwise the dropdown label keeps showing a phantom page that isn't
      // in the dropdown options.
      const targetStillExists =
        currentTarget && pages.some((p) => p.name === currentTarget);
      if (!targetStillExists) {
        // Default: prefer "Claude output" if it exists, else first page.
        const claudeOutput = pages.find((p) => p.name === "Claude output");
        if (claudeOutput) {
          currentTarget = claudeOutput.name;
        } else if (pages.length > 0) {
          currentTarget = pages[0].name;
        } else {
          currentTarget = null;
        }
        // Persist the corrected target so subsequent reads stay consistent.
        await figma.clientStorage.setAsync(fileScoped("targetPageName"), currentTarget);
      }
      figma.ui.postMessage({
        type: "pages-list",
        pages,
        currentTarget,
      });
      break;
    }

    case "set-target-page": {
      // Persist the user's target page choice so it survives plugin restarts.
      await figma.clientStorage.setAsync(fileScoped("targetPageName"), msg.pageName);
      figma.ui.postMessage({
        type: "target-set",
        pageName: msg.pageName,
      });
      break;
    }

    case "create-page": {
      // Create a new page in the file and set it as the target.
      // figma.createPage() must run on the main thread; no async needed.
      const newPage = figma.createPage();
      newPage.name = msg.name;
      await figma.clientStorage.setAsync(fileScoped("targetPageName"), msg.name);
      // Re-send the pages list so the UI updates with the new page selected.
      const pages = figma.root.children.map((p) => ({
        name: p.name,
        id: p.id,
      }));
      figma.ui.postMessage({
        type: "pages-list",
        pages,
        currentTarget: msg.name,
      });
      break;
    }

    case "resize-ui": {
      // UI requests a window-size change (e.g. opening the DS Candidate
      // picker overlay needs to take over Figma's canvas area).
      // Defaults guard against malformed values.
      var w = typeof msg.width === "number" && msg.width > 0 ? msg.width : 380;
      var h = typeof msg.height === "number" && msg.height > 0 ? msg.height : 800;
      figma.ui.resize(w, h);
      break;
    }

    case "state-captures": {
      // Store the per-state captures in module-level memory for the build
      // pipeline to consume. NOT in clientStorage — screenshots can be
      // multiple MB each; storing N states would blow the 5MB cap.
      _stateCaptures = msg.captures || [];
      if (msg.error) {
        console.warn("State capture error:", msg.error);
      }
      break;
    }

    case "cancel": {
      _cancelRequested = true;
      break;
    }

    case "close": {
      figma.closePlugin();
      break;
    }

    default:
      console.warn("Unhandled message:", msg.type);
  }
};
