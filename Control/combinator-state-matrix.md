# Combinator Curve Profile — State Matrix & Behavior Spec (v2)

_Source: deep interview, 2026-04-24. Revised for two-depth architecture._
_HTML source file: `cpp-setting-tab-mockup.html` (to be restructured)._
_Design references: Figma file `xWU2OLJn6FFdQSFg79HMPC`, nodes `9243:122909` (dialog collection), `9244:123672` (toast), `9244:125970` (loading), `9244:126980` (empty)._

## 1. Architecture overview

The dialog now contains **two pages** (depths), navigated internally — the dialog itself stays open across navigation.

### Page 1 — Profile List (new)
Modeled on the macOS System Settings Wi-Fi / Bluetooth pattern.

- **Title:** "Combinator Curve Profile"
- **Subtitle:** "Setting > Combinator Curve Profile Editor"
- **"Selected Profile"** section: a single rounded-outline card with a check icon on the left and a **Details** button always visible on the right.
- **"Other Profiles"** section: a list of remaining profiles. Each row shows a **Details** button on the right that appears on **hover only**. Clicking the row body (anywhere except Details) opens the select-confirm modal.
- **Last row of Other Profiles list:** `+ Add Profile` (dashed-outline row; acts as a button). Clicking opens the Add Profile modal.
- **No footer actions.** Dialog close × is top-right only.

### Page 2 — Edit Profile (restructured current HTML)
- **Title:** `← Edit Profile N` (back arrow + label). Clicking back arrow returns to Page 1 (with unsaved-changes guard if dirty).
- **Subtitle:** unchanged breadcrumb, or remove if redundant.
- **Body:** the existing editor — profile selector **removed** (the page already knows which profile), old action buttons **removed** (they move to the footer), charts and table with insert/delete rows remain.
- **Footer:** `Delete Profile` (bottom-left, destructive) | spacer | `Cancel` `Save` (bottom-right).

## 2. Foundational decisions

| Topic | Decision |
|---|---|
| Data source | REST API to a backend service |
| Tab set | HTML's tabs are canonical: Control / Collision Avoidance / RPM Load / Combinator Curve Profile / Optimization / Backup |
| Font | Inter (replaces Rajdhani) |
| Theme | Dusk mode dark (Gray/50–900, Blue/400–500 primary, Red/500 destructive) |
| Container | Dusk-mode modal dialog with tab bar at top; pages transition inside the tab panel |

## 3. Action semantics

| Action | What it does |
|---|---|
| Click **Other Profile row body** | Opens select-confirm modal ("Do you want to select Profile N?") |
| Click **Details** (either Selected card or Other row) | Navigate to Page 2 for that profile |
| Click **+ Add Profile row** | Opens Add Profile modal (integer ID input) → on submit, POST to create → navigate to Page 2 for the new profile |
| Page 2 **Save** | PUT edited table → overwrites current revision in place |
| Page 2 **Delete Profile** | Opens Delete confirm modal → DELETE profile → return to Page 1 |
| Page 2 **back-arrow** | Navigate to Page 1; triggers unsaved-changes guard if dirty |
| Page 2 **Cancel** | Same as back-arrow (navigate to Page 1 with guard) |
| **Dialog ×** (top-right) | Close whole dialog; guard if Page 2 dirty |
| Click row **Delete** (in Page 2 table) | Instant delete with 5-second undo toast |

Note: the previous "Select This Profile" compound action no longer exists. Selecting (activating) and editing (saving) are now fully separated.

## 4. Validation rules (Page 2 table)

| Field | Valid range | Additional |
|---|---|---|
| `comb_pos` | −100 to 100 | Unique within the table |
| `rpm` | 0 to 1200 | Numeric, non-empty |
| `pitch_angle` | −90 to 90 | Numeric, non-empty |
| `pitch_percent` | −100 to 100 | Numeric, non-empty |

Invalid cells get a red border; tooltip on hover/focus shows the rule. Save disabled while any cell is invalid.

## 5. State matrix

### Page 1 — Profile List

| State | Trigger | Visual | Available actions |
|---|---|---|---|
| Loading | Dialog opens, profile list being fetched | Centered spinner + "Loading profiles…" | Dialog × |
| Empty | API returns zero profiles | Centered "No profile ID is found" + "Please add profile…" + primary **Add Profile** button (matches Figma `9244:126980`) | Add Profile, × |
| Populated | Profile list fetched, ≥1 profile | Selected Profile card + Other Profiles list + `+ Add Profile` dashed row | All row and Add interactions |
| Selecting | After user confirmed select-modal, API in flight | Clicked row shows inline spinner; other rows dimmed/non-interactive | Wait or × |
| Select success | API returned 2xx | Cards **swap** — clicked profile moves into Selected slot; former Selected moves to Other Profiles list. No toast (swap is feedback). | Resume |
| Select error | API returned non-2xx | Inline red banner at top of Page 1 with error message + **Retry** button. Row returns to Other Profiles list (not active). | Retry, × |

### Page 2 — Edit Profile

| State | Trigger | Visual | Available actions |
|---|---|---|---|
| Loading | Page 2 opened, table being fetched | Centered spinner + "Loading profile data…" (matches Figma `9244:125970`) | Back, × |
| Clean | Table loaded, no edits | Save button reads **"Save"**. Delete Profile enabled. | All |
| Dirty | Any edit, add, or delete since last save | Save button label flips to **"Save changes"**. | All |
| Invalid | One or more cells fail validation | Offending cells have red border; tooltip shows rule on hover/focus. Save **disabled**. | Edit, Delete row, Delete Profile, Cancel |
| Saving | User clicked Save | Save button shows inline spinner + "Saving…". Inputs and Delete Profile disabled. | Back/Cancel (triggers guard if request still in flight; see open question) |
| Save success | API 2xx | Toast bottom-right, 4s, "Profile saved". Editor returns to clean state. | All |
| Save error | API non-2xx | Inline red banner above editor with error + **Retry**. Editor stays dirty so user can retry. | Retry, edit more, Cancel |
| Network error | Request timed out / no network | Same inline red banner, copy: "Couldn't reach the server. Check your connection and retry." | Same as Save error |
| Delete row + undo | User clicked Delete on a table row | Row disappears; 5-second toast bottom-right: "Row deleted — Undo". | Continue editing; Undo |

### Modals

| Modal | Trigger | Copy | Buttons |
|---|---|---|---|
| Select confirm | Clicking Other Profile row body | "Do you want to select Profile N?" | Cancel / **Select** |
| Add Profile | Clicking `+ Add Profile` row (or empty-state CTA) | Title: "Add Profile". Single input: "Profile ID" (integer). Client-side validates: integer + not already taken. | Cancel / **Add** |
| Delete Profile confirm | Page 2 Delete Profile button | "Delete Profile N? This cannot be undone." | Cancel / **Delete** (red) |
| Unsaved-changes guard | Page 2 back-arrow, Cancel, or dialog × while Page 2 is dirty | "You have unsaved changes. What would you like to do?" | **Save** / Discard / Cancel |

## 6. Defaults (used unless you override)

- **After Add Profile submit:** POST to create → navigate to Page 2 with the new profile loaded (starts with one default row: `comb_pos: 0, rpm: 117, pitch_angle: 0, pitch_percent: 0`). User immediately edits; must click Save to persist content.
- **After Select confirm success:** cards swap, no toast. If you prefer a "Profile N is now active" toast, flip this.
- **Clicking the Selected Profile card body (outside Details button):** no-op. Only Details opens Edit.
- **Clicking the Other Profile row body (outside Details button):** opens Select-confirm modal for that profile.
- **Undo toast duration:** 5s.
- **Success toast duration:** 4s.
- **Save button label:** "Save" when clean, "Save changes" when dirty, "Saving…" during API call.

## 7. Open questions (not blockers)

1. **Deleting the currently-active profile** — should the API/UI refuse, or should the UI auto-promote another profile to active after delete? Needs product decision; I'll assume **refuse on the UI side** with banner "Can't delete the active profile. Select another profile first." unless you say otherwise.
2. **In-flight save + navigate-away** — if user clicks Back/Cancel while Save is in flight, do we cancel the request, wait for it, or block navigation? Default: **wait and block** (show spinner on the button, disable back-arrow).
3. **Revision concept** — data model has revisions, but with overwrite-in-place, user never picks one. Keeping it hidden from UI.
4. **Profile list size** — if >20 profiles, does Page 1 need search/filter? Flagging for later.
5. **Route/URL structure** — if this dialog has URL state (e.g., deep-linkable to Page 2), we need a scheme. Default: pure in-memory page navigation, no URL changes.

## 8. What changed from v1

- "Select This Profile" compound button is **removed**. Activation now happens via Page 1 row click + confirm modal.
- "Save Profile" and "Add New Profile" buttons are **removed** from the editor. Save moves to Page 2 footer; Add moves to the dashed row at the bottom of Page 1's Other Profiles list.
- **Delete Profile** is added to Page 2 footer (was out of scope in v1 but re-added by user).
- The existing HTML will be **wrapped into Page 2** and a **new Page 1 layout** will be built around it, plus two new modals (Select confirm, Add Profile) and a back-button header.
