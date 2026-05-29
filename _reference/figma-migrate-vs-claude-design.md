# `/figma-migrate` vs. Claude Design — an evaluation for Avikus

_Author: Avikus Product Design · Last updated: 2026-05-06_
_Audience: All Avikus team members. No design background assumed._

---

## TL;DR

Anthropic launched **Claude Design** in April 2026. It is a chat-plus-canvas web app that generates designs, prototypes, slides and one-pagers from a written prompt. We already use **`/figma-migrate`**, an internal Claude Code command that converts a HiNAS HTML mockup into real Figma artboards built from our live design-system components.

The two tools solve different problems and one cannot replace the other today. `/figma-migrate` is the only path we have for producing production-ready Figma assets that use the actual HiNAS design system; Claude Design currently does not write back to Figma at all. Claude Design is, however, a faster path to first-draft visuals for non-designers — sales decks, internal explainers, exploration sketches — without touching Figma.

**Recommendation:** Keep `/figma-migrate` as the production tool for Figma deliverables. Pilot Claude Design with a small group for non-Figma artifacts (decks, one-pagers, early exploration). Re-evaluate in six months or when Anthropic adds a native Figma export, whichever comes first.

| Dimension | `/figma-migrate` | Claude Design |
|---|---|---|
| Tasks covered | HTML mockup → Figma artboards using live HiNAS DS components, including modal/toast spawning and DS-candidate detection | Prompt → polished slides, one-pagers, prototypes, mock UIs; export to PPTX/PDF/HTML/Canva or hand off to Claude Code |
| Setup cost | High first time: Claude Code, Figma MCP server, slash-command file in repo, DS components published with stable keys. Designer/engineer-only. | Low for end user: open `claude.ai/design`. Org-level setup: admin enables it (default-off on Enterprise), uploads brand assets, links repo. |
| Maintenance when DS changes | Edit the slash command and rerun the self-test. Versioned in git, fully transparent. | Re-ingest the design system in Org Settings; verify outputs still match brand. Less granular control over how rules are interpreted. |
| Figma / Jira / Confluence integration | Native Figma write via MCP. No direct Jira/Confluence (Claude Code can do it separately). | No native Figma write. Outputs leave as files (PPTX/PDF/HTML), Canva pushes, or Claude Code handoff bundles. |
| Output quality and designer control | Deterministic. Real component instances. Editable in Figma like any other artboard after the run. | Polished AI-generated layouts; on-canvas editing limited to colours, type, margins, basic moves. Larger changes require chatting with the AI. |
| Cost and access | Already in scope of our Claude Code seats and Figma seats. Restricted to people comfortable with terminal + MCP. | Pro / Max / Team / Enterprise plans. Default-off on Enterprise; admin must grant access. Token consumption is reportedly heavy in research preview. |
| Best-fit use cases at Avikus | Production Figma artboards for HiNAS Control / SVM / Cloud once an HTML mockup is locked. | First-draft decks, one-pagers, customer-facing visuals, fast exploration where Figma is not the destination. |

---

## What `/figma-migrate` actually does

`/figma-migrate` is a Claude Code slash command that lives in our HiNAS repository. It takes one input — the absolute path to a HiNAS HTML mockup — and produces a band of Figma artboards on the canvas, each one a screen state extracted from that HTML.

**End-to-end flow:**

1. Read and parse the HTML. Extract every state the HTML renders (loading, empty, populated, dirty, saving, error and so on), every visible string per state, every design-system component the HTML uses (Button, Modal, Toast, System states), and every conditional show/hide.
2. Inspect the master DS component layer tree before touching any instance, including hidden layers, so the script knows which children are visibility-toggled per variant.
3. Create a fresh instance of the right DS component for each state. Never reuse a modified instance — stale instances tend to be missing children that exist in the master.
4. Toggle child visibility on each instance to match what the HTML renders for that state. The rule is: if HTML shows it, set the matching DS layer visible; if HTML omits it, hide it. Never add a separate component instance for something that already exists inside a DS component.
5. Apply text overrides by targeting text nodes by their current character content (not by layer name, which is generic). Always load the font async first.
6. Apply positioning rules for the HiNAS standard band hierarchy: tab bar, title, body, optional footer. The body band uses auto-layout centring, removing the per-pixel maths the workflow used to need. Toasts and modals escape the flow with absolute positioning at spec-defined margins.
7. Spawn extra artboards automatically. One artboard per `openModal*()` and `openConfirm*()` call in the HTML, named for the modal title; one artboard per `showToast(...)` invocation. The command picks the natural parent state for each modal (Add Profile sits on Empty, Delete sits on Edit, the unsaved-changes guard sits on Edit dirty, and so on).
8. Produce a labelled "DS Candidates" band for any HTML structure not yet in the design system, so the design team can promote it into the DS deliberately rather than letting one-off ad-hoc shapes accumulate.
9. Verify by re-inspecting the live instance and checking that the right children are visible, the right text strings are set, and no stale external instances are floating at the artboard level.

**What is automated:**

- All scaffolding (auto-layout bands, sizing, padding).
- All DS component instantiation.
- All text overrides where the source string is in the HTML.
- All state-by-state artboard generation.
- Modal and toast spawning and naming.
- DS-candidate detection.
- A self-test artboard whenever a visual rule in the command file changes, so the new behaviour can be reviewed before it ships.

**What still needs human design judgement:**

- Whether a DS-candidate should actually become a DS component, or whether the HTML should be rewritten to reuse an existing one.
- Final visual polish on edge cases (very long labels, unusual stacking).
- Decisions about new states the HTML does not yet model.
- Whether the HTML mockup itself reflects the intended product behaviour. The command treats HTML as the source of truth and never second-guesses it.

**Avikus-specific assumptions baked in:**

- A specific Figma file is the target canvas. Component keys for Button, Modal, Toast and System states are hard-coded.
- A specific HTML structure convention: dev panel switches, `openModal*()`/`showToast()` calls, state render functions like `renderLoadingPage()`. These come straight from how we write Control mockups today.
- Default placement coordinates and a 4×N grid with stride 1320×880 — a HiNAS canvas convention.
- An artboard naming scheme tied to product-spec terminology ("Setting / Edit / Dirty" and so on).
- Implicit dependence on the Dusk-mode token set used by Control and SVM.

**Visible limitations and edge cases:**

- The command refuses to ask for clarification on placement, naming or state list. That is by design — it makes runs deterministic — but it also means the HTML must already be well-formed. Bad input quietly produces bad artboards.
- Hard-coded component keys mean any restructure of the DS Figma file (re-publishing the library, key rotation) breaks the command until the keys are updated.
- Each run targets one Figma file. Multi-file fan-out is not supported.
- The self-test pattern only triggers on visual rule changes, and only by Claude noticing the rule changed. A drifted process rule can land silently.
- The command needs Claude Code installed locally and the Figma MCP server connected. A designer without that environment cannot run it.

---

## What Claude Design is

Claude Design is a separate Anthropic Labs web app at `claude.ai/design`, launched 17 April 2026 and currently in research preview. The interface is a chat panel on the left and a canvas on the right; the user describes what they need in chat, the model (Claude Opus 4.7) renders an initial version on the canvas, and refinement happens through a mix of chat, inline canvas comments, direct edits and small adjustment sliders.

**Design-system setup.** An organisation owner goes into Organization Settings and creates a design system. The setup ingests brand assets from several sources — uploaded codebases, slide decks, PDFs, logos, colour palettes, type specimens — and can also connect to a GitHub repository so the model can read `components/`, `styles/`, `tokens.css` and equivalent files directly. From the assets, Claude extracts colours, typography, components and layout patterns and stores them as the team's design system. Every new project then defaults to using those assets. Anthropic's own onboarding guidance recommends a checkpoint where a small group of designers verifies the extracted system against brand guidelines before the wider team uses it; community write-ups echo that the model picks "sensible defaults" that often need correction.

**Automation surface.** Without prompting, the model produces an initial version of whatever was asked for: a deck, one-pager, prototype, marketing visual, mock UI. Refinement is iterative: chat instructions, comments pinned to elements, direct edits for things like colour and font, and adjustment sliders for things like spacing. Reviewers consistently report two patterns: (a) the first generation is impressive, (b) fine-grained changes beyond colours, fonts, borders and margins still mean talking to the AI rather than dragging things around like in Figma.

**Export and handoff.** Outputs can be downloaded as ZIP, PDF or PPTX, sent to Canva, exported as standalone HTML, or sent to Claude Code as a "handoff bundle" — a packaged spec containing the component structure, design tokens used, layout hierarchy and referenced assets, written specifically so Claude Code can consume it and produce the implementation. There is currently **no native Figma export** and no live Figma sync.

**Access model.** Claude Design is available on Pro, Max, Team and Enterprise plans. On Enterprise it is **default off**: an admin must enable it in Organisation Settings and can scope access through role-based controls rather than enabling it organisation-wide. Anthropic's recommended Enterprise rollout is a phased one, starting with two to four trusted designers and design leads who validate the design system before opening it up.

**Known limitations from the research preview phase:**

- Inline comments occasionally disappear before the model reads them; workaround is pasting the comment into chat.
- The compact layout mode can trigger save errors; switching to full view and retrying is the documented fix.
- Linking very large repositories causes lag or browser issues; Anthropic suggests linking specific subdirectories rather than entire monorepos.
- No real-time multi-user co-editing, no public share links, no audit logs or usage tracking yet.
- No accessibility audit, predictive heatmaps or usability scores.
- Heavy token consumption — multiple Pro users have reported hitting their weekly cap within thirty to forty minutes of active use, and Max users have reported consuming a substantial share of their weekly budget across two sessions.
- Generation latency in independent reviews has been around four to seven minutes per prompt.
- No native Figma round-trip.

---

## Side-by-side, dimension by dimension

### Tasks covered

`/figma-migrate` does one thing: turn a finished HTML mockup into a complete band of Figma artboards built from the live HiNAS design-system components. It will not generate a net-new design idea, write a slide deck, or produce a one-pager. Its job starts after a designer or engineer has written the HTML.

Claude Design does the opposite. It generates designs, prototypes, slides, one-pagers and marketing visuals from a written prompt, but does not write back to Figma. Its job ends before the design is in our canonical canvas.

The overlap is small: both will produce something that resembles a HiNAS-styled UI. Only `/figma-migrate` produces editable Figma layers using our published design-system components.

### Setup cost (designer vs. non-designer)

`/figma-migrate` requires Claude Code installed locally, the Figma MCP server connected, the slash-command file present in the repo, the HiNAS DS Figma library published with stable component keys, and the user comfortable enough with the terminal to invoke a command and pass a file path. This is realistic for designers and engineers; it is not realistic for sales, ops, or most PMs.

Claude Design requires the user to open a URL. Org-level setup is heavier — an admin enables the feature on Enterprise, then a small designer group ingests the design system once. After that, anyone with access can prompt it.

### Maintenance when the design system changes

`/figma-migrate` requires the slash-command author to update component keys, defaults, scaffolding rules and the self-test on every meaningful DS change. The cost is real but transparent — the rules are versioned in git and human-readable.

Claude Design requires re-ingesting the design system in Org Settings. The rules the model derives from the ingested assets are not directly inspectable. When something looks wrong, the recourse is more iteration in chat rather than editing a file.

### Integration with Figma, Jira, Confluence

`/figma-migrate` writes natively to Figma through the MCP. It has no Jira or Confluence integration of its own, but Claude Code in the same environment can post to Jira or Confluence via separate connectors.

Claude Design has no native Figma write. Its outputs leave the tool as PPTX, PDF, HTML, a Canva push, or a Claude Code handoff bundle. None of those are equivalent to "the design now exists as Figma layers in our shared library file." Several third parties (Anima, html.to.design, others) have published manual import paths from Claude Design to Figma; all involve rebuilding rather than syncing.

### Output quality and designer control

`/figma-migrate` produces deterministic output. The same HTML, run twice, produces the same artboards. The artboards use real component instances, so any change to the DS master ripples into them. A designer can edit the artboards as freely as anything else in Figma after the migration.

Claude Design's first generation is widely reported to look polished. Iteration past colour, typography, borders, and margins still routes through the AI; designers cannot freely grab elements and reposition them the way they would in Figma. For final refinement and production-ready hand-off, most reviewers still reach for Figma at some point.

### Cost and access

`/figma-migrate` is bundled into our existing Claude Code and Figma seats. There is no extra licensing cost; the constraint is the technical bar to use it.

Claude Design is included on Pro, Max, Team and Enterprise. Two practical concerns: (a) it is default off on Enterprise, so adoption requires an admin decision; (b) early reviewers describe heavy token consumption that can exhaust weekly Pro caps in well under an hour. For Avikus to use it broadly we would want a clear read on how that consumption translates to our team-plan limits.

### Best-fit use cases at Avikus

`/figma-migrate` is the right tool whenever the destination is Figma, the design-system fidelity matters, and an HTML mockup either exists or is cheaper to write than a hand-built Figma artboard set. That is most of HiNAS Control, SVM, and Cloud production work, especially state-heavy screens (loading, empty, populated, dirty, saving, error, modals, toasts).

Claude Design is the right tool when the destination is not Figma, when speed of first draft beats fidelity, and when the user is not a designer. Pitch decks, internal explainer one-pagers, customer-facing visuals, early exploration of an idea before committing to an HTML or Figma build.

---

## If you're a…

**Designer.** `/figma-migrate` continues to be your path for Figma deliverables — Claude Design will not write to Figma for you today. Where Claude Design might help: rapidly producing the supporting deck or one-pager for a design review without leaving Anthropic's tools. Watch the token-consumption reports before relying on it for daily work.

**Product manager.** Claude Design is the more interesting tool for you: prompts to first-draft decks, status one-pagers, lightweight prototypes for stakeholder reviews, all without bothering a designer. `/figma-migrate` does not affect your day-to-day; you will see its output in Figma as polished artboards once an HTML mockup ships.

**Engineer.** `/figma-migrate` is unchanged — it is the canonical way design states arrive in Figma from your HTML mockups. Claude Design's "send to Claude Code" handoff bundle is worth knowing about: when a PM or designer prototypes in Claude Design, you can receive the design as a structured spec rather than a Figma link or a screenshot, which Claude Code can then implement against. Useful for greenfield exploration; not a replacement for the existing design-spec docs.

**Sales / ops.** Claude Design is the most relevant new tool for you: chat-driven generation of pitch decks, customer one-pagers, training materials and internal explainers, with HiNAS brand applied automatically once design-system setup is done. It does not touch Figma or our product code, so there is no risk to engineering workflows. The practical questions are access (Enterprise admins must turn it on) and cost (token consumption is high in research preview).

---

## Recommendation: what should Avikus do next?

**Keep `/figma-migrate`.** It solves a job Claude Design cannot do today — producing real Figma artboards from real HiNAS design-system components — and is already in our workflow. Nothing about Claude Design's launch reduces its value.

**Pilot Claude Design with a small group, on non-Figma deliverables.** Two to four people across PM, sales/ops, and one designer for one quarter. Constrain the pilot to artefacts that would otherwise leave the design team's plate (decks, internal one-pagers, exploration sketches), so the pilot does not collide with `/figma-migrate`. Track:

- Time from prompt to acceptable first draft.
- How often the output respects the HiNAS brand vs. needs hand-correction.
- Real token-consumption against our plan limits.
- Specific cases where the output was unblocked by Claude Design and would otherwise have waited on a designer.

**Set the right access posture.** On Enterprise, leave Claude Design default-off and grant access to the pilot group through role-based controls. Do not enable it organisation-wide until the pilot has answered the cost and brand-consistency questions.

**Do not invest in a workaround for the Figma-export gap.** Several third parties offer "Claude Design → Figma" import paths, but they all involve rebuilding rather than syncing. The cleaner posture is to wait. Anthropic has made clear this is research preview, and a native Figma export is the most-requested missing feature in public reviews; if it ships, the calculus changes.

**Re-evaluate in six months.** Specifically, re-evaluate when one of these is true: native Figma export ships in Claude Design, the research-preview label comes off, the pilot group reports a clear net win, or the pilot group reports it does not justify the access overhead. Whichever happens first.

**Hybrid workflows worth trying during the pilot.**

- **Exploration → production.** PM uses Claude Design to draft three directions for a new Control screen as rough HTML or an interactive prototype. Designer picks one direction, hand-rebuilds the HTML mockup to our convention, and runs `/figma-migrate` to produce the Figma artboards. Claude Design speeds up the "what should this look like" step; `/figma-migrate` handles the "make it real in our DS" step.
- **Production → narrative.** Designer ships state artboards via `/figma-migrate`. PM or sales then uses Claude Design with the same DS to produce a customer-facing deck or release one-pager that visually matches what shipped, without needing the designer to design the deck.
- **Engineer handoff via Claude Design.** Designer or PM prototypes a single new screen idea in Claude Design and exports the Claude Code handoff bundle to engineering as a starting point — useful when the brief is "build this rough idea and we will design properly later," less useful when the brief is "build this exact design."

---

## Sources

- [Introducing Claude Design by Anthropic Labs](https://www.anthropic.com/news/claude-design-anthropic-labs)
- [Claude Design admin guide for Team and Enterprise plans — Claude Help Center](https://support.claude.com/en/articles/14604406-claude-design-admin-guide-for-team-and-enterprise-plans)
- [Get started with Claude Design — Claude Help Center](https://support.claude.com/en/articles/14604416-get-started-with-claude-design)
- [Set up your design system in Claude Design — Claude Help Center](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design)
- [Anthropic launches Claude Design — TechCrunch](https://techcrunch.com/2026/04/17/anthropic-launches-claude-design-a-new-product-for-creating-quick-visuals/)
- [Anthropic just launched Claude Design — VentureBeat](https://venturebeat.com/technology/anthropic-just-launched-claude-design-an-ai-tool-that-turns-prompts-into-prototypes-and-challenges-figma)
- [Claude Design review: features, pricing, and real limitations — UX Pilot](https://uxpilot.ai/blogs/claude-design-review)
- [Claude Design Review: Features, Pros, Cons, and Best Alternatives — Anima](https://www.animaapp.com/blog/ai-design-en/claude-design-review-features-pros-cons-and-best-alternatives/)
- [I tried Claude Design for half an hour. I'm already locked out for a week — PCWorld](https://www.pcworld.com/article/3117811/i-tried-claude-design-for-half-an-hour-im-already-locked-out-for-a-week.html)
- [How to go from Claude Design to Figma — Anima Blog](https://www.animaapp.com/blog/genai/how-to-go-from-claude-design-to-figma/)
- [Claude Design to Claude Code: AI Design Handoff — claudefa.st](https://claudefa.st/blog/guide/mechanics/claude-design-handoff)
- [Figma — Claude Plugin (Anthropic)](https://claude.com/plugins/figma)
- [Claude Code and Figma: Set up the MCP server — Figma Help Center](https://help.figma.com/hc/en-us/articles/39888612464151-Claude-Code-and-Figma-Set-up-the-MCP-server)
