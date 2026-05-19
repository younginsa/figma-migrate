# Figma-migrate plugin — project context

> Compact reference for picking the work back up after time away.
> Last updated 2026-05-19.

## What this is

A Figma plugin that converts HiNAS HTML mockups into design-system-backed Figma artboards. Replaces the `/figma-migrate` slash command for designers who don't have Claude Code installed.

- **Repo:** https://github.com/younginsa/figma-migrate
- **Spec:** [docs/superpowers/specs/2026-05-15-figma-migrate-plugin-v0.1-state-machine-design.md](superpowers/specs/2026-05-15-figma-migrate-plugin-v0.1-state-machine-design.md)
- **Plan:** [docs/superpowers/plans/2026-05-15-figma-migrate-plugin-v0.1.md](superpowers/plans/2026-05-15-figma-migrate-plugin-v0.1.md)
- **v0.2 backlog:** [docs/superpowers/v0.2-backlog.md](superpowers/v0.2-backlog.md)

## How we got here (workflow)

Three skills, run sequentially:

1. **`/superpowers:brainstorming`** — converged on design via Q&A, produced the spec
2. **`/superpowers:writing-plans`** — broke design into 18 tasks, grouped into 5 phases (A-E) by dependency
3. **`/superpowers:subagent-driven-development`** — dispatches implementer + reviewer subagents per task, pauses for user verification at the end of each phase

Phase structure (A foundations → E manual rescue) was Claude's organizing choice during writing-plans, not predefined. User added "pause per phase" as the only cross-cutting execution preference.

## What v0.1 ships

| Phase | What | Status |
|---|---|---|
| A | Inline error helper, dynamic Screen 03 candidates from `data-ds-candidate` attribute | ✅ verified |
| B | Parse error UI, build cancel, build error retry, Done count cleanup | ✅ verified |
| C | DS source from in-file "Design system" page (legacy fallback), DS sync gate | ✅ verified |
| D | Pick DS component picker (Screen M), candidate→component mapping, build instantiates real DS components | ✅ verified |
| E | Manual rescue match (Screen N) for parser misses, Matched elements band | ⏸️ pending verification |
| F (planned) | Auto-capture html2canvas previews for unmapped DS Candidates | 📋 scoped, not started |

## What v0.1 deliberately doesn't do

- **No LLM/Claude API calls.** All judgment work is human-in-the-loop. Token cost per run: $0.
- **No team library import.** Figma plugin API doesn't reliably enumerate enabled libraries for community plugins. Plugin requires a "Design system" page in the same file.
- **No new component MASTER creation.** Plugin instantiates existing components; creating new design-system primitives is human design work.
- **No HTML→Figma vector translation.** Unmapped DS candidates currently render as empty labeled frames. Phase F adds PNG screenshot references; vector-editable HTML translation is weeks-to-months and not in scope.
- **No resume mid-build, no DS conflict gate, no per-element instantiation in state artboards.** All in v0.2 backlog.

## Key locked design decisions

- **DS Candidates convention:** HTML elements marked with `data-ds-candidate="..."` attribute. Authoring opt-in.
- **Build cancel:** Hard cancel, leave partial artboards on canvas (no rollback).
- **Approach:** Fix-in-place edits to existing `code.js` + `ui.html`. One shared `renderInlineError` helper unifies all error paths.
- **Manual match output:** New "Matched elements" band, one artboard per match (no inline placement in state artboards).
- **Library import:** Deferred. Use Design system page for v0.1.
- **Verification cadence:** Pause at end of each phase for user testing in Figma desktop.

## Q&A log

Compact answers to conceptual questions asked during the project. Append new ones at the top.

### Phase F: Add auto-capture screenshots for unmapped candidates? (2026-05-19)
Yes. ~4-5 hrs work, three tasks (F1 UI iframe + html2canvas, F2 PNG persistence, F3 build embed). For HTML with state-switcher JS, v0.1 captures default-state candidates only; driving state changes per capture deferred to v0.2.

### Can v0.1 produce flat editable UI for DS Candidates? (2026-05-19)
No — unmapped candidates currently render as empty labeled frames. Phase F (auto-capture) ships PNG visual references, image not vector. Vector HTML→Figma translation is multi-week to multi-month engineering (tools like Anima specialize in just this).

### Can v0.1 create new Figma components for DS Candidates? (2026-05-19)
No — only instantiates EXISTING components. Creating new component MASTERS is human design work. v0.1 could add a "promote candidate to empty component" shortcut (~1-2 hrs) but won't auto-design content.

### Does v0.1 include LLM/Claude API calls? (2026-05-19)
No. All judgment moments are human-in-the-loop UI prompts. v0.2 will add Claude-in-plugin (BYOK) for auto-resolving J-class rules: coverage map fill, parser-miss detection, text overrides, variant disambiguation.

### How did we set phases? (2026-05-19)
Phases were Claude's organizing choice during `/superpowers:writing-plans`, grouped by dependency. Not predefined. User opted for "pause per phase" verification cadence which made phases user-visible via TodoWrite checkpoints.

### Why did Phase C library import fail? (2026-05-18)
`figma.teamLibrary.getAvailableLibrariesAsync()` either doesn't exist for community plugins or returns empty for paid-plan team libraries shown in the Assets panel. Figma Plugin API restricts library enumeration by design. Scoped down to "Design system" page approach which works in HiNAS Control file.

### Why did the wrong file get uploaded during Phase A verify? (2026-05-15)
Two copies of `cpp-setting-tab-mockup.html` existed: `~/Downloads/` (April, no annotations) and `~/Documents/Claude/Projects/HiNAS/Control/` (annotated). User uploaded the Downloads copy by habit. Always use the project copy for testing.

### Why does empty/garbage HTML trigger a parse error now? (2026-05-15)
`parseHtml` originally returned `{states:[], modals:[], toasts:[]}` on garbage HTML without throwing — silent navigation to a useless Screen 02. Phase B added a guard: empty results (0 states + 0 modals + 0 toasts) are treated as parse error and show the inline error banner.

## Current state

- Phase A through D: complete and verified
- Phase E: complete, awaiting user verification in Figma
- Phase F (auto-capture): proposed, not started
- F1 smoke test + final code review: pending after Phase E verifies

## Next steps

1. User verifies Phase E end-to-end in HiNAS Control file
2. If Phase E good → either proceed to F1+final review (ship v0.1) OR add Phase F first (auto-capture)
3. Push final state to GitHub
