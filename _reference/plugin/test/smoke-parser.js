#!/usr/bin/env node
// Smoke test for plugin/code.js parser logic.
//
// Runs the pure-JS portions of code.js (no figma API dependency) against the
// canonical test HTML and asserts expected output. Use this between phases to
// confirm parser logic is intact regardless of what Figma desktop is running.
//
// Usage:
//   node plugin/test/smoke-parser.js
//
// Exit code 0 = pass, 1 = fail.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CODE_JS = path.join(REPO_ROOT, 'plugin', 'code.js');
const TEST_HTML = path.join(REPO_ROOT, 'Control', 'cpp-setting-tab-mockup.html');

function extractFunctionSource(src, fnSignature) {
  const start = src.indexOf(fnSignature);
  if (start === -1) throw new Error('Function not found: ' + fnSignature);
  let depth = 0, i = start, started = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) { i++; break; } }
    i++;
  }
  return src.slice(start, i);
}

function loadFn(src, fnSignature, name) {
  const body = extractFunctionSource(src, fnSignature);
  return new Function('arg', body + '\nreturn ' + name + '(arg);');
}

function assertEq(label, actual, expected) {
  if (actual === expected) {
    console.log('  PASS ' + label + ': ' + actual);
    return true;
  }
  console.log('  FAIL ' + label + ': expected ' + expected + ', got ' + actual);
  return false;
}

function assertGte(label, actual, min) {
  if (actual >= min) {
    console.log('  PASS ' + label + ': ' + actual + ' (>= ' + min + ')');
    return true;
  }
  console.log('  FAIL ' + label + ': expected >= ' + min + ', got ' + actual);
  return false;
}

console.log('Loading code.js...');
const codeJs = fs.readFileSync(CODE_JS, 'utf8');
console.log('Loading test HTML...');
const html = fs.readFileSync(TEST_HTML, 'utf8');

console.log('Extracting parseHtml...');
const parseHtml = loadFn(codeJs, 'function parseHtml(html)', 'parseHtml');

console.log('\nRunning parseHtml against CCP HTML...');
const result = parseHtml(html);

let ok = true;
console.log('\n--- Assertions ---');
ok = assertGte('states.length', result.states.length, 5) && ok;
ok = assertGte('modals.length', result.modals.length, 3) && ok;
ok = assertGte('toasts.length', result.toasts.length, 3) && ok;
ok = assertEq('candidates.length', result.candidates.length, 3) && ok;

// Phase E v3: modals are objects { name, title, body } (was: bare strings).
// Verify the contract — at least one modal has a name; title/body may be
// empty if the parser couldn't extract them, but the shape must be object.
console.log('\nModal shape check (Phase E v3 — object with name/title/body):');
const badShape = result.modals.filter(m => typeof m !== 'object' || !m || typeof m.name !== 'string');
if (badShape.length > 0) {
  console.log('  FAIL: ' + badShape.length + ' modal(s) are not objects with .name string');
  ok = false;
} else {
  console.log('  PASS: all ' + result.modals.length + ' modals are { name, title, body } objects');
}
result.modals.forEach((m, i) => {
  console.log('  ' + (i + 1) + '. name="' + m.name + '" title="' + m.title + '" body="' + (m.body || '').slice(0, 40) + '"');
});

console.log('\nCandidate names:');
result.candidates.forEach((c, i) => {
  console.log('  ' + (i + 1) + '. "' + c.name + '" (htmlText: "' + c.htmlText + '")');
});

// Verify all candidates have htmlText: "" (per A2 fix dropping broken extraction)
const badTextCandidates = result.candidates.filter(c => c.htmlText !== '');
if (badTextCandidates.length > 0) {
  console.log('  FAIL: candidates have non-empty htmlText (expected "" for v0.1):');
  badTextCandidates.forEach(c => console.log('    - ' + c.name + ': "' + c.htmlText + '"'));
  ok = false;
} else {
  console.log('  PASS: all candidates have htmlText: "" (correct for v0.1)');
}

// Pattern signature extraction (Phase H)
console.log('\nPattern signature check (Phase H1):');
if (!Array.isArray(result.patterns)) {
  console.log('  FAIL: patterns is not an array');
  ok = false;
} else {
  console.log('  PASS: patterns is array (' + result.patterns.length + ' distinct signatures)');
  ok = assertGte('patterns.length', result.patterns.length, 5) && ok;
  console.log('  Top 5 patterns:');
  result.patterns.slice(0, 5).forEach(function (p, i) {
    console.log('    ' + (i + 1) + '. ' + p.signature + ' (count=' + p.count +
      ', exampleText="' + (p.exampleText || '').slice(0, 40) + '")');
  });
  // Shape check on first entry
  if (result.patterns.length > 0) {
    var p0 = result.patterns[0];
    var shapeOk = typeof p0.signature === 'string' &&
      typeof p0.tag === 'string' &&
      Array.isArray(p0.classes) &&
      typeof p0.count === 'number' &&
      typeof p0.exampleText === 'string';
    if (shapeOk) {
      console.log('  PASS: pattern entry shape {signature, tag, classes, count, exampleText}');
    } else {
      console.log('  FAIL: pattern entry missing expected fields');
      ok = false;
    }
  }
  // Sorted desc by count
  var sortedOk = true;
  for (var si = 1; si < result.patterns.length; si++) {
    if (result.patterns[si].count > result.patterns[si - 1].count) {
      sortedOk = false;
      break;
    }
  }
  if (sortedOk) {
    console.log('  PASS: patterns sorted by count descending');
  } else {
    console.log('  FAIL: patterns not sorted by count descending');
    ok = false;
  }
}

console.log('\n--- Summary ---');
console.log('states:', result.states.length);
console.log('modals:', result.modals.length);
console.log('toasts:', result.toasts.length);
console.log('candidates:', result.candidates.length);
console.log('dsComponents:', result.dsComponents.length);
console.log('tabs:', result.tabs.length);
console.log('patterns:', result.patterns.length);

if (ok) {
  console.log('\nALL CHECKS PASSED');
  process.exit(0);
} else {
  console.log('\nFAILED');
  process.exit(1);
}
