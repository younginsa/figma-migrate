// Per-file settings live in figma.root pluginData (NOT clientStorage).
// clientStorage is per-user-global and would leak selections across files;
// figma.fileKey requires private-API publishing, so it's not viable for
// scoping clientStorage by file either. See v0.2-decisions.md §Phase 9a storage.
const PLUGIN_DATA_KEY = 'figma-migrate:v0.2:settings';
const DEFAULT_TARGET_PAGE_NAME = 'figma-migrate output';
const DEFAULT_COMPONENTS_PAGE_NAME = 'Components (generated)';

let currentSettings = null;

// Validate saved selections against the file's current page list. Stored
// {id, name} entries fall back to defaults if the page was deleted; the
// display name is refreshed from the live page list. {create, name}
// entries pass through unchanged — they're intents, not refs.
function resolveSettings(saved, pages, currentPageId) {
  const pageById = new Map(pages.map((p) => [p.id, p]));

  function resolveOne(s, fallback) {
    if (!s) return fallback;
    if (s.create === true && typeof s.name === 'string' && s.name.length > 0) {
      return { create: true, name: s.name };
    }
    if (s.id && pageById.has(s.id)) {
      return { id: s.id, name: pageById.get(s.id).name };
    }
    return fallback;
  }

  const currentPage = pageById.get(currentPageId);
  const firstPage = pages[0];
  const targetDefault = currentPage
    ? { id: currentPage.id, name: currentPage.name }
    : (firstPage ? { id: firstPage.id, name: firstPage.name } : { create: true, name: DEFAULT_TARGET_PAGE_NAME });
  const componentsDefault = firstPage
    ? { id: firstPage.id, name: firstPage.name }
    : { create: true, name: DEFAULT_COMPONENTS_PAGE_NAME };

  return {
    targetPage: resolveOne(saved && saved.targetPage, targetDefault),
    componentsPage: resolveOne(saved && saved.componentsPage, componentsDefault),
    componentizeThreshold: (saved && typeof saved.componentizeThreshold === 'number') ? saved.componentizeThreshold : 5,
    addScreenshotBackground: !!(saved && saved.addScreenshotBackground),
  };
}

figma.showUI(__html__, { width: 380, height: 800 });

(async function init() {
  // One-time cleanup of the old per-user-global key from the previous design.
  // Best-effort — failures are ignored.
  try { await figma.clientStorage.deleteAsync('figma-migrate:v0.2:settings:session'); } catch (e) { /* ignore */ }

  const pages = figma.root.children.map((p) => ({ id: p.id, name: p.name }));
  let saved = null;
  try {
    const raw = figma.root.getPluginData(PLUGIN_DATA_KEY); // returns '' if unset, never undefined
    saved = raw ? JSON.parse(raw) : null;
  } catch (e) {
    saved = null; // corrupt data → treat as fresh
  }
  currentSettings = resolveSettings(saved, pages, figma.currentPage.id);

  figma.ui.postMessage({
    type: 'init-settings',
    pages: pages,
    currentPageId: figma.currentPage.id,
    settings: currentSettings,
  });
})();

figma.ui.onmessage = (msg) => {
  if (!msg) return;
  if (msg.type === 'close') {
    figma.closePlugin();
  } else if (msg.type === 'resize') {
    figma.ui.resize(msg.width, msg.height);
  } else if (msg.type === 'settings-update') {
    currentSettings = Object.assign({}, currentSettings || {}, msg.patch || {});
    // setPluginData is synchronous on figma.root.
    figma.root.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(currentSettings));
  }
};
