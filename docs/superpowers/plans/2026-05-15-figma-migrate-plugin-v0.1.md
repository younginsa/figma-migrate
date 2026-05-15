# Figma-migrate plugin v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six wiring gaps in the existing 11-screen Figma plugin UI, add team-library-backed DS sourcing, candidate→DS-component matching, and manual rescue-match for parser misses.

**Architecture:** Fix-in-place edits to `plugin/code.js` and `plugin/ui.html`. One new shared error helper unifies the five error/gate paths. Three new screens (L, M, N) plug into the existing back-stack navigation. DS source becomes dynamic via `clientStorage.dsLibrary` + Figma team-library API. The build pipeline gains two new bands: DS Candidates (was UI-only mock) and Matched elements (entirely new).

**Tech Stack:** Vanilla JS in Figma plugin sandbox (`code.js`), plain HTML + inline CSS/JS in `ui.html`. No build step, no framework. Figma Plugin API (`figma.*`), `figma.clientStorage` for persistence, `figma.teamLibrary.*` for library access. Manual QA only — no test framework. Companion: html2canvas (already loaded) for HTML preview captures.

**Spec:** [docs/superpowers/specs/2026-05-15-figma-migrate-plugin-v0.1-state-machine-design.md](../specs/2026-05-15-figma-migrate-plugin-v0.1-state-machine-design.md)

---

## Pre-execution notes

**Repo is not under git today.** Commit steps below assume `git init` has been run. If you want a commit-per-task workflow, run this first:

```bash
cd /Users/younginsa/Documents/Claude/Projects/HiNAS
git init
git add -A
git commit -m "chore: baseline before figma-migrate plugin v0.1 work"
```

If you choose not to use git, treat every "Commit" step as a logical breakpoint — pause, manually verify in Figma, then continue.

**Reload pattern.** Every UI change requires reloading the plugin in Figma desktop: open the plugin, then press `cmd-opt-P` (or right-click in the plugin panel → "Reload plugin"). For code.js changes you must close-and-reopen the plugin (cmd-opt-P doesn't re-execute the sandbox).

**Test HTML.** Use [Control/cpp-setting-tab-mockup.html](../../../Control/cpp-setting-tab-mockup.html) as the canonical input throughout the plan unless a task specifies otherwise. Output band naming uses `Setting - CCP - <State>`.

**Test file annotations.** Several tasks require HTML with `data-ds-candidate="..."` annotations. We'll add those to a copy of the CCP mockup in Task A2 and reuse it throughout.

---

## File structure

| File | Role | Approx. lines today | Change size |
|---|---|---|---|
| `plugin/code.js` | Plugin sandbox: parser, DS sync, build pipeline, message handlers | 1413 | +400-500 |
| `plugin/ui.html` | UI iframe: 11+ screens, navigation, message handling, inline CSS/JS | 3724 | +600-800 |
| `plugin/manifest.json` | Plugin metadata, network allowlist | 17 | no change |
| `Control/cpp-setting-tab-mockup.html` | Test mockup | 85K bytes | minor — add `data-ds-candidate` annotations in Task A2 |

No new files. ui.html script section is approaching unmanageable size; an extraction to a separate `ui.js` is recommended as a follow-up but is **out of scope here** per spec §3.5.

---

## Phase A — Foundations

### Task A1: Add `renderInlineError` helper to ui.html

**Files:**
- Modify: `plugin/ui.html` (inside the IIFE that starts at line 2348, add helper near top of script after the cross-screen state vars around line 2372)

- [ ] **Step 1: Add helper function**

Locate the comment `// ---- Screen 01: Paste HTML — ...` at around [ui.html:2373](../../../plugin/ui.html#L2373). Insert the helper above that line, after the cross-screen state block:

```javascript
// ---- Inline error banner helper ----
// Mounts a banner at the top of a screen's panel__body. Used by all error
// and gate paths: parse error, DS sync gate, build error, library load
// error, manual match validation. Auto-clears on screen transition.
function renderInlineError(screenCell, kind, message, actions) {
  if (!screenCell) return;
  var body = screenCell.querySelector(".panel__body");
  if (!body) return;
  // Remove any existing inline-error banner first
  var existing = body.querySelector(".inline-error");
  if (existing) existing.remove();
  var banner = document.createElement("div");
  banner.className = "inline-error banner banner--" +
    (kind === "ds-sync" ? "warning" : "error");
  banner.setAttribute("data-kind", kind);
  var bodyEl = document.createElement("div");
  bodyEl.className = "banner__body";
  bodyEl.textContent = message;
  banner.appendChild(bodyEl);
  if (actions && actions.length) {
    var actionsEl = document.createElement("div");
    actionsEl.className = "inline-error__actions";
    actions.forEach(function (action, idx) {
      var btn = document.createElement("button");
      btn.className =
        "btn btn--sm " + (idx === 0 ? "btn--primary" : "btn--ghost");
      btn.textContent = action.label;
      btn.addEventListener("click", function () {
        if (typeof action.onClick === "function") action.onClick();
      });
      actionsEl.appendChild(btn);
    });
    banner.appendChild(actionsEl);
  }
  body.insertBefore(banner, body.firstChild);
}

function clearInlineErrors(screenCell) {
  if (!screenCell) return;
  var banners = screenCell.querySelectorAll(".inline-error");
  for (var i = 0; i < banners.length; i++) banners[i].remove();
}
```

- [ ] **Step 2: Hook auto-clear into `showScreen`**

Find the existing `showScreen` function at around [ui.html:2662](../../../plugin/ui.html#L2662) and modify it:

```javascript
function showScreen(index) {
  var allCells = document.querySelectorAll(".strip__cell");
  for (var i = 0; i < allCells.length; i++) {
    // Clear inline error banners on any screen we're leaving
    if (allCells[i].classList.contains("is-active") && i !== index) {
      clearInlineErrors(allCells[i]);
    }
    allCells[i].classList.toggle("is-active", i === index);
  }
  sizePanelBody();
}
```

- [ ] **Step 3: Add minimal CSS for the helper**

Locate the existing `<style>` block in ui.html (search for `.banner--success {` to find the banner rules). Add these rules near the existing banner styles:

```css
.inline-error {
  margin-bottom: 12px;
}
.inline-error__actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.inline-error__actions .btn--sm {
  padding: 4px 10px;
  font-size: 11px;
}
```

- [ ] **Step 4: Manually verify in Figma**

Reload plugin in Figma. The helper isn't invoked anywhere yet — it should just compile. Open Chrome DevTools on the plugin iframe (right-click in panel → Inspect) and run in console:

```javascript
renderInlineError(document.querySelectorAll(".strip__cell")[0], "parse", "Test message", [{label: "Try again", onClick: function() { console.log("clicked"); }}]);
```

Expected: A red banner appears at the top of Screen 01 with "Test message" and a "Try again" button. Click the button — console logs "clicked". Click `Parse HTML →` if anything's in the textarea — the banner should disappear when the screen transitions.

- [ ] **Step 5: Commit**

```bash
git add plugin/ui.html
git commit -m "feat(plugin): add renderInlineError helper for unified error UI"
```

---

### Task A2: Parse `data-ds-candidate` attributes; render candidates dynamically on Screen 03

**Files:**
- Modify: `plugin/code.js` (inside `parseHtml`, line 148-246)
- Modify: `plugin/ui.html` (the candidates list at line 1603-1611, and the parse-result handler at line 3576-3594)
- Modify: `Control/cpp-setting-tab-mockup.html` (add `data-ds-candidate` annotations)

- [ ] **Step 1: Add candidate extraction to `parseHtml`**

In [code.js:148](../../../plugin/code.js#L148), at the start of `parseHtml`, the function declares many regex extractors. Add candidate extraction near the bottom, before the `return { ... }` block at around line 239:

```javascript
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
  // Also try to capture the element's visible text content for later
  // text-override hints (best-effort regex; not a real DOM parser).
  var textMatch = new RegExp(
    "data-ds-candidate\\s*=\\s*['\"]" +
    candName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    "['\"][^>]*>([\\s\\S]*?)</", ""
  );
  var textRes = textMatch.exec(html);
  var htmlText = textRes ? textRes[1].replace(/<[^>]+>/g, "").trim().slice(0, 200) : "";
  candidates.push({ name: candName, htmlText: htmlText });
}
```

Then update the return at line 239 to include `candidates`:

```javascript
return {
  states: states,
  modals: modals,
  toasts: toasts,
  dsComponents: dsComponents,
  tabs: tabs,
  candidates: candidates,
};
```

- [ ] **Step 2: Replace hard-coded Screen 03 candidates list with empty placeholder**

In [ui.html:1602-1612](../../../plugin/ui.html#L1602-L1612), find the `<ul class="candidates-card__list">` block with the 9 hard-coded `<li>` items. Replace its contents with a single placeholder that JS will populate:

```html
<ul class="candidates-card__list" id="candidatesList">
  <!-- Populated dynamically from parse-result.data.candidates -->
</ul>
```

Keep the surrounding `<section class="candidates-card">` and `<header>` markup intact.

- [ ] **Step 3: Add candidate render function in ui.html**

Find the `renderMappingScreen` function at around [ui.html:3400](../../../plugin/ui.html#L3400) and below it, add a new render function:

```javascript
function renderCandidates(candidates) {
  var allCells = document.querySelectorAll(".strip__cell");
  var screen03 = allCells[2];
  if (!screen03) return;
  var list = screen03.querySelector("#candidatesList");
  if (!list) return;
  list.innerHTML = "";
  if (!candidates || candidates.length === 0) {
    var empty = document.createElement("li");
    empty.className = "candidates-card__empty";
    empty.textContent = "No DS candidates detected. Annotate elements with data-ds-candidate=\"…\" in HTML to flag them.";
    empty.style.color = "var(--text-secondary)";
    empty.style.fontStyle = "italic";
    list.appendChild(empty);
    return;
  }
  candidates.forEach(function (cand) {
    var li = document.createElement("li");
    var nameSpan = document.createElement("span");
    nameSpan.className = "candidates-card__list-name";
    nameSpan.textContent = cand.name;
    li.appendChild(nameSpan);
    // Pick element (HTML preview capture) — existing flow
    var pickHtmlBtn = document.createElement("button");
    pickHtmlBtn.className = "candidates-card__upload-btn";
    pickHtmlBtn.type = "button";
    pickHtmlBtn.textContent = "Pick element";
    li.appendChild(pickHtmlBtn);
    var status = document.createElement("span");
    status.className = "candidates-card__upload-status";
    status.hidden = true;
    status.textContent = "✓";
    li.appendChild(status);
    // Pick DS component button is added in Task D2 — skip for now.
    list.appendChild(li);
  });
}
```

- [ ] **Step 4: Call `renderCandidates` from the parse-result handler**

In [ui.html:3576-3594](../../../plugin/ui.html#L3576-L3594), find the `if (msg.type === "parse-result") {` block. After the `populateParseResults(msg.data || {});` call and before `if (msg.sync) renderDsSync(msg.sync);`, add:

```javascript
renderCandidates((msg.data && msg.data.candidates) || []);
```

- [ ] **Step 5: Annotate test HTML with `data-ds-candidate`**

Pick three concrete candidates to annotate in `Control/cpp-setting-tab-mockup.html`. Open the file, find each structure, and add the attribute. Example targets and edits (search-and-add):

For an inline banner, find a div with `class="inline-banner"` (or similar) and add:
```html
<div class="inline-banner" data-ds-candidate="Inline banner (red error · blue info)">…</div>
```

For a profile row, find a list item rendering a profile entry and add:
```html
<li class="profile-row profile-row--selected" data-ds-candidate="Profile row — Selected (check + Details)">…</li>
```

For a chart card, find the chart container and add:
```html
<div class="chart-card" data-ds-candidate="Chart card">…</div>
```

Adapt names to match what's actually in the HTML — these are illustrative.

- [ ] **Step 6: Manually verify in Figma**

Reload plugin. Paste the annotated `cpp-setting-tab-mockup.html`. Click `Parse HTML →`. Navigate to Screen 03.

Expected: The "DS Candidates" card now lists exactly the candidates you annotated (3 in the example), in source order. The hard-coded 9-item mockup list is gone. If you paste un-annotated HTML, the list shows the empty-state message.

- [ ] **Step 7: Commit**

```bash
git add plugin/code.js plugin/ui.html Control/cpp-setting-tab-mockup.html
git commit -m "feat(plugin): parse data-ds-candidate annotations and render dynamically"
```

---

## Phase B — Gap closures

### Task B1: Parse error UI (gap 1)

**Files:**
- Modify: `plugin/ui.html` (parse-result handler at line 3576-3594)

- [ ] **Step 1: Replace `console.error` with `renderInlineError`**

In [ui.html:3589-3592](../../../plugin/ui.html#L3589-L3592), find the `else` branch of the parse-result handler:

```javascript
} else {
  console.error("Parse failed:", msg.error);
  // TODO: inline error UI; for v0.1 first pass, console only.
}
```

Replace with:

```javascript
} else {
  var allCells = document.querySelectorAll(".strip__cell");
  renderInlineError(allCells[0], "parse", msg.error || "Parse failed.", [
    {
      label: "Dismiss",
      onClick: function () {
        clearInlineErrors(allCells[0]);
        if (htmlInput) htmlInput.focus();
      },
    },
  ]);
}
```

- [ ] **Step 2: Manually verify in Figma**

Reload plugin. Paste empty content (or HTML without any `case '...':` blocks — e.g. `<html><body><p>hello</p></body></html>`). Click `Parse HTML →`.

Expected: Red banner appears on Screen 01 with the error message and a Dismiss button. Click Dismiss — banner clears, textarea re-focused. Paste valid HTML and Parse — no banner appears, navigates to Screen 02.

- [ ] **Step 3: Commit**

```bash
git add plugin/ui.html
git commit -m "feat(plugin): show parse errors inline instead of swallowing to console"
```

---

### Task B2: Build cancel (gap 4)

**Files:**
- Modify: `plugin/code.js` (add cancel flag + handler; update build loop)
- Modify: `plugin/ui.html` (Screen 04 Cancel button + build-result.cancelled handler)

- [ ] **Step 1: Add cancel flag and handler in code.js**

In [code.js:268](../../../plugin/code.js#L268), just above the `var DS_KEYS = {` block, add:

```javascript
// Cancel flag — set by the UI's `cancel` message during a build.
// Checked at each artboard boundary in buildArtboards(); on detection,
// the build emits build-result.cancelled and returns immediately.
var _cancelRequested = false;
```

In the `figma.ui.onmessage` handler at [code.js:1238](../../../plugin/code.js#L1238), add a new `case "cancel":` after the `case "close":` block (around line 1405):

```javascript
case "cancel": {
  _cancelRequested = true;
  break;
}
```

- [ ] **Step 2: Reset flag at start of build and check it during build loop**

Find the `buildArtboards` function at [code.js:845](../../../plugin/code.js#L845). At the very top of the function body, reset the flag:

```javascript
async function buildArtboards(payload) {
  _cancelRequested = false;
  var built = { states: 0, modals: 0, toasts: 0, candidates: 0, manualMatches: 0 };
  // ... rest of function
```

(If `built` is already declared elsewhere in this function, keep that declaration and just add `_cancelRequested = false;` as the first line.)

Then, find the main artboard-build loop in `buildArtboards` (search for `for (var i` near `figma.ui.postMessage({ type: "progress"`). Inside that loop, at the **top** of each iteration before any work, add:

```javascript
if (_cancelRequested) {
  figma.ui.postMessage({
    type: "build-result",
    ok: false,
    cancelled: true,
    counts: built,
  });
  return;
}
```

If there's more than one loop in `buildArtboards` (states loop, modals loop, toasts loop, candidates loop, matches loop in later tasks), add the same check to each loop's top.

- [ ] **Step 3: Update Screen 04 Cancel button in ui.html**

In [ui.html:2853-2860](../../../plugin/ui.html#L2853-L2860), find the Screen 04 cancel wiring:

```javascript
// Screen 04 (Build progress): Cancel → back
if (allCells[3]) {
  var footer = allCells[3].querySelector(".panel__footer");
  if (footer) {
    var secondary = footer.querySelector(".btn--secondary, .btn--ghost");
    if (secondary) secondary.addEventListener("click", goBack);
  }
}
```

Replace with:

```javascript
// Screen 04 (Build progress): Cancel → post cancel message, wait for
// build-result.cancelled, then transition to Done with partial counts.
if (allCells[3]) {
  var footer = allCells[3].querySelector(".panel__footer");
  if (footer) {
    var secondary = footer.querySelector(".btn--secondary, .btn--ghost");
    if (secondary) {
      secondary.addEventListener("click", function () {
        parent.postMessage(
          { pluginMessage: { type: "cancel" } },
          "*"
        );
        // UI waits for build-result.cancelled; build-result handler
        // (modified below) routes cancelled outcomes to showDoneScreen.
      });
    }
  }
}
```

- [ ] **Step 4: Handle build-result.cancelled in ui.html**

In [ui.html:3628-3634](../../../plugin/ui.html#L3628-L3634), find the build-result handler:

```javascript
if (msg.type === "build-result") {
  // Only sent on failure; success path uses build-complete.
  if (!msg.ok) {
    showBuildError(msg.error || "Build failed.");
  }
  return;
}
```

Replace with:

```javascript
if (msg.type === "build-result") {
  if (msg.cancelled) {
    // Treat cancel like a soft-complete: route to Done with partial counts
    // and a "Cancelled" title flag.
    var pageName = "Claude output";
    if (targetPageLabel && targetPageLabel.textContent) {
      pageName = targetPageLabel.textContent.trim() || pageName;
    }
    var counts = msg.counts || {};
    counts._cancelled = true;
    showDoneScreen(counts, pageName);
  } else if (!msg.ok) {
    showBuildError(msg.error || "Build failed.");
  }
  return;
}
```

- [ ] **Step 5: Update `showDoneScreen` to reflect cancelled state**

Find `showDoneScreen` at around [ui.html:3327](../../../plugin/ui.html#L3327). After the existing title-setting line, add a cancelled-title override:

```javascript
var doneTitle = screen05.querySelector(".done__title");
if (doneTitle) {
  if (counts._cancelled) {
    var total = (counts.states || 0) + (counts.modals || 0) + (counts.toasts || 0);
    doneTitle.textContent = "Cancelled — " + total + " of N built";
  } else {
    var total2 = (counts.states || 0) + (counts.modals || 0) + (counts.toasts || 0);
    doneTitle.textContent = "Built " + total2 + " artboards";
  }
}
```

(Replace the existing single-line `doneTitle.textContent = "Built ..."` with this conditional. The "N" in the cancelled title is a literal — we don't know the total without tracking it; this is a v0.1 simplification. If you want a real total, capture it on `progress` phase=start and reuse.)

- [ ] **Step 6: Manually verify in Figma**

Reload plugin. Run a build that produces ≥5 artboards (use CCP HTML). After ~2 artboards complete in the log, click Cancel.

Expected: Build halts within ≤1 artboard of the click. Transitions to Screen 05 showing "Cancelled — 2 of N built" in the title. Open Figma canvas — the band has the 2 completed artboards, no further ones, no crash.

- [ ] **Step 7: Commit**

```bash
git add plugin/code.js plugin/ui.html
git commit -m "feat(plugin): wire build cancel with hard-stop and partial-summary Done screen"
```

---

### Task B3: Build error retry path (gap 5)

**Files:**
- Modify: `plugin/ui.html` (`showBuildError`, build-result handler, cache `lastBuildPayload`)

- [ ] **Step 1: Cache `lastBuildPayload` when the build starts**

Find the Screen 03 → Build wiring at [ui.html:2819-2851](../../../plugin/ui.html#L2819-L2851). At the cross-screen state section ([ui.html:2360-2371](../../../plugin/ui.html#L2360-L2371)), add a new variable:

```javascript
var lastBuildPayload = null;
```

In the Build button handler at [ui.html:2824](../../../plugin/ui.html#L2824), where the `parent.postMessage` is constructed, cache the payload first:

```javascript
primary.addEventListener("click", function () {
  resetBuildProgressUI();
  navigateTo(3);
  buildStartedAt = Date.now();
  var candidates = scrapeCandidates(allCells[2]);
  var variantChoices = scrapeVariantChoices(allCells[2]);
  lastBuildPayload = {
    type: "build",
    parsed: lastParsedData || {},
    filename: lastFilename || "",
    candidates: candidates,
    variantChoices: variantChoices,
  };
  parent.postMessage({ pluginMessage: lastBuildPayload }, "*");
});
```

- [ ] **Step 2: Rewrite `showBuildError` to use `renderInlineError`**

Find `showBuildError` at [ui.html:3376-3392](../../../plugin/ui.html#L3376-L3392). Replace its body:

```javascript
function showBuildError(message) {
  var allCells = document.querySelectorAll(".strip__cell");
  var screen04 = allCells[3];
  if (!screen04) return;
  var topMeta = screen04.querySelector(".panel__topbar-meta");
  if (topMeta) topMeta.textContent = "Failed";
  var title = screen04.querySelector(".panel__title");
  if (title) title.textContent = "Build failed";
  var steps = screen04.querySelectorAll(".stepper__item");
  if (steps[2]) {
    steps[2].classList.remove("stepper__item--active");
    steps[2].classList.add("stepper__item--pending");
    var p = steps[2].querySelector(".stepper__progress");
    if (p) p.textContent = "error";
  }
  appendBuildLog(message || "Unknown error", "warn");
  renderInlineError(screen04, "build", message || "Build failed.", [
    {
      label: "Try again",
      onClick: function () {
        if (!lastBuildPayload) return;
        clearInlineErrors(screen04);
        resetBuildProgressUI();
        buildStartedAt = Date.now();
        parent.postMessage({ pluginMessage: lastBuildPayload }, "*");
      },
    },
    {
      label: "Back to coverage",
      onClick: function () {
        clearInlineErrors(screen04);
        goBack();
      },
    },
  ]);
}
```

- [ ] **Step 3: Manually verify in Figma**

Force a build error: temporarily edit `cpp-setting-tab-mockup.html` to break the dev-panel switch (e.g. remove all `case '...':` blocks). Paste, parse, build.

Expected: Build error banner appears on Screen 04 with Try again + Back to coverage. Click Back to coverage → returns to Screen 03 with state intact. Restore the HTML, click Build again from Screen 03 — build runs normally.

- [ ] **Step 4: Commit**

```bash
git add plugin/ui.html
git commit -m "feat(plugin): add Try again / Back to coverage actions to build errors"
```

---

### Task B4: Remove stale Done-screen Suggestions placeholder (gap 7)

**Files:**
- Modify: `plugin/ui.html` (Done screen list + showDoneScreen)

- [ ] **Step 1: Remove the Suggestions list item from Screen 05 markup**

Find the Done screen body around [ui.html:1686-1717](../../../plugin/ui.html#L1686-L1717). Locate the `<ul class="done__list">` and remove the line item for "DS Suggestions" (the fifth one, which is the placeholder). Keep the other four (states, modals, toasts, candidates).

- [ ] **Step 2: Update `showDoneScreen` count map**

In `showDoneScreen` around [ui.html:3354-3365](../../../plugin/ui.html#L3354-L3365), find the `countMap` array:

```javascript
var countMap = [
  counts.states || 0,
  counts.modals || 0,
  counts.toasts || 0,
  counts.candidates || 0,
  0, // DS Suggestions — not yet implemented
];
```

Remove the placeholder entry:

```javascript
var countMap = [
  counts.states || 0,
  counts.modals || 0,
  counts.toasts || 0,
  counts.candidates || 0,
];
```

- [ ] **Step 3: Manually verify in Figma**

Reload plugin. Run a complete build (CCP HTML). Reach Screen 05.

Expected: Done summary shows only four lines (states, modals, toasts, candidates). No "0 Suggestions" row.

- [ ] **Step 4: Commit**

```bash
git add plugin/ui.html
git commit -m "chore(plugin): remove stale Suggestions placeholder from Done screen"
```

---

## Phase C — Library import

### Task C1: code.js — library API handlers + `dsSync` rewrite

**Files:**
- Modify: `plugin/code.js` (rewrite `dsSync`, add three new message handlers)

- [ ] **Step 1: Rewrite `dsSync` for library-first flow**

Replace the entire `dsSync` function at [code.js:23-117](../../../plugin/code.js#L23-L117) with:

```javascript
// ============================================================
// DS sync — library-first, page-fallback.
// Reads clientStorage.dsLibrary; if set, enumerates that library's
// components. If not set, falls back to the legacy in-file
// "Design system" page flow (preserved for the canonical Control DS file).
// ============================================================

async function dsSync() {
  var storedLib = await figma.clientStorage.getAsync("dsLibrary");
  if (storedLib && storedLib.key) {
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
```

Keep the existing `manifestsEqual` function as-is.

- [ ] **Step 2: Add `list-libraries` handler**

In the `figma.ui.onmessage` switch at [code.js:1238](../../../plugin/code.js#L1238), add a new case after `case "ds-sync":` block (around line 1273):

```javascript
case "list-libraries": {
  try {
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
```

- [ ] **Step 3: Add `select-library` handler**

In the same switch, add another case:

```javascript
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
```

- [ ] **Step 4: Add `list-library-components` handler**

In the same switch:

```javascript
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
```

- [ ] **Step 5: Manually verify in Figma**

Reload plugin. Open Chrome DevTools on the plugin iframe (right-click → Inspect). In the console, post test messages:

```javascript
parent.postMessage({ pluginMessage: { type: "list-libraries" } }, "*");
```

Expected: a `libraries-list` message arrives in the iframe's `message` event log (you'll see it in the existing `console.log("From plugin:", msg);` fallback at [ui.html:3635](../../../plugin/ui.html#L3635)). It should contain the libraries enabled in your test Figma file. If none, `libraries: []`.

- [ ] **Step 6: Commit**

```bash
git add plugin/code.js
git commit -m "feat(plugin): library-first dsSync + three new library message handlers"
```

---

### Task C2: Screen L (Choose DS library)

**Files:**
- Modify: `plugin/ui.html` (add new `.strip__cell` markup, wire navigation + selection)

- [ ] **Step 1: Add Screen L markup**

Find the last `.strip__cell` in ui.html (Screen 11, ends around [ui.html:2340](../../../plugin/ui.html#L2340)). After its closing tag and before `</section>` (the strip section), add:

```html
<!-- ============================================================
     Screen L (12th cell) — Choose DS library
     New screen for library-first DS sourcing.
     ============================================================ -->
<div class="strip__cell" id="screenL">
  <div class="panel">
    <header class="panel__topbar">
      <button class="panel__back" aria-label="Back">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h2 class="panel__title">Choose DS library</h2>
    </header>
    <div class="panel__body">
      <p class="panel__caption">Select the design system library to source DS components from. Persists per file.</p>
      <div class="library-list" id="libraryList">
        <p class="library-list__empty">Loading libraries…</p>
      </div>
    </div>
    <footer class="panel__footer">
      <button class="btn btn--secondary" id="screenLCancel">Cancel</button>
      <button class="btn btn--primary btn--lg" id="screenLUse" disabled>Use this library</button>
    </footer>
  </div>
</div>
```

- [ ] **Step 2: Add minimal CSS for Screen L**

In the `<style>` block, near other panel-specific styles, add:

```css
.library-list { display: flex; flex-direction: column; gap: 6px; }
.library-list__item {
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg-primary);
}
.library-list__item:hover { background: var(--bg-secondary); }
.library-list__item.is-selected {
  border-color: var(--accent-primary);
  outline: 1px solid var(--accent-primary);
}
.library-list__name { font-weight: 500; color: var(--text-primary); }
.library-list__meta { font: 11px var(--font-mono); color: var(--text-secondary); }
.library-list__empty {
  color: var(--text-secondary);
  font-style: italic;
  text-align: center;
  padding: 24px;
}
```

- [ ] **Step 3: Wire Screen L logic in the IIFE**

In the script IIFE (after the existing `wireFooterButtons` definition around [ui.html:2882](../../../plugin/ui.html#L2882)), add Screen L wiring:

```javascript
// ---- Screen L (Choose DS library) ----
var screenLIdx = 11; // 12th .strip__cell (zero-indexed)
var screenLSelectedKey = null;
var screenLSelectedName = null;
function openScreenL() {
  screenLSelectedKey = null;
  screenLSelectedName = null;
  var useBtn = document.getElementById("screenLUse");
  if (useBtn) useBtn.disabled = true;
  var list = document.getElementById("libraryList");
  if (list) list.innerHTML = '<p class="library-list__empty">Loading libraries…</p>';
  parent.postMessage({ pluginMessage: { type: "list-libraries" } }, "*");
  navigateTo(screenLIdx);
}
function renderLibraryList(libraries, currentKey) {
  var list = document.getElementById("libraryList");
  if (!list) return;
  list.innerHTML = "";
  if (!libraries || libraries.length === 0) {
    var empty = document.createElement("p");
    empty.className = "library-list__empty";
    empty.textContent = "No libraries available in this file. Enable a library via Figma's Assets panel, then re-open this picker.";
    list.appendChild(empty);
    return;
  }
  libraries.forEach(function (lib) {
    var item = document.createElement("div");
    item.className = "library-list__item";
    if (lib.key === currentKey) {
      item.classList.add("is-selected");
      screenLSelectedKey = lib.key;
      screenLSelectedName = lib.name;
      var useBtn = document.getElementById("screenLUse");
      if (useBtn) useBtn.disabled = false;
    }
    var name = document.createElement("div");
    name.className = "library-list__name";
    name.textContent = lib.name;
    item.appendChild(name);
    if (lib.lastModified) {
      var meta = document.createElement("div");
      meta.className = "library-list__meta";
      meta.textContent = "Updated " + lib.lastModified;
      item.appendChild(meta);
    }
    item.addEventListener("click", function () {
      var allItems = list.querySelectorAll(".library-list__item");
      for (var i = 0; i < allItems.length; i++) allItems[i].classList.remove("is-selected");
      item.classList.add("is-selected");
      screenLSelectedKey = lib.key;
      screenLSelectedName = lib.name;
      var useBtn = document.getElementById("screenLUse");
      if (useBtn) useBtn.disabled = false;
    });
    list.appendChild(item);
  });
}
var screenLCancel = document.getElementById("screenLCancel");
if (screenLCancel) screenLCancel.addEventListener("click", goBack);
var screenLUse = document.getElementById("screenLUse");
if (screenLUse) {
  screenLUse.addEventListener("click", function () {
    if (!screenLSelectedKey) return;
    parent.postMessage(
      { pluginMessage: { type: "select-library", key: screenLSelectedKey, name: screenLSelectedName } },
      "*"
    );
  });
}
```

- [ ] **Step 4: Handle `libraries-list` and `library-set` responses**

In the message listener at [ui.html:3565-3636](../../../plugin/ui.html#L3565-L3636), add new handlers before the fallback `console.log` at line 3635:

```javascript
if (msg.type === "libraries-list") {
  renderLibraryList(msg.libraries || [], msg.currentKey);
  return;
}
if (msg.type === "library-set") {
  if (msg.sync) renderDsSync(msg.sync);
  goBack(); // return to Screen 02 (or wherever we came from)
  return;
}
```

- [ ] **Step 5: Manually verify in Figma**

Reload plugin. Open DevTools console and run:

```javascript
openScreenL();
```

Expected: Plugin transitions to Screen L. After ~1s the library list populates with the libraries enabled in the current Figma file. Click one — it gets a blue outline. Click "Use this library" — `select-library` posts, `library-set` returns with `sync.ok=true`, plugin navigates back to the previous screen with the green DS sync banner refreshed.

If no libraries are available in your test file: the empty-state message appears. To test happy path, ensure at least one team library is enabled.

- [ ] **Step 6: Commit**

```bash
git add plugin/ui.html
git commit -m "feat(plugin): add Screen L (Choose DS library) wired to teamLibrary API"
```

---

### Task C3: DS sync gate on Screen 02 + Screen 03 Build button (gap 6)

**Files:**
- Modify: `plugin/ui.html` (parse-result handler, Build button enable/disable, DS source chip → Screen L)

- [ ] **Step 1: Show warning banner on Screen 02 when `sync.ok === false`**

In the parse-result handler at [ui.html:3576-3593](../../../plugin/ui.html#L3576-L3593), after the `if (msg.sync) renderDsSync(msg.sync);` line, add:

```javascript
if (msg.sync && msg.sync.ok === false) {
  var allCells = document.querySelectorAll(".strip__cell");
  var screen02 = allCells[1];
  var actions = [
    {
      label: "Choose library",
      onClick: function () {
        clearInlineErrors(screen02);
        openScreenL();
      },
    },
  ];
  renderInlineError(screen02, "ds-sync", msg.sync.error || "DS sync failed.", actions);
}
```

- [ ] **Step 2: Gate the Build button on Screen 03**

Find the Screen 03 → Build wiring at [ui.html:2819-2851](../../../plugin/ui.html#L2819-L2851). Modify the wiring to disable the Build button when `sync.ok` is false. First, store `lastSyncOk` as a cross-screen state variable in the IIFE state block (line 2360):

```javascript
var lastSyncOk = false;
```

In the parse-result handler, update `lastSyncOk` and reflect on Screen 03's Build button:

```javascript
// After existing renderDsSync / banner / etc.:
lastSyncOk = !!(msg.sync && msg.sync.ok);
var screen03BuildBtn = document.querySelectorAll(".strip__cell")[2]
  .querySelector(".panel__footer .btn--primary");
if (screen03BuildBtn) screen03BuildBtn.disabled = !lastSyncOk;
```

Also add the same gating to the `library-set` handler so refreshing the library re-enables Build:

```javascript
if (msg.type === "library-set") {
  if (msg.sync) renderDsSync(msg.sync);
  lastSyncOk = !!(msg.sync && msg.sync.ok);
  var s03Btn = document.querySelectorAll(".strip__cell")[2]
    .querySelector(".panel__footer .btn--primary");
  if (s03Btn) s03Btn.disabled = !lastSyncOk;
  // Also clear sync error banners on Screen 02 if now ok
  if (lastSyncOk) {
    clearInlineErrors(document.querySelectorAll(".strip__cell")[1]);
  }
  goBack();
  return;
}
```

- [ ] **Step 3: Repeat the warning banner on Screen 03 when arriving there**

In `wireFooterButtons` ([ui.html:2800-2882](../../../plugin/ui.html#L2800-L2882)), modify the Screen 02 "Review DS mapping" primary handler (around line 2812):

```javascript
primary.addEventListener("click", function () {
  navigateTo(2);
  // Mirror the DS sync banner on Screen 03 if sync failed
  if (!lastSyncOk) {
    var s03 = document.querySelectorAll(".strip__cell")[2];
    renderInlineError(s03, "ds-sync",
      "DS sync hasn't succeeded yet. Build is blocked.",
      [{ label: "Choose library", onClick: openScreenL }]);
  }
});
```

- [ ] **Step 4: Manually verify in Figma**

Reload plugin in a Figma file that has NO libraries and NO "Design system" page. Paste valid HTML and click Parse HTML.

Expected: Navigates to Screen 02. Yellow warning banner reads "No DS library configured…" with "Choose library" button. Navigate to Screen 03 — Build button is disabled, banner repeated. Click "Choose library" → Screen L. Pick a library (or skip and go back). If you successfully select a library, return to Screen 02 with green banner; navigate to Screen 03 — Build button is enabled, banner cleared.

- [ ] **Step 5: Commit**

```bash
git add plugin/ui.html
git commit -m "feat(plugin): gate Build on DS sync; banner on Screen 02 + Screen 03"
```

---

## Phase D — Candidate matching

### Task D1: Screen M (Pick DS component) markup + wiring

**Files:**
- Modify: `plugin/ui.html` (add new `.strip__cell` for Screen M, wire navigation + search + selection)

- [ ] **Step 1: Add Screen M markup**

After the Screen L markup added in Task C2 (and before `</section>`), add:

```html
<!-- ============================================================
     Screen M (13th cell) — Pick DS component for candidate
     ============================================================ -->
<div class="strip__cell" id="screenM">
  <div class="panel">
    <header class="panel__topbar">
      <button class="panel__back" aria-label="Back">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h2 class="panel__title" id="screenMTitle">Pick DS component</h2>
    </header>
    <div class="panel__body">
      <input type="text" class="library-search" id="libraryComponentSearch" placeholder="Search components…">
      <div class="library-components" id="libraryComponentsList">
        <p class="library-list__empty">Loading components…</p>
      </div>
    </div>
    <footer class="panel__footer">
      <button class="btn btn--secondary" id="screenMCancel">Cancel</button>
      <button class="btn btn--primary btn--lg" id="screenMMatch" disabled>Match this component</button>
    </footer>
  </div>
</div>
```

- [ ] **Step 2: Add minimal CSS for Screen M**

In the `<style>` block:

```css
.library-search {
  width: 100%;
  padding: 8px 10px;
  margin-bottom: 10px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  font: 12px var(--font-base);
}
.library-components {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 480px;
  overflow-y: auto;
}
.library-components__item {
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  background: var(--bg-primary);
}
.library-components__item:hover { background: var(--bg-secondary); }
.library-components__item.is-selected {
  border-color: var(--accent-primary);
  outline: 1px solid var(--accent-primary);
}
.library-components__name { font-weight: 500; }
.library-components__variants { font: 10px var(--font-mono); color: var(--text-secondary); }
```

- [ ] **Step 3: Wire Screen M logic**

In the IIFE script, after the Screen L wiring block from Task C2, add Screen M wiring:

```javascript
// ---- Screen M (Pick DS component for candidate) ----
var screenMIdx = 12; // 13th .strip__cell (zero-indexed)
var screenMSelectedComponent = null;
var screenMCurrentCandidate = null;
var screenMReturnTarget = null; // 'candidate' (default) | 'manual-match'
var screenMComponentsCache = [];

function openScreenM(candidateName, returnTarget) {
  screenMCurrentCandidate = candidateName || null;
  screenMReturnTarget = returnTarget || "candidate";
  screenMSelectedComponent = null;
  var matchBtn = document.getElementById("screenMMatch");
  if (matchBtn) matchBtn.disabled = true;
  var title = document.getElementById("screenMTitle");
  if (title) title.textContent = candidateName
    ? "Pick DS component for: " + candidateName
    : "Pick DS component";
  var search = document.getElementById("libraryComponentSearch");
  if (search) search.value = "";
  parent.postMessage({ pluginMessage: { type: "list-library-components" } }, "*");
  navigateTo(screenMIdx);
}

function renderLibraryComponents(components, filter) {
  var list = document.getElementById("libraryComponentsList");
  if (!list) return;
  list.innerHTML = "";
  var f = (filter || "").toLowerCase().trim();
  var visible = components.filter(function (c) {
    if (!f) return true;
    return (c.name || "").toLowerCase().indexOf(f) !== -1 ||
      (c.variants || []).some(function (v) { return (v || "").toLowerCase().indexOf(f) !== -1; });
  });
  if (visible.length === 0) {
    var empty = document.createElement("p");
    empty.className = "library-list__empty";
    empty.textContent = f
      ? "No components match \"" + f + "\"."
      : "No components in this library.";
    list.appendChild(empty);
    return;
  }
  visible.forEach(function (c) {
    var item = document.createElement("div");
    item.className = "library-components__item";
    var name = document.createElement("span");
    name.className = "library-components__name";
    name.textContent = c.name;
    item.appendChild(name);
    if (c.variants && c.variants.length) {
      var v = document.createElement("span");
      v.className = "library-components__variants";
      v.textContent = c.variants.length + " variant" + (c.variants.length === 1 ? "" : "s");
      item.appendChild(v);
    }
    item.addEventListener("click", function () {
      var allItems = list.querySelectorAll(".library-components__item");
      for (var i = 0; i < allItems.length; i++) allItems[i].classList.remove("is-selected");
      item.classList.add("is-selected");
      screenMSelectedComponent = { componentKey: c.key, componentName: c.name };
      var matchBtn = document.getElementById("screenMMatch");
      if (matchBtn) matchBtn.disabled = false;
    });
    list.appendChild(item);
  });
}

var libSearchEl = document.getElementById("libraryComponentSearch");
if (libSearchEl) {
  libSearchEl.addEventListener("input", function () {
    renderLibraryComponents(screenMComponentsCache, libSearchEl.value);
  });
}

var screenMCancel = document.getElementById("screenMCancel");
if (screenMCancel) screenMCancel.addEventListener("click", goBack);

var screenMMatch = document.getElementById("screenMMatch");
if (screenMMatch) {
  screenMMatch.addEventListener("click", function () {
    if (!screenMSelectedComponent) return;
    if (screenMReturnTarget === "manual-match") {
      // Update Screen N's DS field directly; see Task E3 for that handler.
      if (typeof onManualMatchDsPicked === "function") {
        onManualMatchDsPicked(screenMSelectedComponent);
      }
      goBack();
    } else {
      parent.postMessage(
        {
          pluginMessage: {
            type: "register-candidate-mapping",
            candidateName: screenMCurrentCandidate,
            componentKey: screenMSelectedComponent.componentKey,
            componentName: screenMSelectedComponent.componentName,
          },
        },
        "*"
      );
      // mapping-set handler navigates back and updates the row
    }
  });
}
```

- [ ] **Step 4: Handle `library-components-list`**

In the message listener, add a handler near the other new ones:

```javascript
if (msg.type === "library-components-list") {
  screenMComponentsCache = msg.components || [];
  renderLibraryComponents(screenMComponentsCache, "");
  return;
}
```

- [ ] **Step 5: Manually verify in Figma**

Reload plugin. In DevTools console:

```javascript
openScreenM("Test candidate");
```

Expected: Plugin transitions to Screen M. After ~1s the components from your selected library populate. Type in the search box — list filters. Click a component → blue outline, "Match this component" enables. Click Cancel → returns to previous screen.

- [ ] **Step 6: Commit**

```bash
git add plugin/ui.html
git commit -m "feat(plugin): add Screen M (Pick DS component) with search + select"
```

---

### Task D2: Screen 03 Pick DS component button + mapping persistence

**Files:**
- Modify: `plugin/ui.html` (extend `renderCandidates` from Task A2 to include Pick DS component button, add mapping state, handle `mapping-set`)
- Modify: `plugin/code.js` (add `register-candidate-mapping` handler)

- [ ] **Step 1: Add `register-candidate-mapping` handler in code.js**

In the switch statement in `figma.ui.onmessage`, add:

```javascript
case "register-candidate-mapping": {
  try {
    var existing = (await figma.clientStorage.getAsync("candidateMappings")) || {};
    existing[msg.candidateName] = {
      componentKey: msg.componentKey,
      componentName: msg.componentName,
      variantName: msg.variantName || null,
    };
    await figma.clientStorage.setAsync("candidateMappings", existing);
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
```

- [ ] **Step 2: Add a load-on-startup for existing mappings**

Add a new handler `list-candidate-mappings`:

```javascript
case "list-candidate-mappings": {
  var existing = (await figma.clientStorage.getAsync("candidateMappings")) || {};
  figma.ui.postMessage({
    type: "candidate-mappings-list",
    mappings: existing,
  });
  break;
}
```

- [ ] **Step 3: Extend `renderCandidates` to include Pick DS component button**

Replace the `renderCandidates` function from Task A2 with this expanded version:

```javascript
function renderCandidates(candidates) {
  var allCells = document.querySelectorAll(".strip__cell");
  var screen03 = allCells[2];
  if (!screen03) return;
  var list = screen03.querySelector("#candidatesList");
  if (!list) return;
  list.innerHTML = "";
  if (!candidates || candidates.length === 0) {
    var empty = document.createElement("li");
    empty.className = "candidates-card__empty";
    empty.textContent = "No DS candidates detected. Annotate elements with data-ds-candidate=\"…\" in HTML to flag them.";
    empty.style.color = "var(--text-secondary)";
    empty.style.fontStyle = "italic";
    list.appendChild(empty);
    return;
  }
  candidates.forEach(function (cand) {
    var li = document.createElement("li");
    li.setAttribute("data-candidate", cand.name);
    var nameSpan = document.createElement("span");
    nameSpan.className = "candidates-card__list-name";
    nameSpan.textContent = cand.name;
    li.appendChild(nameSpan);
    var mappingChip = document.createElement("span");
    mappingChip.className = "candidates-card__mapping-chip";
    mappingChip.hidden = true;
    li.appendChild(mappingChip);
    var pickHtmlBtn = document.createElement("button");
    pickHtmlBtn.className = "candidates-card__upload-btn";
    pickHtmlBtn.type = "button";
    pickHtmlBtn.textContent = "Pick element";
    li.appendChild(pickHtmlBtn);
    var pickDsBtn = document.createElement("button");
    pickDsBtn.className = "candidates-card__ds-btn";
    pickDsBtn.type = "button";
    pickDsBtn.textContent = "Pick DS component";
    pickDsBtn.addEventListener("click", function () {
      openScreenM(cand.name, "candidate");
    });
    li.appendChild(pickDsBtn);
    var status = document.createElement("span");
    status.className = "candidates-card__upload-status";
    status.hidden = true;
    status.textContent = "✓";
    li.appendChild(status);
    list.appendChild(li);
  });
  // Repopulate mapping chips from any persisted state
  parent.postMessage({ pluginMessage: { type: "list-candidate-mappings" } }, "*");
}
```

- [ ] **Step 4: Add CSS for the new chip + DS button**

In the `<style>` block:

```css
.candidates-card__mapping-chip {
  font: 10px var(--font-mono);
  color: var(--accent-primary);
  padding: 2px 6px;
  background: rgba(19, 121, 243, 0.1);
  border-radius: 3px;
}
.candidates-card__ds-btn {
  margin-left: 6px;
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid var(--accent-primary);
  background: transparent;
  color: var(--accent-primary);
  border-radius: 3px;
  cursor: pointer;
}
.candidates-card__ds-btn:hover { background: rgba(19, 121, 243, 0.06); }
```

- [ ] **Step 5: Handle `mapping-set` and `candidate-mappings-list` in the message listener**

```javascript
if (msg.type === "mapping-set") {
  if (msg.error) {
    console.error("Failed to set mapping:", msg.error);
    return;
  }
  // Update the row's chip + DS button text + status check
  var s03 = document.querySelectorAll(".strip__cell")[2];
  var row = s03.querySelector('[data-candidate="' + msg.candidateName + '"]');
  if (row) {
    var chip = row.querySelector(".candidates-card__mapping-chip");
    if (chip) {
      chip.textContent = "→ " + msg.componentName;
      chip.hidden = false;
    }
    var dsBtn = row.querySelector(".candidates-card__ds-btn");
    if (dsBtn) dsBtn.textContent = "Change";
    var status = row.querySelector(".candidates-card__upload-status");
    if (status) status.hidden = false;
  }
  goBack(); // return from Screen M
  return;
}
if (msg.type === "candidate-mappings-list") {
  var s03 = document.querySelectorAll(".strip__cell")[2];
  var mappings = msg.mappings || {};
  Object.keys(mappings).forEach(function (name) {
    var row = s03.querySelector('[data-candidate="' + name + '"]');
    if (!row) return;
    var chip = row.querySelector(".candidates-card__mapping-chip");
    if (chip) {
      chip.textContent = "→ " + mappings[name].componentName;
      chip.hidden = false;
    }
    var dsBtn = row.querySelector(".candidates-card__ds-btn");
    if (dsBtn) dsBtn.textContent = "Change";
    var status = row.querySelector(".candidates-card__upload-status");
    if (status) status.hidden = false;
  });
  return;
}
```

- [ ] **Step 6: Manually verify in Figma**

Reload plugin. Parse the annotated CCP HTML, navigate to Screen 03. Click "Pick DS component" on the first candidate row → Screen M opens. Pick a component, click "Match this component" → returns to Screen 03 with the row showing "→ ComponentName" chip and a ✓.

Close the plugin and reopen. Re-parse + navigate to Screen 03. The previously-set mapping should still appear (loaded from clientStorage).

- [ ] **Step 7: Commit**

```bash
git add plugin/code.js plugin/ui.html
git commit -m "feat(plugin): wire Pick DS component on Screen 03 with persistent mappings"
```

---

### Task D3: Build pipeline — Candidates band with mappings

**Files:**
- Modify: `plugin/code.js` (extend `buildArtboards` to emit a DS Candidates band)

- [ ] **Step 1: Read candidate mappings and forward to build**

In ui.html's Build click handler (modified in Task B3), the payload already includes `candidates: scrapeCandidates(...)`. Replace or extend `scrapeCandidates` if needed so it uses the parser output. In the IIFE, find the existing `scrapeCandidates` helper or add this if missing:

```javascript
function scrapeCandidates(screen03) {
  // Pull candidate names + any captured htmlText from the rendered rows.
  var rows = screen03.querySelectorAll("#candidatesList li[data-candidate]");
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    out.push({
      name: rows[i].getAttribute("data-candidate"),
      // text content not displayed in row directly; rely on parser's htmlText via lastParsedData
    });
  }
  // Merge with parser's htmlText if available
  if (lastParsedData && Array.isArray(lastParsedData.candidates)) {
    var byName = {};
    lastParsedData.candidates.forEach(function (c) { byName[c.name] = c; });
    out.forEach(function (o) {
      if (byName[o.name] && byName[o.name].htmlText) o.htmlText = byName[o.name].htmlText;
    });
  }
  return out;
}
```

(If `scrapeCandidates` already exists, ensure it returns `[{name, htmlText?}]` shape.)

Also send the mappings on the build message. In the Build click handler, fetch mappings first:

```javascript
primary.addEventListener("click", function () {
  resetBuildProgressUI();
  navigateTo(3);
  buildStartedAt = Date.now();
  var candidates = scrapeCandidates(allCells[2]);
  var variantChoices = scrapeVariantChoices(allCells[2]);
  // Request mappings from clientStorage, then post build after they arrive
  pendingBuildPayload = {
    type: "build",
    parsed: lastParsedData || {},
    filename: lastFilename || "",
    candidates: candidates,
    variantChoices: variantChoices,
  };
  parent.postMessage({ pluginMessage: { type: "list-candidate-mappings-for-build" } }, "*");
});
```

Add `pendingBuildPayload` to the cross-screen state vars at the top of the IIFE:

```javascript
var pendingBuildPayload = null;
```

- [ ] **Step 2: Add `list-candidate-mappings-for-build` to code.js**

This is a distinct case from `list-candidate-mappings` so the UI knows to forward to a build. In code.js's onmessage switch:

```javascript
case "list-candidate-mappings-for-build": {
  var existing = (await figma.clientStorage.getAsync("candidateMappings")) || {};
  figma.ui.postMessage({
    type: "candidate-mappings-for-build",
    mappings: existing,
  });
  break;
}
```

- [ ] **Step 3: UI fires the actual build on mappings arrival**

In the ui.html message listener:

```javascript
if (msg.type === "candidate-mappings-for-build") {
  if (!pendingBuildPayload) return;
  pendingBuildPayload.candidateMappings = msg.mappings || {};
  lastBuildPayload = pendingBuildPayload;
  parent.postMessage({ pluginMessage: pendingBuildPayload }, "*");
  pendingBuildPayload = null;
  return;
}
```

- [ ] **Step 4: Extend `buildArtboards` to emit DS Candidates band**

In `buildArtboards` in code.js, after the existing states/modals/toasts loops, add a new section. Find the existing comment about DS Candidates band (or near the end of the build, before computing the `built` summary). Add:

```javascript
// ---- DS Candidates band ----
// One artboard per candidate. If the user mapped a candidate to a DS
// component via Screen M, instantiate that component. Otherwise create
// a labeled empty placeholder frame.
var candidatesInput = (payload.candidates || []);
var candidateMappings = (payload.candidateMappings || {});
if (candidatesInput.length > 0) {
  var candBandY = currentMaxY + 200; // currentMaxY tracked from previous loops
  var candHeader = figma.createText();
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  candHeader.fontName = { family: "Inter", style: "Regular" };
  candHeader.fontSize = 32;
  candHeader.characters = "DS Candidates — HTML structures not yet in DS";
  candHeader.x = BAND_X;
  candHeader.y = candBandY;
  targetPage.appendChild(candHeader);
  var candArtboardY = candBandY + 80;
  for (var ci = 0; ci < candidatesInput.length; ci++) {
    if (_cancelRequested) {
      figma.ui.postMessage({
        type: "build-result",
        ok: false,
        cancelled: true,
        counts: built,
      });
      return;
    }
    var cand = candidatesInput[ci];
    var artboard = figma.createFrame();
    artboard.name = "DS Candidate — " + cand.name;
    artboard.resize(ARTBOARD_W, ARTBOARD_H);
    artboard.x = BAND_X + (ci % GRID_COLS) * GRID_STRIDE_X;
    artboard.y = candArtboardY + Math.floor(ci / GRID_COLS) * GRID_STRIDE_Y;
    targetPage.appendChild(artboard);
    var mapping = candidateMappings[cand.name];
    if (mapping && mapping.componentKey) {
      try {
        var comp = await figma.importComponentByKeyAsync(mapping.componentKey);
        var inst = comp.createInstance();
        artboard.appendChild(inst);
        // Apply text overrides from cand.htmlText if present
        if (cand.htmlText) {
          // Find first text node and update; fallback to no-op.
          var textNodes = inst.findAll(function (n) { return n.type === "TEXT"; });
          if (textNodes && textNodes.length > 0) {
            await figma.loadFontAsync(textNodes[0].fontName);
            textNodes[0].characters = cand.htmlText;
          }
        }
      } catch (e) {
        // Fall back to placeholder if import fails
        var lbl = figma.createText();
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        lbl.fontName = { family: "Inter", style: "Regular" };
        lbl.fontSize = 14;
        lbl.characters = "(failed to import " + mapping.componentName + ")";
        artboard.appendChild(lbl);
      }
    } else {
      var lbl = figma.createText();
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      lbl.fontName = { family: "Inter", style: "Regular" };
      lbl.fontSize = 14;
      lbl.characters = cand.name + " (no DS mapping)";
      artboard.appendChild(lbl);
    }
    built.candidates += 1;
    figma.ui.postMessage({
      type: "progress",
      phase: "building",
      index: ci,
      total: candidatesInput.length,
      section: "candidates",
      name: artboard.name,
    });
  }
  currentMaxY = candArtboardY + Math.ceil(candidatesInput.length / GRID_COLS) * GRID_STRIDE_Y;
}
```

Notes:
- `currentMaxY` should already be tracked across the existing state/modal/toast loops. If not, initialize it from the band-origin computation and update after each loop.
- `targetPage` is the page object from earlier in `buildArtboards`. If named differently, adjust.

- [ ] **Step 5: Manually verify in Figma**

Reload plugin. Parse annotated CCP HTML. Set mappings for two of the three candidates via Screen M. Build.

Expected: Canvas now shows the existing state/modal/toast bands plus a new "DS Candidates" header at maxY+200, with 3 artboards in the 4×N grid. Two of them contain real DS instances (the ones you mapped); one contains a placeholder text "{name} (no DS mapping)". Done screen shows `Candidates: 3`.

- [ ] **Step 6: Commit**

```bash
git add plugin/code.js plugin/ui.html
git commit -m "feat(plugin): build DS Candidates band with optional component mappings"
```

---

## Phase E — Manual rescue match

### Task E1: code.js — selection listener

**Files:**
- Modify: `plugin/code.js` (add selection listener flag, start/stop handlers, postSelectionUpdate)

- [ ] **Step 1: Add module-level state and helper**

Above `var DS_KEYS = {` ([code.js:268](../../../plugin/code.js#L268)), add:

```javascript
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
        name: keyNode.name,
        parentName: keyNode.parent ? keyNode.parent.name : null,
      },
    });
  } else {
    figma.ui.postMessage({ type: "selection-update", component: null });
  }
}
```

- [ ] **Step 2: Add start/stop handlers in onmessage**

In the switch statement, add:

```javascript
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
```

- [ ] **Step 3: Stop listener on plugin close**

At the very top of code.js (before `figma.showUI`), add:

```javascript
figma.on("close", function () {
  if (_selectionListenerActive) {
    _selectionListenerActive = false;
    try { figma.off("selectionchange", _postSelectionUpdate); } catch (e) {}
  }
});
```

(`_postSelectionUpdate` and `_selectionListenerActive` are hoisted via `var`, so referencing them in the close handler at the top is safe.)

- [ ] **Step 4: Manually verify in Figma**

Reload plugin. In DevTools console:

```javascript
parent.postMessage({ pluginMessage: { type: "start-selection-listener" } }, "*");
```

Then click on a COMPONENT or INSTANCE in the Figma canvas. Watch the DevTools message log — a `selection-update` message arrives with the component info. Click elsewhere (deselect) — another `selection-update` arrives with `component: null`.

```javascript
parent.postMessage({ pluginMessage: { type: "stop-selection-listener" } }, "*");
```

Subsequent selection changes should NOT produce updates.

- [ ] **Step 5: Commit**

```bash
git add plugin/code.js
git commit -m "feat(plugin): add Figma selection listener for manual-match flow"
```

---

### Task E2: Screen N markup + panel resize + iframe wiring

**Files:**
- Modify: `plugin/ui.html` (add Screen N markup, wire enter/exit resize, wire HTML iframe field 1)

- [ ] **Step 1: Add Screen N markup**

After the Screen M markup added in Task D1 (before `</section>`), add:

```html
<!-- ============================================================
     Screen N (14th cell) — Manual match for parser misses
     ============================================================ -->
<div class="strip__cell" id="screenN">
  <div class="panel">
    <header class="panel__topbar">
      <button class="panel__back" aria-label="Back" id="screenNBack">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h2 class="panel__title">Manual match — for parser misses</h2>
    </header>
    <div class="panel__body manual-match__body">
      <div class="manual-match__fields">
        <div class="manual-match__field" id="manualHtmlField">
          <span class="manual-match__field-label">Select from HTML</span>
          <span class="manual-match__field-value" id="manualHtmlValue">Click an element in the preview below</span>
        </div>
        <div class="manual-match__field" id="manualDsField">
          <span class="manual-match__field-label">Select from DS</span>
          <span class="manual-match__field-value" id="manualDsValue">Select a component in Figma</span>
          <button class="manual-match__browse-link" id="manualBrowseLib" type="button">Browse library instead</button>
        </div>
      </div>
      <iframe class="manual-match__iframe" id="manualMatchIframe" sandbox="allow-same-origin allow-scripts"></iframe>
    </div>
    <footer class="panel__footer">
      <button class="btn btn--secondary" id="screenNCancel">Cancel</button>
      <button class="btn btn--primary btn--lg" id="screenNComplete" disabled>Match complete</button>
    </footer>
  </div>
</div>
```

- [ ] **Step 2: Add CSS for Screen N**

```css
.manual-match__body { display: flex; flex-direction: column; gap: 12px; }
.manual-match__fields { display: flex; gap: 12px; }
.manual-match__field {
  flex: 1;
  padding: 10px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
}
.manual-match__field-label {
  font: 11px var(--font-mono);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.manual-match__field-value {
  font-weight: 500;
  color: var(--text-primary);
  word-break: break-word;
}
.manual-match__field.is-empty .manual-match__field-value {
  color: var(--text-secondary);
  font-style: italic;
  font-weight: 400;
}
.manual-match__browse-link {
  background: none;
  border: none;
  color: var(--accent-primary);
  font-size: 11px;
  padding: 0;
  cursor: pointer;
  align-self: flex-start;
}
.manual-match__iframe {
  flex: 1;
  width: 100%;
  min-height: 500px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: white;
}
```

- [ ] **Step 3: Wire Screen N enter/exit + resize**

In the IIFE, add:

```javascript
// ---- Screen N (Manual match) ----
var screenNIdx = 13; // 14th .strip__cell (zero-indexed)
var manualHtmlSelection = null; // {selector, text}
var manualDsSelection = null;   // {componentKey, componentName}

function openScreenN() {
  manualHtmlSelection = null;
  manualDsSelection = null;
  updateManualMatchFields();
  // Load HTML into iframe
  var iframe = document.getElementById("manualMatchIframe");
  if (iframe && htmlInput && htmlInput.value) {
    iframe.srcdoc = htmlInput.value;
  }
  // Resize plugin window to give iframe room
  parent.postMessage({ pluginMessage: { type: "resize-ui", width: 800, height: 900 } }, "*");
  // Start listening to Figma selection
  parent.postMessage({ pluginMessage: { type: "start-selection-listener" } }, "*");
  navigateTo(screenNIdx);
}

function closeScreenN() {
  parent.postMessage({ pluginMessage: { type: "stop-selection-listener" } }, "*");
  parent.postMessage({ pluginMessage: { type: "resize-ui", width: 380, height: 800 } }, "*");
  goBack();
}

function updateManualMatchFields() {
  var htmlField = document.getElementById("manualHtmlField");
  var htmlValue = document.getElementById("manualHtmlValue");
  var dsField = document.getElementById("manualDsField");
  var dsValue = document.getElementById("manualDsValue");
  var completeBtn = document.getElementById("screenNComplete");
  if (manualHtmlSelection) {
    htmlField.classList.remove("is-empty");
    htmlValue.textContent = manualHtmlSelection.selector +
      (manualHtmlSelection.text ? " — \"" + manualHtmlSelection.text.slice(0, 60) + "\"" : "");
  } else {
    htmlField.classList.add("is-empty");
    htmlValue.textContent = "Click an element in the preview below";
  }
  if (manualDsSelection) {
    dsField.classList.remove("is-empty");
    dsValue.textContent = manualDsSelection.componentName +
      (manualDsSelection.parentName ? " (" + manualDsSelection.parentName + ")" : "");
  } else {
    dsField.classList.add("is-empty");
    dsValue.textContent = "Select a component in Figma";
  }
  if (completeBtn) completeBtn.disabled = !(manualHtmlSelection && manualDsSelection);
}

// Cancel + Back exit Screen N
var screenNCancel = document.getElementById("screenNCancel");
if (screenNCancel) screenNCancel.addEventListener("click", closeScreenN);
var screenNBack = document.getElementById("screenNBack");
if (screenNBack) screenNBack.addEventListener("click", closeScreenN);
```

- [ ] **Step 4: Wire iframe element click → field 1**

Inside the IIFE, add iframe wiring. The pattern mirrors the existing picker overlay iframe injection from [ui.html:3163-3217](../../../plugin/ui.html#L3163-L3217). Add:

```javascript
var manualIframe = document.getElementById("manualMatchIframe");
if (manualIframe) {
  manualIframe.addEventListener("load", function () {
    try {
      var doc = manualIframe.contentDocument;
      if (!doc) return;
      var style = doc.createElement("style");
      style.textContent =
        ".__manual-hover { outline: 2px solid #4ec3ff !important; outline-offset: 2px !important; cursor: crosshair !important; }" +
        ".__manual-selected { outline: 3px solid #2563eb !important; outline-offset: 3px !important; }";
      doc.head.appendChild(style);
      var selectedEl = null;
      var hoveredEl = null;
      doc.addEventListener("mouseover", function (e) {
        if (hoveredEl) hoveredEl.classList.remove("__manual-hover");
        hoveredEl = e.target;
        if (hoveredEl && hoveredEl !== selectedEl) hoveredEl.classList.add("__manual-hover");
      }, true);
      doc.addEventListener("mouseout", function () {
        if (hoveredEl) { hoveredEl.classList.remove("__manual-hover"); hoveredEl = null; }
      }, true);
      doc.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (selectedEl) selectedEl.classList.remove("__manual-selected");
        selectedEl = e.target;
        if (selectedEl) {
          selectedEl.classList.remove("__manual-hover");
          selectedEl.classList.add("__manual-selected");
          // Build a simple selector path + capture text
          var tag = (selectedEl.tagName || "").toLowerCase();
          var cls = "";
          if (selectedEl.className && typeof selectedEl.className === "string") {
            cls = "." + selectedEl.className.split(/\s+/)
              .filter(function (c) { return c && c.indexOf("__manual") !== 0; })
              .join(".");
          }
          var selector = tag + cls;
          var text = (selectedEl.textContent || "").trim().slice(0, 200);
          manualHtmlSelection = { selector: selector, text: text };
          updateManualMatchFields();
        }
      }, true);
    } catch (e) {
      console.error("Manual iframe wire failed:", e);
    }
  });
}
```

- [ ] **Step 5: Manually verify in Figma**

Reload plugin. Run the parse flow until you're on Screen 03. In DevTools console:

```javascript
openScreenN();
```

Expected: Plugin window resizes wider (800×900). HTML iframe loads the pasted HTML. Click any element inside the iframe → "Select from HTML" field populates with the selector + text snippet. "Select from DS" still says empty. "Match complete" is still disabled.

Click Cancel → window resizes back to 380×800, returns to Screen 03.

- [ ] **Step 6: Commit**

```bash
git add plugin/ui.html
git commit -m "feat(plugin): add Screen N (Manual match) with HTML iframe + field 1 capture"
```

---

### Task E3: Screen N field 2 (selection-update + browse-library fallback)

**Files:**
- Modify: `plugin/ui.html` (handle selection-update, wire browse fallback, expose onManualMatchDsPicked)

- [ ] **Step 1: Handle `selection-update` in the message listener**

```javascript
if (msg.type === "selection-update") {
  // Only act when Screen N is the active screen
  var cells = document.querySelectorAll(".strip__cell");
  if (!cells[screenNIdx] || !cells[screenNIdx].classList.contains("is-active")) return;
  if (msg.component) {
    manualDsSelection = {
      componentKey: msg.component.key,
      componentName: msg.component.name,
      parentName: msg.component.parentName,
    };
  } else {
    manualDsSelection = null;
  }
  updateManualMatchFields();
  return;
}
```

- [ ] **Step 2: Wire the "Browse library instead" link**

```javascript
var manualBrowseLib = document.getElementById("manualBrowseLib");
if (manualBrowseLib) {
  manualBrowseLib.addEventListener("click", function () {
    openScreenM(null, "manual-match");
  });
}
```

- [ ] **Step 3: Expose the callback Screen M's match handler calls**

In the IIFE (after `updateManualMatchFields`), add:

```javascript
// Called by Screen M when returnTarget === 'manual-match'.
// Updates Screen N's DS field instead of registering a candidate mapping.
function onManualMatchDsPicked(component) {
  manualDsSelection = {
    componentKey: component.componentKey,
    componentName: component.componentName,
    parentName: null,
  };
  updateManualMatchFields();
}
// Make it findable by the Screen M code that references it
window.onManualMatchDsPicked = onManualMatchDsPicked;
```

(Note: the Screen M handler from Task D1 already calls `onManualMatchDsPicked` if it exists. The function-hoisting of `function` declarations means this works as long as both are in the same IIFE scope.)

- [ ] **Step 4: Manually verify in Figma**

Reload plugin. From Screen 03, open Screen N (`openScreenN()` in console). Click an HTML element → field 1 populates. Switch to the Figma canvas, click on any COMPONENT or INSTANCE → field 2 populates with the component name. Match complete button enables.

Now test the browse fallback: click "Browse library instead" → Screen M opens. Pick a component → returns to Screen N with field 2 updated to the picked component name. Match complete button enables.

- [ ] **Step 5: Commit**

```bash
git add plugin/ui.html
git commit -m "feat(plugin): wire Screen N field 2 to selection listener and library browser"
```

---

### Task E4: Manual match register + Screen 03 list section

**Files:**
- Modify: `plugin/code.js` (register-manual-match handler, list-manual-matches handler)
- Modify: `plugin/ui.html` (wire Match complete, render Manual matches section on Screen 03)

- [ ] **Step 1: Add `register-manual-match` handler in code.js**

In the switch statement:

```javascript
case "register-manual-match": {
  try {
    var matches = (await figma.clientStorage.getAsync("manualMatches")) || [];
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
      componentName: msg.componentName,
      variantName: msg.variantName || null,
      capturedAt: new Date().toISOString(),
    });
    await figma.clientStorage.setAsync("manualMatches", matches);
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
```

- [ ] **Step 2: Add `list-manual-matches` and `remove-manual-match` handlers**

```javascript
case "list-manual-matches": {
  var matches = (await figma.clientStorage.getAsync("manualMatches")) || [];
  figma.ui.postMessage({ type: "manual-matches-list", matches: matches });
  break;
}

case "remove-manual-match": {
  var matches = (await figma.clientStorage.getAsync("manualMatches")) || [];
  if (typeof msg.index === "number" && msg.index >= 0 && msg.index < matches.length) {
    matches.splice(msg.index, 1);
    await figma.clientStorage.setAsync("manualMatches", matches);
  }
  figma.ui.postMessage({ type: "manual-matches-list", matches: matches });
  break;
}
```

- [ ] **Step 3: Wire the Match complete button**

In the IIFE (Screen N section):

```javascript
var screenNComplete = document.getElementById("screenNComplete");
if (screenNComplete) {
  screenNComplete.addEventListener("click", function () {
    if (!manualHtmlSelection || !manualDsSelection) return;
    parent.postMessage(
      {
        pluginMessage: {
          type: "register-manual-match",
          htmlSelector: manualHtmlSelection.selector,
          htmlText: manualHtmlSelection.text,
          componentKey: manualDsSelection.componentKey,
          componentName: manualDsSelection.componentName,
        },
      },
      "*"
    );
    // match-set handler closes Screen N and refreshes Screen 03 list
  });
}
```

- [ ] **Step 4: Add Manual matches section markup to Screen 03**

Find Screen 03's body in ui.html (search for `<section class="candidates-card">`). Below the candidates card's closing `</section>`, add:

```html
<section class="manual-matches-card">
  <header class="manual-matches-card__head">
    <h3>Manual matches</h3>
    <span class="manual-matches-card__count" id="manualMatchesCount">0</span>
  </header>
  <ul class="manual-matches-card__list" id="manualMatchesList">
    <!-- Populated dynamically from manual-matches-list message -->
  </ul>
  <button class="btn btn--ghost btn--sm" id="addManualMatchBtn" type="button">+ Add match</button>
</section>
```

- [ ] **Step 5: CSS for the section**

```css
.manual-matches-card { margin-top: 16px; }
.manual-matches-card__head {
  display: flex; align-items: center; gap: 8px;
  font: 600 13px var(--font-base);
  margin-bottom: 8px;
}
.manual-matches-card__count {
  font: 11px var(--font-mono);
  color: var(--text-secondary);
  padding: 2px 6px;
  background: var(--bg-secondary);
  border-radius: 3px;
}
.manual-matches-card__list { list-style: none; padding: 0; margin: 0 0 8px 0; }
.manual-matches-card__list li {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-default);
  font-size: 12px;
}
.manual-matches-card__list li:last-child { border-bottom: none; }
.manual-matches-card__list .remove-btn {
  background: none; border: none; cursor: pointer;
  color: var(--text-secondary); font-size: 14px;
}
.manual-matches-card__list .remove-btn:hover { color: var(--accent-error); }
```

- [ ] **Step 6: Wire the section in JS**

```javascript
function renderManualMatches(matches) {
  var allCells = document.querySelectorAll(".strip__cell");
  var s03 = allCells[2];
  if (!s03) return;
  var listEl = s03.querySelector("#manualMatchesList");
  var countEl = s03.querySelector("#manualMatchesCount");
  if (countEl) countEl.textContent = String((matches || []).length);
  if (!listEl) return;
  listEl.innerHTML = "";
  (matches || []).forEach(function (m, idx) {
    var li = document.createElement("li");
    var label = document.createElement("span");
    label.textContent = m.htmlSelector + " → " + m.componentName;
    li.appendChild(label);
    var removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove this match";
    removeBtn.addEventListener("click", function () {
      parent.postMessage(
        { pluginMessage: { type: "remove-manual-match", index: idx } },
        "*"
      );
    });
    li.appendChild(removeBtn);
    listEl.appendChild(li);
  });
}

var addManualMatchBtn = document.getElementById("addManualMatchBtn");
if (addManualMatchBtn) addManualMatchBtn.addEventListener("click", openScreenN);

// On parse-result arrival, also fetch existing manual matches
// (added inline to existing handler):
//   parent.postMessage({ pluginMessage: { type: "list-manual-matches" } }, "*");
```

In the existing parse-result handler (where the candidate-mappings-list request happens), add:

```javascript
parent.postMessage({ pluginMessage: { type: "list-manual-matches" } }, "*");
```

In the message listener, handle the response:

```javascript
if (msg.type === "manual-matches-list") {
  renderManualMatches(msg.matches || []);
  return;
}

if (msg.type === "match-set") {
  if (msg.error) {
    var s = document.querySelectorAll(".strip__cell")[screenNIdx];
    renderInlineError(s, "match", msg.error, [
      {label: "Dismiss", onClick: function () { clearInlineErrors(s); }},
    ]);
    return;
  }
  renderManualMatches(msg.matches || []);
  closeScreenN();
  return;
}
```

- [ ] **Step 7: Manually verify in Figma**

Reload plugin. Parse CCP HTML. Navigate to Screen 03. Click "+ Add match" → Screen N opens. Pick an HTML element (e.g. an input field), then click a Figma component to populate field 2. Click "Match complete" → returns to Screen 03 with the Manual matches section now showing the new entry, count incremented to 1.

Click the × on the entry → it's removed, count goes back to 0. Add another → it appears again. Close and reopen plugin, re-parse — the saved manual matches should reappear in the Screen 03 list (loaded from clientStorage).

- [ ] **Step 8: Commit**

```bash
git add plugin/code.js plugin/ui.html
git commit -m "feat(plugin): persist manual matches; list on Screen 03 with add/remove"
```

---

### Task E5: Build pipeline — Matched elements band

**Files:**
- Modify: `plugin/code.js` (`buildArtboards` — add Matched elements band after DS Candidates)
- Modify: `plugin/ui.html` (forward manualMatches in build payload; Done screen count)

- [ ] **Step 1: Send manual matches in build payload**

In ui.html, in the Build click handler from Task D3, extend the pendingBuildPayload to include manual matches. Modify the `list-candidate-mappings-for-build` flow into a slightly bigger fetch. Add a new code.js handler:

```javascript
case "prepare-build": {
  var mappings = (await figma.clientStorage.getAsync("candidateMappings")) || {};
  var matches = (await figma.clientStorage.getAsync("manualMatches")) || [];
  figma.ui.postMessage({
    type: "build-prepared",
    candidateMappings: mappings,
    manualMatches: matches,
  });
  break;
}
```

Replace the `list-candidate-mappings-for-build` flow in ui.html. In the Build click handler:

```javascript
primary.addEventListener("click", function () {
  resetBuildProgressUI();
  navigateTo(3);
  buildStartedAt = Date.now();
  var candidates = scrapeCandidates(allCells[2]);
  var variantChoices = scrapeVariantChoices(allCells[2]);
  pendingBuildPayload = {
    type: "build",
    parsed: lastParsedData || {},
    filename: lastFilename || "",
    candidates: candidates,
    variantChoices: variantChoices,
  };
  parent.postMessage({ pluginMessage: { type: "prepare-build" } }, "*");
});
```

Add the `build-prepared` handler in ui.html's listener (replace the previous `candidate-mappings-for-build` handler):

```javascript
if (msg.type === "build-prepared") {
  if (!pendingBuildPayload) return;
  pendingBuildPayload.candidateMappings = msg.candidateMappings || {};
  pendingBuildPayload.manualMatches = msg.manualMatches || [];
  lastBuildPayload = pendingBuildPayload;
  parent.postMessage({ pluginMessage: pendingBuildPayload }, "*");
  pendingBuildPayload = null;
  return;
}
```

Remove or leave the older `list-candidate-mappings-for-build` handler — it's no longer called from the build flow, but harmless if left.

- [ ] **Step 2: Extend `buildArtboards` to emit Matched elements band**

In `buildArtboards` in code.js, after the DS Candidates band added in Task D3, add:

```javascript
// ---- Matched elements band ----
// One artboard per manual match. Real DS instance + text overrides
// from the captured htmlText.
var manualMatches = (payload.manualMatches || []);
if (manualMatches.length > 0) {
  var matchBandY = currentMaxY + 200;
  var matchHeader = figma.createText();
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  matchHeader.fontName = { family: "Inter", style: "Regular" };
  matchHeader.fontSize = 32;
  matchHeader.characters = "Matched elements — manually mapped";
  matchHeader.x = BAND_X;
  matchHeader.y = matchBandY;
  targetPage.appendChild(matchHeader);
  var matchArtboardY = matchBandY + 80;
  for (var mi = 0; mi < manualMatches.length; mi++) {
    if (_cancelRequested) {
      figma.ui.postMessage({
        type: "build-result",
        ok: false,
        cancelled: true,
        counts: built,
      });
      return;
    }
    var match = manualMatches[mi];
    var artboard = figma.createFrame();
    artboard.name = "Match — " + match.componentName;
    artboard.resize(ARTBOARD_W, ARTBOARD_H);
    artboard.x = BAND_X + (mi % GRID_COLS) * GRID_STRIDE_X;
    artboard.y = matchArtboardY + Math.floor(mi / GRID_COLS) * GRID_STRIDE_Y;
    targetPage.appendChild(artboard);
    try {
      var comp = await figma.importComponentByKeyAsync(match.componentKey);
      var inst = comp.createInstance();
      artboard.appendChild(inst);
      if (match.htmlText) {
        var textNodes = inst.findAll(function (n) { return n.type === "TEXT"; });
        if (textNodes && textNodes.length > 0) {
          await figma.loadFontAsync(textNodes[0].fontName);
          textNodes[0].characters = match.htmlText;
        }
      }
    } catch (e) {
      var lbl = figma.createText();
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      lbl.fontName = { family: "Inter", style: "Regular" };
      lbl.fontSize = 14;
      lbl.characters = "(failed to import " + match.componentName + ")";
      artboard.appendChild(lbl);
    }
    built.manualMatches += 1;
    figma.ui.postMessage({
      type: "progress",
      phase: "building",
      index: mi,
      total: manualMatches.length,
      section: "manual-matches",
      name: artboard.name,
    });
  }
  currentMaxY = matchArtboardY + Math.ceil(manualMatches.length / GRID_COLS) * GRID_STRIDE_Y;
}
```

- [ ] **Step 3: Update Done screen to show manualMatches count**

The Done screen's `<ul class="done__list">` currently has 4 line items (states, modals, toasts, candidates after Task B4 cleanup). Add a fifth `<li>` for matched elements. Find the Done body around [ui.html:1686](../../../plugin/ui.html#L1686):

```html
<li><span class="done__list-num">0</span> Matched elements</li>
```

Update `showDoneScreen`'s `countMap` to include manualMatches:

```javascript
var countMap = [
  counts.states || 0,
  counts.modals || 0,
  counts.toasts || 0,
  counts.candidates || 0,
  counts.manualMatches || 0,
];
```

- [ ] **Step 4: Ensure build-complete payload includes manualMatches**

Find where `build-complete` is posted in code.js (search `type: "build-complete"`). Ensure the counts object includes `manualMatches: built.manualMatches`. Example:

```javascript
figma.ui.postMessage({
  type: "build-complete",
  counts: {
    states: built.states,
    modals: built.modals,
    toasts: built.toasts,
    candidates: built.candidates,
    manualMatches: built.manualMatches,
    warnings: warnings.length || 0,
  },
});
```

- [ ] **Step 5: Manually verify in Figma**

Reload plugin. Parse annotated CCP HTML. On Screen 03, click "+ Add match", create 2 manual matches with different DS components. Build.

Expected: Canvas shows existing bands (states, modals, toasts), then DS Candidates band, then a new "Matched elements — manually mapped" header, then 2 artboards each named `Match — {componentName}` with the chosen DS component instantiated and (if a text node existed) text overridden to the matched HTML element's text content.

Screen 05 Done summary lists: states, modals, toasts, candidates: 3, matched elements: 2.

- [ ] **Step 6: Commit**

```bash
git add plugin/code.js plugin/ui.html
git commit -m "feat(plugin): build Matched elements band from persisted manual matches"
```

---

## Final validation

### Task F1: End-to-end smoke test

- [ ] **Step 1: Fresh-environment dry run**

Close and reopen the plugin in Figma. Run the full happy path with a fresh test:

1. Paste annotated CCP HTML.
2. Click Parse HTML →
3. Screen 02 banner: if first run, should say "No DS library configured" — click Choose library → Screen L → pick a library → return to Screen 02 (banner green).
4. Click Review DS mapping → Screen 03.
5. For each of 3 candidates: click "Pick DS component" → Screen M → pick + match.
6. Click + Add match → Screen N → pick an HTML element + Figma component → Match complete.
7. Click Build N artboards → Screen 04 progress streams.
8. Wait for completion → Screen 05 Done.
9. Click Show on canvas → Figma viewport jumps to the band.

- [ ] **Step 2: Verify outputs on canvas**

Expected on the canvas after the run:

- States band: `Setting - CCP - {State}` artboards from the parsed HTML
- Modals band: `Setting - CCP - Modal {Title}` artboards
- Toasts band: `Setting - CCP - Toast {label}` artboards
- DS Candidates band header at maxY + 200, then 3 artboards (mapped ones contain real DS instances; unmapped one has placeholder text)
- Matched elements band header at maxY + 200, then 1 artboard `Match — {componentName}` with the DS component + text override

- [ ] **Step 3: Cancel mid-build smoke test**

Re-run from a fresh state. After Build starts and ≥2 artboards complete, click Cancel.

Expected: Build halts within ≤1 artboard. Screen 05 reads "Cancelled — N of N built". Canvas shows partial band, no half-completed artboards.

- [ ] **Step 4: Parse error smoke test**

Paste malformed HTML (e.g. random text). Parse.

Expected: Red banner on Screen 01 with parse error + Dismiss. No transition to Screen 02.

- [ ] **Step 5: DS sync gate smoke test**

Open plugin in a Figma file with no libraries enabled and no `Design system` page. Parse valid HTML.

Expected: Screen 02 shows yellow banner "No DS library configured". Screen 03 Build button disabled. Choose library button works.

- [ ] **Step 6: Commit final state**

```bash
git add -A
git commit -m "test(plugin): manual smoke tests pass for v0.1 state machine and new features"
```

---

## Self-review (executed by the planner before handoff)

**Spec coverage:** Every feature from §2 of the spec maps to at least one task:
- §2.1 (renderInlineError helper) → Task A1
- §2.2 Gap 1 (parse error) → Task B1
- §2.2 Gap 3 (candidates from parser) → Task A2
- §2.2 Gap 4 (cancel) → Task B2
- §2.2 Gap 5 (build retry) → Task B3
- §2.2 Gap 6 (DS sync gate) → Task C3
- §2.2 Gap 7 (Done placeholder) → Task B4
- §2.3 (Library import + Screen L) → Tasks C1, C2
- §2.4 (Candidate matching Screen M) → Tasks D1, D2
- §2.4 (Build pipeline candidates band) → Task D3
- §2.5 (Manual rescue Screen N) → Tasks E1, E2, E3, E4
- §2.5 (Matched elements band) → Task E5

**Placeholder scan:** No "TBD", no "implement later", no "Add appropriate error handling" — every step contains literal code. The phrase "If `scrapeCandidates` already exists" in Task D3 acknowledges existing code we'd need to inspect; this is intentional (the plan can't enumerate all existing helpers).

**Type consistency:** `componentKey` / `componentName` / `variantName?` shape consistent across Tasks D2, E2, E3, E4, E5. `_cancelRequested` flag set in Task B2, checked in Tasks D3 and E5. `targetPage` and `currentMaxY` referenced in Tasks D3 and E5 assume the existing `buildArtboards` provides them — verify on first read of code.js.

**Open risks:**
- The exact Figma library API surface (Task C1) may diverge from the code in Step 1. Test in Figma early; adapt field names if `lib.libraryKey` vs `lib.key` mismatch.
- `currentMaxY` in `buildArtboards` may not be tracked as a single variable in the existing code; the implementor may need to inspect and add it.

---

_Plan complete. Ready for implementation._
