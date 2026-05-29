# HiNAS — always-on rules

These rules apply to **every** request in the HiNAS project, regardless of whether `/figma-migrate` is running. Each rule is a gate — fire it whenever the triggering condition appears.

> **Status reporting (for the 2nd Terminal checklist view).** Whenever a rule fires, mark its status with:
> ```bash
> bash .claude/scripts/rule.sh "<rule heading>" running   # before doing the check
> bash .claude/scripts/rule.sh "<rule heading>" done      # after the check passes
> ```
> Use the **exact `## ` heading text** below as the label (e.g. `"DS sync"`). Done state auto-fades after 3 seconds. Paths are relative to the project root (Claude Code's working directory).

---

## DS sync

**Trigger:** any time Claude is about to read, reference, or modify the Figma Design System.

**Action:**
1. Sample the live `Design system` page in Figma.
2. Diff against `.claude/ds-manifest.json`.
3. Always print the result:
   - **Changed** → surface the diff and ask the user: "DS has changed since {date}. Update manifest, or use cached version?"
   - **Unchanged** → confirm: "no changes since {date}".

**Why:** stale DS knowledge causes wrong component picks and silent drift between code and design.

---

## DS conflict gate

**Trigger:** Claude is about to override a property on a master component instance, but the master renders incorrectly in the new context.

**Action:** pause before any override. Surface the mismatch (what the master shows vs. what the context expects). Ask the user how to proceed — fix the master, override the instance, or use a different component.

**Why:** silent overrides hide DS bugs and create one-off drift that compounds across artboards.

---

## Bulk operation gate

**Trigger:** Claude is about to perform a rebuild, mass swap, or retrofit affecting more than ~3 artboards or pages.

**Action:** before proceeding, ask: "Full pages vs. targeted pages?" Wait for explicit scope confirmation.

**Why:** bulk operations are hard to reverse and easy to misjudge. A 30-second confirmation prevents large rollbacks.
