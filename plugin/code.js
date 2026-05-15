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

// ============================================================
// DS sync — library-first, page-fallback.
// Reads clientStorage.dsLibrary; if set, enumerates that library's
// components. If not set, falls back to the legacy in-file
// "Design system" page flow (preserved for the canonical Control DS file).
// ============================================================

async function dsSync() {
  var storedLib = await figma.clientStorage.getAsync("dsLibrary");
  if (storedLib && storedLib.key) {
    if (!figma.teamLibrary || !figma.teamLibrary.getAvailableLibrariesAsync) {
      return {
        ok: false,
        source: "library",
        sourceName: storedLib.name,
        error:
          "Team library API not available in this Figma context. " +
          "This may be a personal file or an older Figma version.",
      };
    }
    try {
      var libs = await figma.teamLibrary.getAvailableLibrariesAsync();
      var lib = (libs || []).find(function (l) {
        return l.libraryKey === storedLib.key || l.key === storedLib.key;
      });
      if (!lib) {
        return {
          ok: false,
          source: "library",
          sourceName: storedLib.name,
          error:
            "Library '" + storedLib.name +
            "' is no longer available in this file. Choose another library.",
        };
      }
      // The exact API for listing components on a library varies by Figma
      // version. Try the documented path first, fall back to alternatives.
      var components = [];
      if (typeof figma.teamLibrary.getComponentsForLibraryAsync === "function") {
        components = await figma.teamLibrary.getComponentsForLibraryAsync(lib);
      } else if (typeof lib.getComponentsAsync === "function") {
        components = await lib.getComponentsAsync();
      } else {
        throw new Error(
          "This Figma version has no supported library-listing API (getComponentsForLibraryAsync or getComponentsAsync). Update Figma desktop or check the plugin manifest."
        );
      }
      var compList = (components || []).map(function (c) {
        return {
          name: c.name,
          key: c.key,
          variants: (c.children || []).map(function (v) { return v.name; }),
        };
      });
      var changed = !manifestsEqual(
        { components: storedLib.components || [] },
        { components: compList }
      );
      var current = {
        source: "library",
        key: lib.libraryKey || lib.key,
        name: lib.libraryName || lib.name,
        components: compList,
        timestamp: new Date().toISOString(),
      };
      await figma.clientStorage.setAsync("dsLibrary", current);
      return {
        ok: true,
        source: "library",
        sourceName: current.name,
        changed: changed,
        lastSyncedAt: current.timestamp,
        componentCount: compList.length,
      };
    } catch (e) {
      return {
        ok: false,
        source: "library",
        sourceName: storedLib.name,
        error: "Failed to enumerate library components: " + (e.message || String(e)),
      };
    }
  }
  // Legacy fallback: in-file "Design system" page (original behavior)
  var pages = figma.root.children;
  var dsPage = null;
  for (var i = 0; i < pages.length; i++) {
    if (pages[i].name === "Design system") {
      dsPage = pages[i];
      break;
    }
  }
  if (dsPage) {
    var originalPage = figma.currentPage;
    var needRestore = originalPage !== dsPage;
    if (needRestore) await figma.setCurrentPageAsync(dsPage);
    var components = [];
    function walkComponents(node) {
      if (node.type === "COMPONENT_SET" || node.type === "COMPONENT") {
        components.push({
          name: node.name,
          key: node.key,
          type: node.type,
          variants: (node.type === "COMPONENT_SET" && node.children)
            ? node.children.map(function (c) { return c.name; })
            : [],
        });
        return;
      }
      if ("children" in node) {
        for (var j = 0; j < node.children.length; j++) walkComponents(node.children[j]);
      }
    }
    walkComponents(dsPage);
    if (needRestore) await figma.setCurrentPageAsync(originalPage);
    return {
      ok: true,
      source: "page",
      sourceName: "Design system",
      changed: false,
      lastSyncedAt: new Date().toISOString(),
      componentCount: components.length,
    };
  }
  return {
    ok: false,
    source: null,
    needsLibrary: true,
    error: "No DS library configured and no 'Design system' page in this file. Choose a library to proceed.",
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
  for (var j = 0; j < aComps.length; j++) {
    var match = byName[aComps[j].name];
    if (!match) return false;
    var av = (aComps[j].variants || []).slice().sort();
    var bv = (match.variants || []).slice().sort();
    if (av.length !== bv.length) return false;
    for (var k = 0; k < av.length; k++) {
      if (av[k] !== bv[k]) return false;
    }
  }
  return true;
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

  var modals = [];
  var seenModals = {};
  var modalPattern = /function\s+(open[A-Z]\w*(?:Modal|Confirm)\w*)\s*\(/g;
  while ((match = modalPattern.exec(html)) !== null) {
    if (!seenModals[match[1]]) {
      seenModals[match[1]] = true;
      modals.push(match[1] + "()");
    }
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

  return {
    states: states,
    modals: modals,
    toasts: toasts,
    dsComponents: dsComponents,
    tabs: tabs,
    candidates: candidates,
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
  var key = String(stateName).toLowerCase().replace(/[\s\-_]/g, "");
  return SYSTEM_STATE_MAP[key] || null;
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
  var modalRows = [];
  for (var m = 0; m < modals.length; m++) {
    var modalName = String(modals[m]).replace(/[()]/g, "");
    modalRows.push({
      name: modalName,
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
    (await figma.clientStorage.getAsync("targetPageName")) || "Claude output";
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
    var modalLabel = String(modals[m]).replace(/[()]/g, "");
    plan.push({
      kind: "modal",
      modalName: modalLabel,
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
  var counts = { states: 0, modals: 0, toasts: 0, candidates: 0, warnings: 0 };
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
      // with System states master ALONE. The Setting dialog has its
      // own default empty-state body that would overlap visually with
      // the System states content (e.g., loading spinner stacked on
      // top of "No profile ID is found"). Drop the dialog for these.
      if (sysVariant) {
        artboard = figma.createFrame();
        artboard.name = spec.name;
        artboard.fills = [];
        artboard.clipsContent = true;
        artboard.resize(ARTBOARD_W, ARTBOARD_H);
        targetPage.appendChild(artboard);
        artboard.x = x;
        artboard.y = y;

        var sysRes = await safeOverlayInstance(
          artboard,
          DS_KEYS.SystemStates,
          sysVariant,
          0, 0
        );
        if (sysRes.ok && sysRes.instance) {
          // Center the System states instance in the artboard.
          var siW = sysRes.instance.width;
          var siH = sysRes.instance.height;
          sysRes.instance.x = Math.round((ARTBOARD_W - siW) / 2);
          sysRes.instance.y = Math.round((ARTBOARD_H - siH) / 2);
          // Apply the wrapper bg to match the screen artboards' dark
          // theme (sampled from a previous dialog if available).
          if (sampledStyles && sampledStyles.bgFills) {
            artboard.fills = sampledStyles.bgFills;
          } else {
            artboard.fills = [{ type: "SOLID", color: { r: 0.13, g: 0.14, b: 0.17 } }];
          }
        } else {
          warnings.push(spec.name + ": System states overlay — " + (sysRes.reason || "unknown"));
          counts.warnings++;
        }
      } else {
        // Branch B: content states + modal/toast carriers — build with
        // Setting dialog as the screen chrome.
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
  counts.candidates = candidateNodes.length;

  // 7. Save IDs of all created nodes so view-on-canvas can scroll
  // and zoom directly to them. Storing IDs (not coords) lets Figma
  // compute the correct viewport even if the user has manually moved
  // the artboards around between builds.
  var allNodeIds = [];
  for (var n = 0; n < createdNodes.length; n++) allNodeIds.push(createdNodes[n].id);
  for (var n2 = 0; n2 < candidateNodes.length; n2++) allNodeIds.push(candidateNodes[n2].id);
  if (bandLabel && bandLabel.id) allNodeIds.push(bandLabel.id);

  await figma.clientStorage.setAsync("lastBuiltBand", {
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

    case "list-libraries": {
      try {
        if (!figma.teamLibrary || !figma.teamLibrary.getAvailableLibrariesAsync) {
          figma.ui.postMessage({
            type: "libraries-list",
            libraries: [],
            error:
              "Team library API not available. Open this plugin in a Figma file with team library access.",
          });
          break;
        }
        var libs = await figma.teamLibrary.getAvailableLibrariesAsync();
        var stored = await figma.clientStorage.getAsync("dsLibrary");
        figma.ui.postMessage({
          type: "libraries-list",
          libraries: (libs || []).map(function (l) {
            return {
              key: l.libraryKey || l.key,
              name: l.libraryName || l.name,
              lastModified: l.lastModified || null,
            };
          }),
          currentKey: stored && stored.key ? stored.key : null,
        });
      } catch (e) {
        figma.ui.postMessage({
          type: "libraries-list",
          libraries: [],
          error: "Failed to list libraries: " + (e.message || String(e)),
        });
      }
      break;
    }

    case "select-library": {
      try {
        await figma.clientStorage.setAsync("dsLibrary", {
          key: msg.key,
          name: msg.name,
          components: [],
          timestamp: new Date().toISOString(),
        });
        var sync = await dsSync();
        figma.ui.postMessage({ type: "library-set", sync: sync });
      } catch (e) {
        figma.ui.postMessage({
          type: "library-set",
          sync: {
            ok: false,
            error: "Failed to select library: " + (e.message || String(e)),
          },
        });
      }
      break;
    }

    case "list-library-components": {
      try {
        var storedLib = await figma.clientStorage.getAsync("dsLibrary");
        if (!storedLib || !storedLib.key) {
          figma.ui.postMessage({
            type: "library-components-list",
            components: [],
            error: "No library selected.",
          });
          break;
        }
        figma.ui.postMessage({
          type: "library-components-list",
          components: storedLib.components || [],
        });
      } catch (e) {
        figma.ui.postMessage({
          type: "library-components-list",
          components: [],
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
      const lastBand = await figma.clientStorage.getAsync("lastBuiltBand");
      const pageName =
        (lastBand && lastBand.pageName) ||
        (await figma.clientStorage.getAsync("targetPageName")) ||
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
      let currentTarget = await figma.clientStorage.getAsync("targetPageName");
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
        await figma.clientStorage.setAsync("targetPageName", currentTarget);
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
      await figma.clientStorage.setAsync("targetPageName", msg.pageName);
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
      await figma.clientStorage.setAsync("targetPageName", msg.name);
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
