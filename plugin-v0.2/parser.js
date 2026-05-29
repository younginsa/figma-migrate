// figma-migrate v0.2 — HTML parser, state capture, pattern detection
//
// Exposes window.figmaMigrateParser:
//   autoDetectAndCapture(html) → Promise<DetectionResult>
//   captureFromIframe(iframe, label, source) → Capture
//   detectPatterns(captures, settings?) → { patterns, unique }
//
// See v0.2-decisions.md for spec.

(function () {
  'use strict';

  // Priority order: first selector with ≥1 match wins. See decisions.md §State detection.
  const STATE_MARKER_PATTERNS = [
    '[data-dev]',
    '[data-state]',
    '[data-page]',
    '[data-view]',
  ];

  // Ported from v0.1 _reference/plugin/code.js:413-443. Strips Tailwind/
  // Bootstrap utility classes so pattern signatures aren't fragmented by
  // layout/spacing utilities. Semantic classes like .text-error are kept.
  const UTILITY_CLASS_PATTERNS = [
    /^m[trblxy]?-/, /^p[trblxy]?-/, /^space-[xy]-/, /^gap-/,
    /^w-/, /^h-/, /^max-w-/, /^min-w-/, /^max-h-/, /^min-h-/, /^size-/,
    /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|left|center|right|justify)$/,
    /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|sans|serif|mono)$/,
    /^leading-/, /^tracking-/,
    /^bg-(red|blue|green|yellow|purple|pink|indigo|gray|slate|zinc|neutral|stone|orange|amber|lime|emerald|teal|cyan|sky|violet|fuchsia|rose)-/,
    /^text-(red|blue|green|yellow|purple|pink|indigo|gray|slate|zinc|neutral|stone|orange|amber|lime|emerald|teal|cyan|sky|violet|fuchsia|rose)-/,
    /^border-(red|blue|green|yellow|purple|pink|indigo|gray|slate|zinc|neutral|stone|orange|amber|lime|emerald|teal|cyan|sky|violet|fuchsia|rose)-/,
    /^flex(-|$)/, /^grid(-|$)/, /^col(-|$)/, /^row(-|$)/, /^justify-/, /^items-/, /^content-/, /^self-/,
    /^place-/, /^order-/,
    /^rounded(-|$)/, /^border(-|$)/, /^divide-/, /^ring-/,
    /^col-/, /^offset-/, /^d-/, /^m[trblxy]?-\d+$/, /^p[trblxy]?-\d+$/, /^mb-/, /^mt-/, /^ms-/, /^me-/, /^px-/, /^py-/,
    /^block$/, /^inline$/, /^inline-block$/, /^hidden$/, /^absolute$/, /^relative$/, /^fixed$/, /^sticky$/, /^static$/,
    /^top-/, /^bottom-/, /^left-/, /^right-/, /^inset-/, /^z-/,
    /^(hover|focus|active|disabled|sm|md|lg|xl|2xl|dark|first|last|even|odd):/,
    /^opacity-/, /^cursor-/, /^pointer-events-/, /^select-/, /^overflow(-|$)/, /^truncate$/,
    /^transition(-|$)/, /^duration-/, /^ease-/, /^transform$/, /^translate-/, /^rotate-/, /^scale-/,
    /^shadow(-|$)/, /^outline-/, /^appearance-/, /^resize(-|$)/,
  ];

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'BR', 'HR', 'NOSCRIPT']);
  const BOOT_WAIT_MS = 1000;
  const POST_CLICK_WAIT_MS = 50;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isUtilityClass(cls) {
    if (!cls) return false;
    for (let i = 0; i < UTILITY_CLASS_PATTERNS.length; i++) {
      if (UTILITY_CLASS_PATTERNS[i].test(cls)) return true;
    }
    return false;
  }

  function stripUtilityClasses(classList) {
    return classList.filter((c) => !isUtilityClass(c));
  }

  // DJB2-style hash → unsigned hex. Short enough for log readability.
  function hashString(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16);
  }

  // Recursive: tag + concatenated hashes of element children. Text/comments ignored.
  function computeStructuralHash(el) {
    let inner = '';
    for (const child of el.children) {
      if (SKIP_TAGS.has(child.tagName)) continue;
      inner += computeStructuralHash(child);
    }
    return hashString(el.tagName.toLowerCase() + '[' + inner + ']');
  }

  // body > tag:nth-child(N) > … path. Verbose but stable across identical class names.
  function computeSelector(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName !== 'BODY' && cur.tagName !== 'HTML') {
      const parent = cur.parentElement;
      if (!parent) break;
      const tag = cur.tagName.toLowerCase();
      const idx = Array.prototype.indexOf.call(parent.children, cur) + 1;
      parts.unshift(tag + ':nth-child(' + idx + ')');
      cur = parent;
    }
    return parts.length ? 'body > ' + parts.join(' > ') : 'body';
  }

  function getTextSnippet(el) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > 80 ? text.slice(0, 77) + '…' : text;
  }

  // Walk DOM, emit one record per element with a class (no class → no signature).
  function walkDom(root) {
    const records = [];
    function visit(el) {
      if (!el || el.nodeType !== 1) return;
      if (SKIP_TAGS.has(el.tagName)) return;
      const classAttr = el.getAttribute('class');
      if (classAttr) {
        const allClasses = classAttr.split(/\s+/).filter(Boolean);
        const strippedClasses = stripUtilityClasses(allClasses);
        if (strippedClasses.length > 0) {
          records.push({
            tag: el.tagName.toLowerCase(),
            classes: strippedClasses,
            classString: classAttr,
            structuralHash: computeStructuralHash(el),
            outerHTML: el.outerHTML,
            textSnippet: getTextSnippet(el),
            selector: computeSelector(el),
          });
        }
      }
      for (const child of el.children) visit(child);
    }
    visit(root);
    return records;
  }

  function genId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'cap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  function captureFromIframe(iframe, label, source) {
    const doc = iframe.contentDocument;
    if (!doc) {
      throw new Error('captureFromIframe: iframe contentDocument is null (sandbox or not loaded)');
    }
    return {
      id: genId(),
      label: label || 'untitled',
      html: doc.documentElement.outerHTML,
      elements: walkDom(doc.body),
      thumbnail: null,
      source: source,
      capturedAt: Date.now(),
    };
  }

  // Derive a state label from the clicked element. Priority:
  //   1. marker attribute value (e.g. data-dev="populated")
  //   2. data-label (HiNAS convention)
  //   3. text content
  //   4. positional fallback
  function deriveLabel(btn, selector, indexInGroup) {
    const attrName = selector.replace(/[\[\]]/g, '');
    const attrValue = (btn.getAttribute(attrName) || '').trim();
    if (attrValue) return attrValue;
    const dataLabel = (btn.getAttribute('data-label') || '').trim();
    if (dataLabel) return dataLabel;
    const text = (btn.textContent || '').trim();
    if (text) return text;
    return 'state-' + (indexInGroup + 1);
  }

  // Boot capture always; marker scan adds states only if any selector matches.
  async function autoDetectAndCapture(html) {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1280px;height:800px;border:0;visibility:hidden;';
    iframe.sandbox = 'allow-scripts allow-same-origin';
    document.body.appendChild(iframe);
    try {
      await new Promise((resolve) => {
        iframe.addEventListener('load', resolve, { once: true });
        iframe.srcdoc = html;
      });
      await sleep(BOOT_WAIT_MS);
      const doc = iframe.contentDocument;
      if (!doc) {
        throw new Error('autoDetectAndCapture: iframe contentDocument is null (sandbox or not loaded)');
      }
      const bootCapture = captureFromIframe(iframe, 'boot', 'boot');
      let method = null;
      const additionalCaptures = [];
      for (const selector of STATE_MARKER_PATTERNS) {
        const matches = doc.querySelectorAll(selector);
        if (matches.length === 0) continue;
        method = selector;
        for (let i = 0; i < matches.length; i++) {
          const btn = matches[i];
          btn.click();
          await sleep(POST_CLICK_WAIT_MS);
          additionalCaptures.push(captureFromIframe(iframe, deriveLabel(btn, selector, i), 'auto'));
        }
        break;
      }
      return {
        bootCapture: bootCapture,
        autoDetect: {
          method: method,
          additionalCaptures: additionalCaptures,
          scanned: STATE_MARKER_PATTERNS.slice(),
        },
      };
    } finally {
      iframe.remove();
    }
  }

  // ============================================================
  // Pattern detection — bucket elements by (tag + structuralHash + classes)
  // ============================================================

  const DEFAULT_DETECT_SETTINGS = {
    matchByClassName: true,
    matchByStructure: true,
    splitOnClassModifiers: true,
    minimumInstances: 2,
  };

  function patternKey(record, settings) {
    const parts = [record.tag];
    if (settings.matchByStructure) parts.push(record.structuralHash);
    if (settings.matchByClassName) {
      let classes = record.classes;
      if (!settings.splitOnClassModifiers) {
        classes = Array.from(new Set(classes.map((c) => c.split('-')[0])));
      }
      parts.push(classes.slice().sort().join('.'));
    }
    return parts.join('|');
  }

  function deriveName(classes) {
    if (!classes.length) return 'untitled';
    return classes[classes.length - 1].replace(/-/g, ' ');
  }

  function detectPatterns(captures, settings) {
    const effective = Object.assign({}, DEFAULT_DETECT_SETTINGS, settings || {});
    const buckets = new Map();
    for (const capture of captures) {
      for (const el of capture.elements) {
        const key = patternKey(el, effective);
        if (!buckets.has(key)) buckets.set(key, { firstEl: el, instances: [] });
        buckets.get(key).instances.push({
          captureId: capture.id,
          captureLabel: capture.label,
          selector: el.selector,
          textSnippet: el.textSnippet,
          outerHTML: el.outerHTML,
        });
      }
    }
    const patterns = [];
    const unique = [];
    for (const [key, bucket] of buckets) {
      const entry = {
        key: key,
        name: deriveName(bucket.firstEl.classes),
        tag: bucket.firstEl.tag,
        classes: bucket.firstEl.classes,
        classString: bucket.firstEl.classString,
        structuralHash: bucket.firstEl.structuralHash,
        count: bucket.instances.length,
        instances: bucket.instances,
      };
      (entry.count >= effective.minimumInstances ? patterns : unique).push(entry);
    }
    patterns.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    unique.sort((a, b) => a.name.localeCompare(b.name));
    return { patterns: patterns, unique: unique };
  }

  window.figmaMigrateParser = {
    autoDetectAndCapture: autoDetectAndCapture,
    captureFromIframe: captureFromIframe,
    detectPatterns: detectPatterns,
    _internals: {
      walkDom: walkDom,
      computeStructuralHash: computeStructuralHash,
      computeSelector: computeSelector,
      stripUtilityClasses: stripUtilityClasses,
      patternKey: patternKey,
      deriveName: deriveName,
      STATE_MARKER_PATTERNS: STATE_MARKER_PATTERNS,
      DEFAULT_DETECT_SETTINGS: DEFAULT_DETECT_SETTINGS,
    },
  };
})();
