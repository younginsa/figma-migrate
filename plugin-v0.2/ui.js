// figma-migrate v0.2 — UI controller (Phase 4 + Phase 5)
// Owns the state machine, screen renders, and event handlers.
// Depends on:
//   window.figmaMigrateParser (parser.js)
//   window.Sortable           (lib/sortable.min.js)
//   window.html2canvas        (lib/html2canvas.min.js)

(function () {
  'use strict';

  const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

  const state = {
    screen: 'screen1',         // 'screen1' | 'detecting' | 'snapshot' | 'screen2'
    inputHtml: '',
    inputName: '',
    parseResult: null,
    detectResult: null,
    captures: [],
    snapshotZoom: 0.5,
    snapshotUiBuilt: false,
    editingLabelId: null,
    // Phase 7 — Screen 2 selection mode + groups
    selectionMode: false,
    selectedPatterns: new Set(),  // pattern keys (standalones only) checked for next merge
    selectedGroupId: null,        // group id currently --selected (single-select)
    editingGroupId: null,         // group id whose name is being inline-edited
    groups: [],                   // [{ id, name, variantPrefix, patternKeys, variants, totalCount }]
    // Phase 8 — Pattern Detail (Screen 3)
    activePattern: null,           // pattern object currently shown in detail view
    activeInstanceIdx: null,       // which instance row is expanded (single-open)
    instanceListExpanded: false,   // user clicked "+N more…"
    instanceShowCode: false,       // "Show code" toggle in the open instance
    patternDetailZoom: 0.5,        // iframe scale factor in the open instance
    // Phase 9a — settings (Target page / Components page selection)
    // Overwritten by 'init-settings' from code.js shortly after boot.
    settings: {
      targetPage:     { create: true, name: 'figma-migrate output' },
      componentsPage: { create: true, name: 'Components (generated)' },
      componentizeThreshold: 5,
      addScreenshotBackground: false,
    },
    availablePages: [],            // [{id, name}] from figma.root.children
    createIntents: { target: [], comp: [] },  // create-intent names per dropdown
  };

  const els = {
    topbarTitle:   document.getElementById('topbar-title'),
    topbarEyebrow: document.getElementById('topbar-eyebrow'),
    body:          document.getElementById('body'),
    banner:        document.getElementById('banner-mount'),
    footer:        document.getElementById('footer'),
    fileInput:     document.getElementById('file-input'),
  };

  // ============================================================
  // render dispatch
  // ============================================================

  function setTopbar(title, eyebrow) {
    els.topbarTitle.textContent = title;
    els.topbarEyebrow.textContent = eyebrow;
  }

  function render() {
    if (state.screen === 'snapshot') {
      els.body.className = 'panel__body panel__body--snapshot';
      renderScreen1b();
    } else if (state.screen === 'screen2') {
      els.body.className = 'panel__body panel__body--screen2';
      renderScreen2();
    } else if (state.screen === 'pattern-detail') {
      els.body.className = 'panel__body';
      renderPatternDetail();
    } else {
      els.body.className = 'panel__body';
      renderScreen1();
    }
  }

  // ============================================================
  // Screen 1 — Paste HTML
  // ============================================================

  function renderScreen1() {
    const detecting = state.screen === 'detecting';
    setTopbar('figma-migrate', 'Pattern-group · v0.2');
    els.body.innerHTML =
      '<p class="section-label">Source</p>' +
      '<div class="drop" id="drop-zone">' +
        '<div class="drop__icon">⌘</div>' +
        '<p class="drop__title">Paste HTML or drop file</p>' +
        '<p class="drop__hint">Click to pick a file, or paste below.</p>' +
      '</div>' +
      '<textarea class="drop__textarea" id="input-html" placeholder="' + escapeAttr(PLACEHOLDER) + '"></textarea>' +
      '<div style="margin-top:16px;">' +
        '<p class="section-label">Configuration</p>' +
        configRowHtml('dd-s1-target', 'target', 'Target page') +
        configRowHtml('dd-s1-comp', 'comp', 'Components page') +
      '</div>';

    const ta = document.getElementById('input-html');
    ta.value = state.inputHtml;
    ta.disabled = detecting;

    const drop = document.getElementById('drop-zone');
    if (detecting) {
      drop.style.opacity = '0.6';
      drop.style.pointerEvents = 'none';
    }

    els.banner.innerHTML = '';
    els.footer.className = 'panel__footer panel__footer--split';
    els.footer.innerHTML =
      '<button class="btn btn--secondary btn--icon" id="settings-btn" aria-label="Settings">' + SETTINGS_ICON_SVG + '</button>' +
      '<button class="btn btn--primary" id="detect-btn" style="flex:1;">' +
        (detecting ? 'Detecting…' : 'Detect states') +
      '</button>';

    const detectBtn = document.getElementById('detect-btn');
    detectBtn.disabled = detecting || !state.inputHtml.trim();

    if (!detecting) {
      ta.addEventListener('input', onTextareaInput);
      drop.addEventListener('click', () => els.fileInput.click());
      drop.addEventListener('dragover', onDragOver);
      drop.addEventListener('dragleave', onDragLeave);
      drop.addEventListener('drop', onDrop);
      detectBtn.addEventListener('click', startDetection);
      bindConfigRows();
    }
  }

  // ============================================================
  // Screen 1b — Snapshot UI (Phase 5)
  // Built once on first entry; gallery re-renders on changes,
  // iframe stays alive so designer interactions persist.
  // ============================================================

  function renderScreen1b() {
    setTopbar(state.inputName || 'Pasted HTML', snapshotSubtitle());

    if (!state.snapshotUiBuilt) {
      els.body.innerHTML = buildSnapshotShell();
      document.getElementById('preview-area').style.setProperty('--zoom', String(state.snapshotZoom));
      document.getElementById('zoom-indicator').textContent = Math.round(state.snapshotZoom * 100) + '%';

      const iframe = document.getElementById('preview-iframe');
      iframe.srcdoc = state.inputHtml;

      document.getElementById('reload-btn').addEventListener('click', onReload);
      document.getElementById('zoom-in-btn').addEventListener('click', onZoomIn);
      document.getElementById('zoom-out-btn').addEventListener('click', onZoomOut);
      document.getElementById('capture-btn').addEventListener('click', onCaptureClick);

      renderGallery();
      window.Sortable.create(document.getElementById('gallery-list'), {
        handle: '.snapshot-card__drag',
        animation: 150,
        ghostClass: 'snapshot-card--dragging',
        onEnd: onReorderEnd,
      });

      state.snapshotUiBuilt = true;
      generateAllThumbnails();
    }

    els.banner.innerHTML = state.showSnapshotBanner
      ? '<div class="banner">✓ Logged to console — Screen 2 wires in Phase 6</div>'
      : '';

    els.footer.className = 'panel__footer';
    els.footer.innerHTML = '<button class="btn btn--primary" id="done-btn">' + doneBtnLabel() + '</button>';
    document.getElementById('done-btn').addEventListener('click', onSnapshotDone);
  }

  function buildSnapshotShell() {
    return '' +
      '<div class="snapshot-body">' +
        '<div class="preview-area" id="preview-area">' +
          '<div class="preview-toolbar">' +
            '<span class="preview-toolbar__title">' + escapeText(state.inputName || 'Pasted HTML') + '</span>' +
            '<div class="preview-toolbar__controls">' +
              '<button class="preview-toolbar__btn" id="reload-btn" title="Reload">↻</button>' +
              '<button class="preview-toolbar__btn" id="zoom-out-btn" title="Zoom out">−</button>' +
              '<span class="preview-toolbar__zoom" id="zoom-indicator">50%</span>' +
              '<button class="preview-toolbar__btn" id="zoom-in-btn" title="Zoom in">+</button>' +
            '</div>' +
          '</div>' +
          '<div class="preview-iframe-wrap">' +
            '<div class="preview-iframe-inner">' +
              '<iframe class="preview-iframe" id="preview-iframe" sandbox="allow-scripts allow-same-origin"></iframe>' +
            '</div>' +
          '</div>' +
          '<div class="preview-action">' +
            '<button class="capture-btn" id="capture-btn">' + PLUS_ICON_SVG + 'Capture this state</button>' +
          '</div>' +
        '</div>' +
        '<div class="snapshot-gallery">' +
          '<div class="snapshot-gallery__header">' +
            '<span class="snapshot-gallery__title">Captured states</span>' +
            '<span class="snapshot-gallery__count" id="gallery-count">' + state.captures.length + '</span>' +
          '</div>' +
          '<div class="snapshot-gallery__list" id="gallery-list"></div>' +
        '</div>' +
      '</div>';
  }

  function renderGallery() {
    const list = document.getElementById('gallery-list');
    if (!list) return;
    list.innerHTML = state.captures.map((c) => cardHtml(c)).join('');
    bindCardHandlers();
    if (state.editingLabelId) {
      const input = list.querySelector('[data-capture-id="' + cssAttrEscape(state.editingLabelId) + '"] .snapshot-card__label-input');
      if (input) {
        input.focus();
        input.select();
      }
    }
  }

  function cardHtml(c) {
    const badge = c.source === 'boot'
      ? '<span class="snapshot-card__boot-badge">boot</span>'
      : c.source === 'auto'
        ? '<span class="snapshot-card__auto-badge">auto</span>'
        : '';
    const thumbContent = c.thumbnail
      ? '<img src="' + c.thumbnail + '" alt="">'
      : '<div class="snapshot-card__thumb-skeleton"></div>';
    const isEditing = state.editingLabelId === c.id;
    const labelContent = isEditing
      ? '<input class="snapshot-card__label-input" type="text" value="' + escapeAttr(c.label) + '">'
      : '<span class="snapshot-card__label-text">' + escapeText(c.label) + '</span>' +
        badge +
        '<svg class="snapshot-card__pencil" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M11.5 2L14 4.5 5 13.5 1.5 14.5 2.5 11z"/></svg>';
    return '' +
      '<div class="snapshot-card" data-capture-id="' + escapeAttr(c.id) + '">' +
        '<div class="snapshot-card__drag">' + HAMBURGER_SVG + '</div>' +
        '<div class="snapshot-card__thumb">' + thumbContent + '</div>' +
        '<div class="snapshot-card__info">' +
          '<div class="snapshot-card__label">' + labelContent + '</div>' +
        '</div>' +
        '<button class="snapshot-card__delete" title="Delete">×</button>' +
      '</div>';
  }

  function bindCardHandlers() {
    const list = document.getElementById('gallery-list');
    if (!list) return;
    state.captures.forEach((c) => {
      const card = list.querySelector('[data-capture-id="' + cssAttrEscape(c.id) + '"]');
      if (!card) return;
      const thumb = card.querySelector('.snapshot-card__thumb');
      if (thumb) thumb.addEventListener('click', (e) => {
        e.stopPropagation();
        openPreviewModal(c);
      });
      const pencil = card.querySelector('.snapshot-card__pencil');
      if (pencil) pencil.addEventListener('click', (e) => { e.stopPropagation(); startLabelEdit(c.id); });
      const del = card.querySelector('.snapshot-card__delete');
      if (del) del.addEventListener('click', (e) => { e.stopPropagation(); deleteCapture(c.id); });
      const input = card.querySelector('.snapshot-card__label-input');
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitLabel(c.id, input.value); }
          if (e.key === 'Escape') { e.preventDefault(); cancelLabel(); }
        });
        input.addEventListener('blur', () => commitLabel(c.id, input.value));
      }
    });
  }

  function updateCaptureCount() {
    const countEl = document.getElementById('gallery-count');
    if (countEl) countEl.textContent = state.captures.length;
    const doneBtn = document.getElementById('done-btn');
    if (doneBtn) doneBtn.textContent = doneBtnLabel();
  }

  function doneBtnLabel() {
    const n = state.captures.length;
    return 'Done — Use ' + n + ' state' + (n === 1 ? '' : 's');
  }

  // Auto-detect summary for Snapshot UI topbar subtitle.
  // Records what auto-detect found at run time; doesn't update as the
  // designer adds manual captures (those show up in the gallery count).
  function snapshotSubtitle() {
    if (!state.parseResult) return 'Capture states manually';
    const ad = state.parseResult.autoDetect;
    const auto = 1 + (ad.additionalCaptures ? ad.additionalCaptures.length : 0);
    const word = auto === 1 ? 'state' : 'states';
    if (ad.method) {
      return auto + ' ' + word + ' captured · via ' + ad.method;
    }
    return auto + ' ' + word + ' captured (no markers found)';
  }

  // ============================================================
  // Screen 2 — Patterns detected (Phase 6) + selection/grouping (Phase 7)
  // ============================================================

  function renderScreen2() {
    const detectResult = state.detectResult || { patterns: [], unique: [] };
    const allPatterns = detectResult.patterns || [];
    const unique = detectResult.unique || [];
    const groupedKeys = new Set(state.groups.flatMap((g) => g.patternKeys));
    const standalonePatterns = allPatterns.filter((p) => !groupedKeys.has(p.key));
    const n = state.captures.length;

    setTopbar(
      state.inputName || 'Pasted HTML',
      state.selectionMode
        ? 'Selecting patterns to group'
        : n + ' artboard' + (n === 1 ? '' : 's') + ' · ready to build'
    );

    const statsHtml =
      '<div class="stat-grid stat-grid--two">' +
        '<div class="stat"><span class="stat__num">' + allPatterns.length + '</span><span class="stat__label">Patterns</span></div>' +
        '<div class="stat"><span class="stat__num">' + unique.length + '</span><span class="stat__label">Unique elements</span></div>' +
      '</div>';

    const hintHtml = state.selectionMode ? buildScreen2Hint() : '';
    const actionBarHtml = buildScreen2ActionBar();
    const itemsHtml = buildScreen2Items(state.groups, standalonePatterns);
    // Unique section hidden in selection mode (unique elements aren't selectable)
    const uniqueHtml = (!state.selectionMode && unique.length > 0) ? buildScreen2UniqueSection(unique) : '';

    els.body.innerHTML = statsHtml + hintHtml + actionBarHtml + itemsHtml + uniqueHtml;

    els.banner.innerHTML = '';
    els.footer.className = 'panel__footer panel__footer--split';
    els.footer.innerHTML = state.selectionMode ? buildScreen2SelectionFooter() : buildScreen2NormalFooter();

    bindScreen2Handlers();
  }

  function buildScreen2Hint() {
    const text = state.groups.length === 0
      ? 'Tap 2 or more patterns to group as variants.'
      : 'Tap 2+ patterns to create a group, or tap a group to add patterns to it.';
    return '<div class="hint-bar">' +
      '<span class="hint-bar__icon">' + INFO_ICON_SM_SVG + '</span>' +
      '<span>' + text + '</span>' +
    '</div>';
  }

  function buildScreen2ActionBar() {
    if (state.selectionMode) {
      return '<div class="action-bar">' +
        '<span class="section-label" style="margin:0;">Patterns</span>' +
        '<button class="btn btn--secondary" id="selection-done-btn" style="padding:5px 10px;font-size:11px;">Done</button>' +
      '</div>';
    }
    return '<div class="action-bar">' +
      '<span class="section-label" style="margin:0;">Patterns</span>' +
      '<button class="btn btn--secondary" id="select-to-group-btn" style="padding:5px 10px;font-size:11px;">Group selection</button>' +
    '</div>';
  }

  function buildScreen2Items(groups, standalonePatterns) {
    // Phase 8 refinement: groups pin to TOP of list (above all ungrouped
    // patterns), each section sorted by count desc within itself. Groups
    // are the designer's deliberate work — they should be prominent.
    // (Overrides Phase 7 Q1 unified-by-count ordering. See v0.2-decisions.md.)
    const sortedGroups = groups.slice().sort((a, b) => b.totalCount - a.totalCount);
    const items = []
      .concat(sortedGroups.map((g) => ({ kind: 'group', data: g })))
      .concat(standalonePatterns.map((p) => ({ kind: 'pattern', data: p })));
    return '<div class="pattern-list" id="pattern-list">' +
      items.map((it) => it.kind === 'group' ? groupHtml(it.data) : patternRowHtml(it.data, { checkable: state.selectionMode })).join('') +
    '</div>';
  }

  function buildScreen2UniqueSection(unique) {
    return '<div class="category">' +
      '<span>Unique elements (1 occurrence)</span>' +
      '<span class="category__count">' + unique.length + '</span>' +
    '</div>' +
    '<div class="pattern-list" id="unique-list">' +
      patternRowHtml(unique[0], { unique: true }) +
      (unique.length > 1 ? uniqueSummaryRowHtml(unique.length - 1) : '') +
    '</div>';
  }

  function buildScreen2NormalFooter() {
    const n = state.captures.length;
    return '<button class="btn btn--secondary" id="screen2-back-btn">' + BACK_ARROW_SVG + 'Back</button>' +
      '<button class="btn btn--primary" id="screen2-build-btn">Build ' + n + ' artboard' + (n === 1 ? '' : 's') + '</button>';
  }

  function buildScreen2SelectionFooter() {
    const sel = state.selectedPatterns.size;
    const group = state.selectedGroupId ? state.groups.find((g) => g.id === state.selectedGroupId) : null;
    let label, enabled, tip;
    if (group) {
      label = 'Add (' + sel + ') to ' + group.name;
      enabled = sel >= 1;
      tip = enabled ? '' : 'Select patterns to add to this group';
    } else {
      label = 'Merge selected (' + sel + ')';
      enabled = sel >= 2;
      tip = enabled ? '' : 'Select 2 or more patterns to group';
    }
    return '<span class="footer-counter">' + sel + ' selected</span>' +
      '<button class="btn btn--primary" id="merge-btn"' + (enabled ? '' : ' disabled') + (tip ? ' title="' + escapeAttr(tip) + '"' : '') + '>' + escapeText(label) + '</button>';
  }

  function patternRowHtml(pattern, opts) {
    opts = opts || {};
    const isCheckable = !!opts.checkable;
    const isUnique = !!opts.unique;
    const isVariant = !!opts.variant;
    const isChecked = isCheckable && state.selectedPatterns.has(pattern.key);

    const classes = ['pattern-row'];
    if (isChecked) classes.push('pattern-row--selected');
    if (isVariant && state.selectionMode) classes.push('pattern-row--variant-locked');

    const dragHtml = state.selectionMode && !isVariant
      ? '<div class="pattern-row__drag">' + HAMBURGER_SVG + '</div>'
      : '';
    // Three checkbox states: indeterminate for variants (locked), checked
    // for selected standalones, unchecked for unselected standalones.
    let checkHtml = '';
    if (isVariant && state.selectionMode) {
      checkHtml = '<div class="pattern-row__check pattern-row__check--indeterminate">✓</div>';
    } else if (isCheckable && !isVariant) {
      checkHtml = '<div class="pattern-row__check' + (isChecked ? ' pattern-row__check--checked' : '') + '">✓</div>';
    }
    const countClasses = isUnique ? 'pattern-row__count pattern-row__count--single' : 'pattern-row__count';
    const chevron = state.selectionMode ? '' : '<span class="pattern-row__chevron">›</span>';
    const meta = isVariant && opts.variantValue !== undefined
      ? 'Variant=' + opts.variantValue
      : deriveMeta(pattern);

    return '' +
      '<div class="' + classes.join(' ') + '" data-pattern-key="' + escapeAttr(pattern.key) + '">' +
        dragHtml + checkHtml +
        '<div class="pattern-row__swatch">' + escapeText(deriveSwatch(pattern)) + '</div>' +
        '<div class="pattern-row__main">' +
          '<div class="pattern-row__name">' + escapeText(pattern.name) + '</div>' +
          '<div class="pattern-row__meta">' + escapeText(meta) + '</div>' +
        '</div>' +
        '<div class="' + countClasses + '">' + pattern.count + '</div>' +
        chevron +
      '</div>';
  }

  function groupHtml(group) {
    const isSelected = state.selectedGroupId === group.id;
    const isEditing = state.editingGroupId === group.id;
    const classes = ['pattern-group'];
    if (isSelected) classes.push('pattern-group--selected');
    if (state.selectionMode) classes.push('pattern-group--selection');

    const nameContent = isEditing
      ? '<input class="pattern-group__name-input" type="text" value="' + escapeAttr(group.name) + '">'
      : '<span class="pattern-group__name-text">' + escapeText(group.name) + '</span>' +
        '<span class="pattern-group__edit">' + PENCIL_SVG + '</span>';

    const patternsByKey = new Map((state.detectResult.patterns || []).map((p) => [p.key, p]));
    const variantRowsHtml = group.variants.map((v) => {
      const pattern = patternsByKey.get(v.key);
      if (!pattern) return '';
      return patternRowHtml(pattern, { variant: true, variantValue: v.value });
    }).join('');

    const vc = group.variants.length;
    const ic = group.totalCount;
    return '' +
      '<div class="' + classes.join(' ') + '" data-group-id="' + escapeAttr(group.id) + '">' +
        '<div class="pattern-group__header">' +
          '<span class="pattern-group__name">' + nameContent + '</span>' +
          '<span class="pattern-group__count">' + vc + ' variant' + (vc === 1 ? '' : 's') + ' · ' + ic + ' instance' + (ic === 1 ? '' : 's') + '</span>' +
          '<button class="pattern-group__unlink" data-action="unlink" aria-label="Ungroup">' + UNLINK_SVG + '</button>' +
        '</div>' +
        '<div class="pattern-group__body">' + variantRowsHtml + '</div>' +
      '</div>';
  }

  function uniqueSummaryRowHtml(count) {
    return '' +
      '<div class="pattern-row" style="cursor:default;">' +
        '<div class="pattern-row__swatch">·</div>' +
        '<div class="pattern-row__main">' +
          '<div class="pattern-row__name">' + count + ' others…</div>' +
          '<div class="pattern-row__meta">expand to view</div>' +
        '</div>' +
        '<span class="pattern-row__chevron">›</span>' +
      '</div>';
  }

  function bindScreen2Handlers() {
    const selectBtn = document.getElementById('select-to-group-btn');
    if (selectBtn) selectBtn.addEventListener('click', onSelectToGroup);
    const doneBtn = document.getElementById('selection-done-btn');
    if (doneBtn) doneBtn.addEventListener('click', onSelectionDone);
    const backBtn = document.getElementById('screen2-back-btn');
    if (backBtn) backBtn.addEventListener('click', onScreen2Back);
    const buildBtn = document.getElementById('screen2-build-btn');
    if (buildBtn) buildBtn.addEventListener('click', onScreen2Build);
    const mergeBtn = document.getElementById('merge-btn');
    if (mergeBtn && !mergeBtn.disabled) mergeBtn.addEventListener('click', onMerge);

    bindScreen2PatternRowHandlers();
    bindScreen2GroupHandlers();
    bindScreen2UniqueRowHandlers();
  }

  function bindScreen2PatternRowHandlers() {
    const root = document.getElementById('pattern-list');
    if (!root) return;
    // Standalone rows = direct children of pattern-list
    const standaloneRows = root.querySelectorAll(':scope > .pattern-row[data-pattern-key]');
    standaloneRows.forEach((row) => {
      const key = row.getAttribute('data-pattern-key');
      const pattern = (state.detectResult.patterns || []).find((p) => p.key === key);
      if (!pattern) return;
      if (state.selectionMode) {
        row.addEventListener('click', () => togglePatternSelection(pattern.key));
      } else {
        row.addEventListener('click', () => onPatternRowClick(pattern));
      }
    });
    // Variant rows (inside .pattern-group__body)
    const variantRows = root.querySelectorAll('.pattern-group__body .pattern-row[data-pattern-key]');
    variantRows.forEach((row) => {
      const key = row.getAttribute('data-pattern-key');
      const pattern = (state.detectResult.patterns || []).find((p) => p.key === key);
      if (!pattern) return;
      if (state.selectionMode) {
        // Variant is non-individually-selectable. Don't stop propagation —
        // let the click bubble to .pattern-group, which toggles group selection
        // (refinement #6: whole-group selectable).
      } else {
        // Normal mode: navigate to Pattern Detail. stopPropagation keeps
        // intent clear (group container click is a no-op anyway in normal mode).
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          onPatternRowClick(pattern);
        });
      }
    });
  }

  function bindScreen2GroupHandlers() {
    document.querySelectorAll('.pattern-group').forEach((groupEl) => {
      const groupId = groupEl.getAttribute('data-group-id');
      const group = state.groups.find((g) => g.id === groupId);
      if (!group) return;
      // Phase 7 refinement #6: click target is the whole group container,
      // not just the header. Inner affordances (pencil, unlink, name input,
      // variant rows in normal mode) stopPropagation to avoid double-firing.
      // In normal view (no selection mode), clicking the group container is
      // a no-op — there's no group detail screen. Only pencil/unlink remain
      // active. In selection mode, clicking anywhere on the group toggles
      // its --selected state.
      if (state.selectionMode) {
        groupEl.addEventListener('click', (e) => {
          if (e.target.closest('.pattern-group__edit, .pattern-group__name-input, .pattern-group__unlink')) return;
          toggleGroupSelection(group.id);
        });
      }
      const pencil = groupEl.querySelector('.pattern-group__edit');
      if (pencil) pencil.addEventListener('click', (e) => { e.stopPropagation(); startGroupNameEdit(group.id); });
      const unlinkBtn = groupEl.querySelector('.pattern-group__unlink');
      if (unlinkBtn) unlinkBtn.addEventListener('click', (e) => { e.stopPropagation(); onUnlinkGroup(group.id); });
      const nameInput = groupEl.querySelector('.pattern-group__name-input');
      if (nameInput) {
        nameInput.focus();
        nameInput.select();
        nameInput.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); commitGroupNameEdit(group.id, nameInput.value); }
          if (e.key === 'Escape') { e.preventDefault(); cancelGroupNameEdit(); }
        });
        nameInput.addEventListener('blur', () => commitGroupNameEdit(group.id, nameInput.value));
      }
    });
  }

  function bindScreen2UniqueRowHandlers() {
    if (state.selectionMode) return;
    const uniqueRoot = document.getElementById('unique-list');
    if (!uniqueRoot) return;
    uniqueRoot.querySelectorAll('.pattern-row[data-pattern-key]').forEach((row) => {
      const key = row.getAttribute('data-pattern-key');
      const pattern = (state.detectResult.unique || []).find((p) => p.key === key);
      if (pattern) row.addEventListener('click', () => onPatternRowClick(pattern));
    });
  }

  function deriveSwatch(pattern) {
    if (!pattern.classes || !pattern.classes.length) return '?';
    return pattern.classes[0].slice(0, 3).toLowerCase();
  }

  function deriveMeta(pattern) {
    return pattern.tag + '.' + pattern.classes.join('.');
  }

  // Longest common prefix of pattern.classes[last] across selected patterns,
  // trailing separators stripped, capitalized. Fallback: first pattern's name.
  function deriveGroupNameAndPrefix(patterns) {
    if (patterns.length === 0) return { name: 'Group', variantPrefix: '' };
    const lastClasses = patterns.map((p) => p.classes[p.classes.length - 1]);
    let prefix = lastClasses[0];
    for (let i = 1; i < lastClasses.length; i++) {
      let j = 0;
      while (j < prefix.length && j < lastClasses[i].length && prefix[j] === lastClasses[i][j]) j++;
      prefix = prefix.slice(0, j);
    }
    const cleanPrefix = prefix.replace(/[-_]+$/, '');
    if (cleanPrefix) {
      return {
        name: cleanPrefix.charAt(0).toUpperCase() + cleanPrefix.slice(1).toLowerCase(),
        variantPrefix: cleanPrefix + '-',
      };
    }
    return {
      name: patterns[0].name.charAt(0).toUpperCase() + patterns[0].name.slice(1),
      variantPrefix: '',
    };
  }

  function deriveVariantValue(pattern, variantPrefix) {
    if (!variantPrefix) return pattern.name;
    const lastClass = pattern.classes[pattern.classes.length - 1];
    if (lastClass.indexOf(variantPrefix) === 0) return lastClass.slice(variantPrefix.length);
    return pattern.name;
  }

  // ---------- Phase 7 handlers ----------

  function onSelectToGroup() {
    state.selectionMode = true;
    state.selectedPatterns.clear();
    state.selectedGroupId = null;
    state.editingGroupId = null;
    render();
  }

  function onSelectionDone() {
    state.selectionMode = false;
    state.selectedPatterns.clear();
    state.selectedGroupId = null;
    state.editingGroupId = null;
    render();
  }

  function togglePatternSelection(key) {
    if (state.selectedPatterns.has(key)) state.selectedPatterns.delete(key);
    else state.selectedPatterns.add(key);
    render();
  }

  function toggleGroupSelection(groupId) {
    state.selectedGroupId = state.selectedGroupId === groupId ? null : groupId;
    render();
  }

  function onMerge() {
    const keys = [];
    state.selectedPatterns.forEach((k) => keys.push(k));
    const patternsByKey = new Map((state.detectResult.patterns || []).map((p) => [p.key, p]));
    const patterns = keys.map((k) => patternsByKey.get(k)).filter(Boolean);

    if (state.selectedGroupId !== null) {
      // Add patterns to existing group
      if (patterns.length < 1) return;
      const group = state.groups.find((g) => g.id === state.selectedGroupId);
      if (!group) return;
      patterns.forEach((p) => {
        group.patternKeys.push(p.key);
        group.variants.push({ key: p.key, value: deriveVariantValue(p, group.variantPrefix) });
      });
      group.totalCount += patterns.reduce((s, p) => s + p.count, 0);
    } else {
      // Create new group
      if (patterns.length < 2) return;
      const meta = deriveGroupNameAndPrefix(patterns);
      state.groups.push({
        id: genId(),
        name: meta.name,
        variantPrefix: meta.variantPrefix,
        patternKeys: patterns.map((p) => p.key),
        variants: patterns.map((p) => ({ key: p.key, value: deriveVariantValue(p, meta.variantPrefix) })),
        totalCount: patterns.reduce((s, p) => s + p.count, 0),
      });
    }

    state.selectedPatterns.clear();
    state.selectedGroupId = null;
    render();
  }

  function onUnlinkGroup(groupId) {
    state.groups = state.groups.filter((g) => g.id !== groupId);
    if (state.selectedGroupId === groupId) state.selectedGroupId = null;
    if (state.editingGroupId === groupId) state.editingGroupId = null;
    render();
  }

  function startGroupNameEdit(groupId) {
    state.editingGroupId = groupId;
    render();
  }

  function commitGroupNameEdit(groupId, value) {
    if (state.editingGroupId !== groupId) return;
    const trimmed = value.trim();
    const group = state.groups.find((g) => g.id === groupId);
    if (group && trimmed) group.name = trimmed;
    state.editingGroupId = null;
    render();
  }

  function cancelGroupNameEdit() {
    state.editingGroupId = null;
    render();
  }

  async function onScreen2Back() {
    state.snapshotUiBuilt = false;
    state.selectionMode = false;
    state.selectedPatterns.clear();
    state.selectedGroupId = null;
    state.editingGroupId = null;
    await navigateTo('snapshot', 1000, 800);
  }

  function onScreen2Build() {
    console.log('[ui] build-request:', {
      captures: state.captures,
      patterns: state.detectResult ? state.detectResult.patterns : [],
      unique: state.detectResult ? state.detectResult.unique : [],
      groups: state.groups,
    });
  }

  async function onPatternRowClick(pattern) {
    state.activePattern = pattern;
    state.activeInstanceIdx = null;
    state.instanceListExpanded = false;
    state.instanceShowCode = false;
    state.patternDetailZoom = 0.5;
    await navigateTo('pattern-detail', 800, 800);
  }

  // ============================================================
  // Screen 3 — Pattern Detail (Phase 8) — 800px wide
  // ============================================================

  function renderPatternDetail() {
    const p = state.activePattern;
    if (!p) {
      state.screen = 'screen2';
      render();
      return;
    }

    // Distinct capture labels for the topbar count
    const appearsIn = [];
    const seen = new Set();
    (p.instances || []).forEach((inst) => {
      if (!seen.has(inst.captureLabel)) {
        seen.add(inst.captureLabel);
        appearsIn.push(inst.captureLabel);
      }
    });
    const cc = appearsIn.length;

    // Topbar follows mockup convention. See v0.2-decisions.md §Topbar title conventions.
    setTopbar(
      'Pattern: ' + p.name,
      p.count + ' instance' + (p.count === 1 ? '' : 's') + ' across ' + cc + ' artboard' + (cc === 1 ? '' : 's')
    );

    const containing = state.groups.find((g) => g.patternKeys.indexOf(p.key) !== -1);
    const variantContextHtml = containing
      ? '<div class="variant-context">Part of group: <strong>' + escapeText(containing.name) + '</strong></div>'
      : '';

    const detailCardHtml =
      '<div class="detail-card">' +
        '<div class="detail-card__head">' +
          '<div class="detail-card__swatch">' + escapeText(deriveSwatch(p)) + '</div>' +
          '<div>' +
            '<h3 class="detail-card__name">' + escapeText(p.name) + '</h3>' +
            '<div class="detail-card__meta">' + escapeText(deriveMeta(p)) + ' · ' + p.count + ' instance' + (p.count === 1 ? '' : 's') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-card__hint">' +
          '<strong>How this works:</strong> After build, find this component on the ' +
          '<strong>Components (generated)</strong> page. Open its master and design it ' +
          '(or replace contents with your DS instance). All ' + p.count + ' instance' + (p.count === 1 ? '' : 's') + ' update automatically.' +
        '</div>' +
      '</div>';

    // Instance list — first 5 visible (or all if expanded), then "+N more…"
    const instances = p.instances || [];
    const visibleCount = state.instanceListExpanded ? instances.length : Math.min(5, instances.length);
    const hiddenCount = instances.length - visibleCount;

    let rowsHtml = '';
    for (let i = 0; i < visibleCount; i++) {
      rowsHtml += instanceRowHtml(instances[i], i);
    }
    if (hiddenCount > 0) {
      rowsHtml +=
        '<div class="instance-row instance-row--more" data-action="expand-list">' +
          '<div class="instance-row__summary">' +
            '<span class="instance-row__loc">+' + hiddenCount + ' more…</span>' +
          '</div>' +
        '</div>';
    }

    els.body.innerHTML =
      variantContextHtml +
      detailCardHtml +
      '<p class="section-label" style="margin-top:16px;">Instances</p>' +
      '<div class="instance-list">' + rowsHtml + '</div>';

    els.banner.innerHTML = '';
    els.footer.className = 'panel__footer panel__footer--start';
    els.footer.innerHTML =
      '<button class="btn btn--secondary" id="detail-back-btn">' + BACK_ARROW_SVG + 'Back</button>';

    bindPatternDetailHandlers();
  }

  function instanceRowHtml(instance, idx) {
    const isOpen = state.activeInstanceIdx === idx;
    const previewText = instance.textSnippet ? '"' + instance.textSnippet + '"' : '';
    const detailHtml = isOpen ? buildInstanceDetailHtml(instance) : '';
    return '<div class="instance-row' + (isOpen ? ' instance-row--open' : '') + '" data-instance-idx="' + idx + '">' +
      '<div class="instance-row__summary"' + (isOpen ? ' style="background: var(--bg-elevated);"' : '') + '>' +
        '<span class="instance-row__loc">' + escapeText(instance.captureLabel) + '</span>' +
        '<span class="instance-row__preview">' + escapeText(previewText) + '</span>' +
        '<span class="instance-row__view-icon' + (isOpen ? ' instance-row__view-icon--open' : '') + '">›</span>' +
      '</div>' +
      detailHtml +
    '</div>';
  }

  function buildInstanceDetailHtml(instance) {
    const zoomPct = Math.round(state.patternDetailZoom * 100);
    const showCode = !!state.instanceShowCode;
    const codeText = truncate(instance.outerHTML || '', 1000);
    return '<div class="instance-row__detail">' +
      '<p class="instance-detail-label">Preview · full page with element highlighted</p>' +
      '<div class="iframe-mock" id="instance-iframe-mock">' +
        '<div class="iframe-mock__viewport">' +
          '<div class="iframe-mock__viewport-inner">' +
            '<iframe class="iframe-mock__page" id="instance-iframe" sandbox="allow-same-origin"></iframe>' +
          '</div>' +
        '</div>' +
        '<div class="iframe-mock__toolbar">' +
          '<button class="iframe-mock__toolbar-btn" id="instance-zoom-out" type="button">−</button>' +
          '<span class="iframe-mock__toolbar-zoom" id="instance-zoom-indicator">' + zoomPct + '%</span>' +
          '<button class="iframe-mock__toolbar-btn" id="instance-zoom-in" type="button">+</button>' +
        '</div>' +
      '</div>' +
      '<p class="instance-detail-label">Location</p>' +
      '<div class="instance-detail-meta">' +
        '<span><strong>Artboard:</strong> ' + escapeText(instance.captureLabel) + '</span>' +
      '</div>' +
      '<div class="instance-detail-meta" style="margin-top:4px;">' +
        '<span><strong>Selector:</strong> <code class="instance-detail-meta__code">' + escapeText(instance.selector || '') + '</code></span>' +
      '</div>' +
      '<div class="show-code" data-action="toggle-code">' +
        '<span class="show-code__label">' +
          '<span class="show-code__chevron' + (showCode ? ' show-code__chevron--open' : '') + '">›</span>' +
          ' Show code' +
        '</span>' +
      '</div>' +
      (showCode ? '<pre class="sample-html">' + escapeText(codeText) + '</pre>' : '') +
    '</div>';
  }

  function bindPatternDetailHandlers() {
    document.getElementById('detail-back-btn').addEventListener('click', onDetailBack);

    document.querySelectorAll('.instance-row[data-instance-idx]').forEach((row) => {
      const idx = parseInt(row.getAttribute('data-instance-idx'), 10);
      const summary = row.querySelector('.instance-row__summary');
      if (summary) summary.addEventListener('click', (e) => { e.stopPropagation(); toggleInstanceRow(idx); });
    });

    const moreRow = document.querySelector('.instance-row--more[data-action="expand-list"]');
    if (moreRow) moreRow.addEventListener('click', () => {
      state.instanceListExpanded = true;
      render();
    });

    const showCodeEl = document.querySelector('.show-code[data-action="toggle-code"]');
    if (showCodeEl) showCodeEl.addEventListener('click', () => {
      state.instanceShowCode = !state.instanceShowCode;
      render();
    });

    const zoomOut = document.getElementById('instance-zoom-out');
    if (zoomOut) zoomOut.addEventListener('click', onPatternDetailZoomOut);
    const zoomIn = document.getElementById('instance-zoom-in');
    if (zoomIn) zoomIn.addEventListener('click', onPatternDetailZoomIn);

    // Wire iframe srcdoc if a row is open
    if (state.activeInstanceIdx !== null) setupInstanceIframe();
  }

  function setupInstanceIframe() {
    const p = state.activePattern;
    if (!p) return;
    const instance = (p.instances || [])[state.activeInstanceIdx];
    if (!instance) return;
    const capture = state.captures.find((c) => c.id === instance.captureId);
    if (!capture) return;
    const iframe = document.getElementById('instance-iframe');
    if (!iframe) return;
    iframe.srcdoc = buildHighlightedSrcdoc(capture.html, instance.selector);
    applyInstanceIframeZoom();
  }

  // Pre-mark the target element via DOMParser BEFORE serializing, then strip
  // scripts. Iframe sandbox is allow-same-origin only (no allow-scripts),
  // so we can't run a querySelector script inside the iframe — we bake the
  // marker attribute into the HTML instead and let CSS handle the highlight.
  function buildHighlightedSrcdoc(captureHtml, selector) {
    let serialized;
    try {
      const doc = new DOMParser().parseFromString(captureHtml, 'text/html');
      // IMPORTANT: query BEFORE stripping scripts — script removal changes
      // nth-child indices the stored selector depends on.
      if (selector) {
        try {
          const el = doc.querySelector(selector);
          if (el) el.setAttribute('data-fm-highlight', '');
        } catch (err) {
          console.warn('[ui] highlight selector failed:', selector, err);
        }
      }
      doc.querySelectorAll('script').forEach((s) => s.remove());

      const styleEl = doc.createElement('style');
      // Force highlight + badge above all captured page content. The
      // position:relative + max-int z-index creates a stacking context
      // the captured page can't compete with.
      styleEl.textContent =
        '[data-fm-highlight]{' +
          'position:relative !important;' +
          'z-index:2147483646 !important;' +
          'outline:2px dashed #EF4444 !important;' +
          'outline-offset:3px !important;' +
        '}' +
        '[data-fm-highlight]::after{' +
          'content:"selected instance";' +
          'position:absolute;top:-22px;left:0;' +
          'background:#EF4444;color:#fff;' +
          'font:600 9px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;' +
          'padding:2px 6px;border-radius:3px;' +
          'white-space:nowrap;text-transform:uppercase;letter-spacing:0.04em;' +
          'z-index:2147483647 !important;' +
        '}';
      doc.head.appendChild(styleEl);
      serialized = '<!doctype html>\n' + doc.documentElement.outerHTML;
    } catch (err) {
      console.warn('[ui] buildHighlightedSrcdoc failed, falling back to raw html:', err);
      serialized = captureHtml;
    }
    return serialized;
  }

  function toggleInstanceRow(idx) {
    if (state.activeInstanceIdx === idx) {
      state.activeInstanceIdx = null;
      state.instanceShowCode = false;
    } else {
      state.activeInstanceIdx = idx;
      state.instanceShowCode = false;
    }
    render();
  }

  function onPatternDetailZoomIn() {
    const cur = ZOOM_LEVELS.indexOf(state.patternDetailZoom);
    if (cur >= 0 && cur < ZOOM_LEVELS.length - 1) {
      state.patternDetailZoom = ZOOM_LEVELS[cur + 1];
      applyInstanceIframeZoom();
    }
  }
  function onPatternDetailZoomOut() {
    const cur = ZOOM_LEVELS.indexOf(state.patternDetailZoom);
    if (cur > 0) {
      state.patternDetailZoom = ZOOM_LEVELS[cur - 1];
      applyInstanceIframeZoom();
    }
  }
  function applyInstanceIframeZoom() {
    const mock = document.getElementById('instance-iframe-mock');
    if (mock) mock.style.setProperty('--zoom', String(state.patternDetailZoom));
    const indicator = document.getElementById('instance-zoom-indicator');
    if (indicator) indicator.textContent = Math.round(state.patternDetailZoom * 100) + '%';
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  async function onDetailBack() {
    state.activePattern = null;
    state.activeInstanceIdx = null;
    state.instanceListExpanded = false;
    state.instanceShowCode = false;
    await navigateTo('screen2', 380, 800);
  }

  // ============================================================
  // Snapshot UI handlers
  // ============================================================

  function onReload() {
    const iframe = document.getElementById('preview-iframe');
    if (iframe) iframe.srcdoc = state.inputHtml;
  }

  function onZoomIn() {
    const cur = ZOOM_LEVELS.indexOf(state.snapshotZoom);
    if (cur < ZOOM_LEVELS.length - 1) {
      state.snapshotZoom = ZOOM_LEVELS[cur + 1];
      applyZoom();
    }
  }
  function onZoomOut() {
    const cur = ZOOM_LEVELS.indexOf(state.snapshotZoom);
    if (cur > 0) {
      state.snapshotZoom = ZOOM_LEVELS[cur - 1];
      applyZoom();
    }
  }
  function applyZoom() {
    document.getElementById('preview-area').style.setProperty('--zoom', String(state.snapshotZoom));
    document.getElementById('zoom-indicator').textContent = Math.round(state.snapshotZoom * 100) + '%';
  }

  function onCaptureClick() {
    const iframe = document.getElementById('preview-iframe');
    const label = 'State ' + (state.captures.length + 1);
    const cap = window.figmaMigrateParser.captureFromIframe(iframe, label, 'manual');
    const dup = state.captures.find((c) => c.html === cap.html);
    if (dup) {
      showToast('Same state already captured — ' + dup.label);
      return;
    }
    state.captures.push(cap);
    renderGallery();
    updateCaptureCount();
    generateThumbnail(cap.id);
  }

  function startLabelEdit(captureId) {
    state.editingLabelId = captureId;
    renderGallery();
  }
  function commitLabel(captureId, value) {
    if (state.editingLabelId !== captureId) return;
    const cap = state.captures.find((c) => c.id === captureId);
    if (cap) {
      const trimmed = value.trim();
      if (trimmed) cap.label = trimmed;
    }
    state.editingLabelId = null;
    renderGallery();
  }
  function cancelLabel() {
    state.editingLabelId = null;
    renderGallery();
  }

  function deleteCapture(captureId) {
    state.captures = state.captures.filter((c) => c.id !== captureId);
    renderGallery();
    updateCaptureCount();
  }

  function onReorderEnd() {
    const list = document.getElementById('gallery-list');
    if (!list) return;
    const newOrder = Array.from(list.children).map((el) => el.getAttribute('data-capture-id'));
    state.captures = newOrder.map((id) => state.captures.find((c) => c.id === id)).filter(Boolean);
  }

  async function onSnapshotDone() {
    console.log('[ui] snapshot-done:', state.captures);
    state.detectResult = window.figmaMigrateParser.detectPatterns(state.captures);
    state.groups = [];           // Re-detect = regroup; designer's grouping doesn't survive input changes.
    state.selectionMode = false;
    state.selectedPatterns.clear();
    state.selectedGroupId = null;
    state.editingGroupId = null;
    state.snapshotUiBuilt = false;
    state.showSnapshotBanner = false;
    await navigateTo('screen2', 380, 800);
  }

  // ============================================================
  // Preview modal + toast (Phase 5 refinements)
  // ============================================================

  function openPreviewModal(capture) {
    const modal = document.getElementById('preview-modal');
    const wrap = document.getElementById('preview-modal-wrap');
    const frame = document.getElementById('preview-modal-frame');
    if (!modal || !wrap || !frame) return;
    // Strip <script> so the page doesn't re-init its state machine; we want
    // to show the captured DOM exactly as it was, not re-boot from scratch.
    frame.srcdoc = stripScripts(capture.html);
    // Scale 1280×800 to fit the plugin viewport, preserving aspect ratio.
    const availW = window.innerWidth - 96;
    const availH = window.innerHeight - 96;
    const scale = Math.min(availW / 1280, availH / 800, 1);
    frame.style.transform = 'scale(' + scale + ')';
    wrap.style.width = (1280 * scale) + 'px';
    wrap.style.height = (800 * scale) + 'px';
    modal.classList.add('is-open');
  }

  function closePreviewModal() {
    const modal = document.getElementById('preview-modal');
    const frame = document.getElementById('preview-modal-frame');
    if (!modal) return;
    modal.classList.remove('is-open');
    if (frame) frame.srcdoc = '';
  }

  function showToast(message) {
    const previewArea = document.getElementById('preview-area');
    if (!previewArea) return;
    const existing = previewArea.querySelector('.snapshot-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'snapshot-toast';
    toast.innerHTML =
      '<span class="snapshot-toast__icon">' + INFO_ICON_SM_SVG + '</span>' +
      '<span>' + escapeText(message) + '</span>';
    previewArea.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
  }

  // ============================================================
  // Thumbnail generation (async, html2canvas)
  // ============================================================

  // Strip <script> tags so the captured DOM doesn't re-init its
  // state machine when we srcdoc it for thumbnail render.
  function stripScripts(html) {
    return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }

  async function generateThumbnail(captureId) {
    const capture = state.captures.find((c) => c.id === captureId);
    if (!capture || capture.thumbnail) return;
    if (typeof window.html2canvas !== 'function') {
      console.warn('[ui] html2canvas not loaded — skipping thumbnail');
      return;
    }
    const tempIframe = document.createElement('iframe');
    tempIframe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1280px;height:800px;border:0;visibility:hidden;';
    tempIframe.sandbox = 'allow-same-origin';
    document.body.appendChild(tempIframe);
    try {
      await new Promise((resolve) => {
        tempIframe.addEventListener('load', resolve, { once: true });
        tempIframe.srcdoc = stripScripts(capture.html);
      });
      await new Promise((r) => setTimeout(r, 100));
      const canvas = await window.html2canvas(tempIframe.contentDocument.body, {
        width: 1280,
        height: 800,
        windowWidth: 1280,
        windowHeight: 800,
        scale: 0.1,
        logging: false,
        useCORS: false,
        backgroundColor: '#ffffff',
      });
      capture.thumbnail = canvas.toDataURL('image/png');
      updateCardThumbnail(captureId);
    } catch (err) {
      console.warn('[ui] thumbnail generation failed for', captureId, err);
    } finally {
      tempIframe.remove();
    }
  }

  function updateCardThumbnail(captureId) {
    const card = document.querySelector('[data-capture-id="' + cssAttrEscape(captureId) + '"]');
    if (!card) return;
    const capture = state.captures.find((c) => c.id === captureId);
    if (!capture || !capture.thumbnail) return;
    const thumbEl = card.querySelector('.snapshot-card__thumb');
    if (thumbEl) thumbEl.innerHTML = '<img src="' + capture.thumbnail + '" alt="">';
  }

  function generateAllThumbnails() {
    state.captures
      .filter((c) => !c.thumbnail)
      .forEach((c) => generateThumbnail(c.id));
  }

  // ============================================================
  // Screen 1 / 1a handlers
  // ============================================================

  function onTextareaInput(e) {
    state.inputHtml = e.target.value;
    state.inputName = e.target.value ? 'Pasted HTML' : '';
    document.getElementById('detect-btn').disabled = !state.inputHtml.trim();
  }

  function onDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('is-dragover'); }
  function onDragLeave(e) { e.currentTarget.classList.remove('is-dragover'); }

  async function onDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('is-dragover');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) await loadFile(file);
  }

  async function loadFile(file) {
    state.inputHtml = await file.text();
    state.inputName = file.name;
    render();
  }

  async function startDetection() {
    if (!state.inputHtml.trim()) return;
    state.screen = 'detecting';
    render();
    try {
      const result = await window.figmaMigrateParser.autoDetectAndCapture(state.inputHtml);
      state.parseResult = result;
      state.captures = [result.bootCapture].concat(result.autoDetect.additionalCaptures);
      state.captures.forEach((c) => { c.thumbnail = null; });
      // Re-detect = fresh grouping + clean selection state
      state.groups = [];
      state.selectionMode = false;
      state.selectedPatterns.clear();
      state.selectedGroupId = null;
      state.editingGroupId = null;
      // Phase 7 refinement: Screen 1a removed. Detect → directly to Snapshot UI.
      state.snapshotUiBuilt = false;
      await navigateTo('snapshot', 1000, 800);
    } catch (err) {
      console.error('[ui] autoDetectAndCapture threw:', err);
      state.screen = 'screen1';
      render();
      alert('Detection failed: ' + err.message);
    }
  }

  // ============================================================
  // helpers
  // ============================================================

  function escapeText(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  }
  function escapeAttr(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }
  function cssAttrEscape(s) {
    // For use inside an attribute selector's quoted value.
    return String(s).replace(/"/g, '\\"');
  }
  function requestResize(w, h) {
    parent.postMessage({ pluginMessage: { type: 'resize', width: w, height: h } }, '*');
  }
  // Resize-aware screen transition. requestResize is async (postMessage
  // roundtrip → plugin → figma.ui.resize), but state changes and render()
  // are synchronous. Without waiting, the new screen paints at the OLD
  // panel dimensions and then visibly reflows when the resize lands —
  // that's the "flash". Wait ~120ms for the resize to settle before
  // swapping screens.
  async function navigateTo(screen, w, h) {
    if (w && h) {
      requestResize(w, h);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    state.screen = screen;
    render();
  }
  // In-session unique id (groups, etc.). parser.js has its own genId in its IIFE
  // scope for capture ids; this one lives in ui.js scope.
  function genId() {
    return 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  // ============================================================
  // Phase 9a — Config-row dropdowns (Target page, Components page)
  // ============================================================

  const CHECK_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const PLUS_SMALL_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

  function configRowHtml(triggerId, which, label) {
    const selection = which === 'target' ? state.settings.targetPage : state.settings.componentsPage;
    const valueText = (selection && selection.name) || '';
    return '<div class="config-row" data-dropdown="' + triggerId + '" data-config="' + which + '">' +
      '<span class="config-row__label">' + escapeText(label) + '</span>' +
      '<span class="config-row__value">' +
        '<span class="dropdown-value">' + escapeText(valueText) + '</span>' +
        ' <span class="config-row__chevron">›</span>' +
      '</span>' +
      dropdownHtml(triggerId, which) +
    '</div>';
  }

  function dropdownHtml(dropdownId, which) {
    const items = buildDropdownItems(which);
    const selKey = selectedKeyFor(which);
    const itemRows = items.map((item) => {
      const key = item.kind === 'page' ? 'page:' + item.id : 'create:' + item.name;
      const isSel = key === selKey;
      const dataAttrs =
        ' data-item-kind="' + item.kind + '"' +
        (item.id ? ' data-item-id="' + escapeAttr(item.id) + '"' : '') +
        ' data-item-name="' + escapeAttr(item.name) + '"';
      return '<div class="dropdown__item' + (isSel ? ' dropdown__item--selected' : '') + '"' + dataAttrs + '>' +
        '<span class="dropdown__check">' + (isSel ? CHECK_SVG : '') + '</span>' +
        '<span class="dropdown__item-text">' + escapeText(item.name) + '</span>' +
      '</div>';
    }).join('');
    return '<div class="dropdown" id="' + dropdownId + '">' +
      itemRows +
      '<div class="dropdown__divider"></div>' +
      '<div class="dropdown__item dropdown__item--create" data-item-kind="create-action">' +
        '<span class="dropdown__check">' + PLUS_SMALL_SVG + '</span>' +
        '<span class="dropdown__item-text">Create new page…</span>' +
      '</div>' +
    '</div>';
  }

  function buildDropdownItems(which) {
    const pages = state.availablePages.map((p) => ({ kind: 'page', id: p.id, name: p.name }));
    // Show create-intents only if they don't shadow an existing page name.
    const pageNames = new Set(state.availablePages.map((p) => p.name));
    const intents = (state.createIntents[which] || [])
      .filter((name) => !pageNames.has(name))
      .map((name) => ({ kind: 'create', name: name }));
    return pages.concat(intents);
  }

  function selectedKeyFor(which) {
    const sel = which === 'target' ? state.settings.targetPage : state.settings.componentsPage;
    if (!sel) return null;
    if (sel.create) return 'create:' + sel.name;
    return 'page:' + sel.id;
  }

  function bindConfigRows() {
    document.querySelectorAll('.config-row[data-dropdown]').forEach((row) => {
      const triggerId = row.getAttribute('data-dropdown');
      const which = row.getAttribute('data-config');
      const dropdown = document.getElementById(triggerId);
      if (!dropdown) return;

      // Click on the row (outside the dropdown itself) toggles the dropdown.
      row.addEventListener('click', (e) => {
        if (e.target.closest('.dropdown')) return;
        e.stopPropagation();
        const wasOpen = dropdown.classList.contains('is-open');
        closeAllDropdowns();
        if (!wasOpen) dropdown.classList.add('is-open');
      });

      // Item clicks: real pages, create-intents, and the "Create new page…" action.
      dropdown.querySelectorAll('.dropdown__item').forEach((item) => {
        const kind = item.getAttribute('data-item-kind');
        if (kind === 'create-action') {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            startCreateInput(dropdown, item, which);
          });
        } else {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            const selection = (kind === 'page')
              ? { id: item.getAttribute('data-item-id'), name: item.getAttribute('data-item-name') }
              : { create: true, name: item.getAttribute('data-item-name') };
            applySelection(which, selection);
          });
        }
      });
    });
  }

  function closeAllDropdowns() {
    document.querySelectorAll('.dropdown.is-open').forEach((d) => {
      d.classList.remove('is-open');
      const form = d.querySelector('.dropdown__create-form');
      if (form && form.dataset.originalHtml) {
        form.outerHTML = form.dataset.originalHtml;
        // Re-bind the restored "Create new page…" item so it's clickable next open.
        const restored = d.querySelector('.dropdown__item--create');
        const which = d.id === 'dd-s1-target' ? 'target' : 'comp';
        if (restored) {
          restored.addEventListener('click', (e) => {
            e.stopPropagation();
            startCreateInput(d, restored, which);
          });
        }
      }
    });
  }

  function applySelection(which, selection) {
    if (which === 'target') state.settings.targetPage = selection;
    else state.settings.componentsPage = selection;
    if (selection.create) {
      const list = state.createIntents[which];
      if (list.indexOf(selection.name) === -1) list.push(selection.name);
    }
    postSettingsUpdate(which, selection);
    closeAllDropdowns();
    if (state.screen === 'screen1') render();
  }

  function postSettingsUpdate(which, selection) {
    const patch = which === 'target' ? { targetPage: selection } : { componentsPage: selection };
    parent.postMessage({ pluginMessage: { type: 'settings-update', patch: patch } }, '*');
  }

  function startCreateInput(dropdown, createItem, which) {
    const defaultName = which === 'target' ? 'figma-migrate output' : 'Components (generated)';
    const originalHtml = createItem.outerHTML;

    const form = document.createElement('div');
    form.className = 'dropdown__create-form';
    form.dataset.originalHtml = originalHtml;
    form.innerHTML =
      '<input type="text" class="dropdown__input" value="' + escapeAttr(defaultName) + '">' +
      '<button type="button" class="btn btn--primary">Create</button>';
    createItem.replaceWith(form);

    const input = form.querySelector('input');
    input.focus();
    input.select();

    const commit = () => {
      const name = (input.value || '').trim() || 'New page';
      applySelection(which, { create: true, name: name });
    };
    const cancel = () => {
      form.outerHTML = originalHtml;
      const restored = dropdown.querySelector('.dropdown__item--create');
      if (restored) {
        restored.addEventListener('click', (e) => {
          e.stopPropagation();
          startCreateInput(dropdown, restored, which);
        });
      }
    };

    // Clicks inside input/button shouldn't bubble to the row trigger (would close dropdown).
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    form.querySelector('.btn').addEventListener('click', (e) => {
      e.stopPropagation();
      commit();
    });
  }

  function handleInitSettings(msg) {
    state.availablePages = msg.pages || [];
    state.settings = Object.assign({}, state.settings, msg.settings || {});
    // Seed create-intents from any saved create-intent selections so they
    // show up as visible items in the dropdown.
    state.createIntents = { target: [], comp: [] };
    if (state.settings.targetPage && state.settings.targetPage.create) {
      state.createIntents.target.push(state.settings.targetPage.name);
    }
    if (state.settings.componentsPage && state.settings.componentsPage.create) {
      state.createIntents.comp.push(state.settings.componentsPage.name);
    }
    if (state.screen === 'screen1' || state.screen === 'detecting') render();
  }

  // ============================================================
  // inline SVG / HTML constants
  // ============================================================

  const PLACEHOLDER =
    "<!doctype html>\n<html>\n  <body>\n    <section data-page='dashboard'>\n      ...\n    </section>\n  </body>\n</html>";

  const SETTINGS_ICON_SVG =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">' +
    '<path d="M9.4 1.5h-2.8l-.4 2a5.5 5.5 0 0 0-1.5.85L2.8 3.6l-1.4 2.4 1.6 1.3a5.5 5.5 0 0 0 0 1.4l-1.6 1.3 1.4 2.4 1.9-.75a5.5 5.5 0 0 0 1.5.85l.4 2h2.8l.4-2a5.5 5.5 0 0 0 1.5-.85l1.9.75 1.4-2.4-1.6-1.3a5.5 5.5 0 0 0 0-1.4l1.6-1.3-1.4-2.4-1.9.75a5.5 5.5 0 0 0-1.5-.85l-.4-2z"/>' +
    '<circle cx="8" cy="8" r="2"/>' +
    '</svg>';

  const INFO_ICON_SM_SVG =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="11"/><line x1="12" y1="8" x2="12.01" y2="8"/>' +
    '</svg>';

  const BACK_ARROW_SVG =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px;vertical-align:-2px;">' +
    '<polyline points="15 18 9 12 15 6"/>' +
    '</svg>';

  const HAMBURGER_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 12H18M6 6H18M6 18H18"/>' +
    '</svg>';

  const PENCIL_SVG =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">' +
    '<path d="M11.5 2L14 4.5 5 13.5 1.5 14.5 2.5 11z"/>' +
    '</svg>';

  const UNLINK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M18.84 12.25L20.56 10.54H20.54C21.4606 9.58603 21.9651 8.30572 21.9426 6.98017C21.9201 5.65461 21.3725 4.39216 20.42 3.46999C19.4869 2.57019 18.2412 2.06738 16.945 2.06738C15.6488 2.06738 14.4031 2.57019 13.47 3.46999L11.75 5.17999M5.16994 11.75L3.45994 13.46C2.53931 14.414 2.03486 15.6943 2.05736 17.0198C2.07986 18.3454 2.62746 19.6078 3.57994 20.53C4.51299 21.4298 5.7587 21.9326 7.05494 21.9326C8.35118 21.9326 9.59689 21.4298 10.5299 20.53L12.2399 18.82M8 2V5M2 8H5M16 19V22M19 16H22"/>' +
    '</svg>';

  const PLUS_ICON_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>' +
    '</svg>';

  // ============================================================
  // boot
  // ============================================================

  els.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) await loadFile(file);
    e.target.value = '';
  });

  // Phase 9a — listen for init-settings from code.js (arrives shortly after boot)
  window.addEventListener('message', (e) => {
    const msg = e.data && e.data.pluginMessage;
    if (!msg) return;
    if (msg.type === 'init-settings') handleInitSettings(msg);
  });

  // Global click handler closes any open dropdown. Inner handlers
  // (trigger/item/input) stopPropagation so this only fires for true outside clicks.
  document.addEventListener('click', () => closeAllDropdowns());

  // Preview modal handlers (modal element lives in ui.template.html scaffold)
  document.getElementById('preview-modal-close').addEventListener('click', closePreviewModal);
  document.getElementById('preview-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closePreviewModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('preview-modal');
      if (modal && modal.classList.contains('is-open')) closePreviewModal();
    }
  });

  render();
})();
