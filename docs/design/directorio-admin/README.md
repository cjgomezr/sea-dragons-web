# Handoff: Directory — admin view redesign

## Overview
A redesign of `/directorio` (the admin view) for `cjgomezr/sea-dragons-web`. Goals: fit far more members on screen, cut the filter area from three rows to one, take the inline role `<select>` and **Save** button out of each row, and bring role requests, AUF renewals and data gaps into one side panel. Phone and desktop are both covered.

**The design to build is option `2a` (desktop) and `2b` (phone)** in `Directory Upgrade.dc.html`, the section headed "2". Sections "1" (1a–1e) are earlier explorations kept for reference only. Do **not** build them.

## About the design files
These files are **design references made in HTML**. They show the intended look and behaviour; they are not production code. Rebuild them in the existing Next.js / React codebase (`src/components/directory/*`, `src/app/globals.css`) using its own patterns: the i18n `translate()` keys, `MemberAvatar`, `useDismissal`, the `<dialog>` sheets, the server-side sorting and filters, and the existing API endpoints.

Open `Directory Upgrade.dc.html` in a browser to try it. It loads `support.js` from the same folder and Phosphor icons from unpkg. The Nocturne stylesheet reference will 404 outside the design project; option 2 doesn't depend on it. The sample data is invented.

## Fidelity
**High fidelity.** The colours are the dark-theme tokens from `src/app/globals.css`, so use the CSS variables, not the hex values. Fonts are shown with the system stack; use the app's `--font-family-body`, `--font-family-heading` and `--font-family-mono`. Spacing in the mocks matches the app's 4/8/12/16/24 scale.

## Mapping to the current code
| Design piece | Current file(s) |
| --- | --- |
| Toolbar (search, role segmented control, Filters popover, active-filter chips) | `DirectoryFilters.tsx`, `DirectoryMoreFilters.tsx` |
| Member list | `DirectoryTable.tsx`, `DirectorySortControl.tsx` |
| Side panel: member detail | `MemberRoleControl.tsx`, `DirectoryContactCell.tsx`, `record-fields.tsx`, `MemberRecordScreen.tsx` (link) |
| Side panel: club overview + role requests | `RoleRequestsPanel.tsx`, `PendingRequestsTray.tsx` |
| Invitation pending / resend | `InvitationResend.tsx` |
| Email / Export | `DirectoryEmailComposer.tsx`, `DirectoryExportButton.tsx` |

## Screens

### 2a — Desktop (≥768px)
Page content to the right of the existing sidebar. From top to bottom:

**1. Header row** (`padding: 22px 24px 14px`, bottom border `--color-border`)
- Left side:
  - "Directory": heading font, 28px, weight 700.
  - Next to it, in mono 12px `--color-text-secondary`: "{shown} of {total} members".
- Below the heading, one status line:
  - With no requests: a check-circle icon in `--color-success` and "No pending requests" (12.5px, secondary).
  - With requests: a pill "{n} role request(s) waiting →".
    - Pill style: `border-radius: 999px`, accent at 14% for the background, accent at 45% for the border, text `#cfe8f7`, font 12.5px weight 600.
    - A click clears the selection and opens the panel on the overview.
    - Mind the plural: "1 role request waiting" / "2 role requests waiting".
- Right side: three **icon-only** 38×38 buttons, radius 8. Each has a `title` and an `aria-label`.
  - Email (envelope-simple): panel background, 1px border, accent border on hover.
  - Export CSV (download-simple): same style.
  - Invite member (user-plus): primary, filled `--color-accent` with icon colour `--color-on-accent`.

**2. Toolbar row** (one line, `gap: 8px`)
- **Search input**: grows to fill, 38px tall, magnifying glass on the left, panel background, border.
- **Role segmented control**: All / Player / Coach / Committee / Admin.
  - Container: 3px padding, border, panel background.
  - Active option: filled accent, text on-accent, weight 600.
  - Inactive option: secondary text; on hover, background `#1a3349`.
- **Filters button**: funnel icon + "Filters" + a count badge.
  - Badge: 18px circle, accent fill, 11px bold, shows the active-filter count.
  - It opens a **popover** anchored to the right edge: 460px wide, panel background, border, radius 10, shadow `--shadow`, 16px padding.
  - The popover holds:
    - a 2×2 grid of selects: Position, Group, AUF, Membership. Labels in mono 10.5px, uppercase, letter-spacing .08em.
    - three checkboxes: No phone, No emergency contact, Include deactivated accounts.
    - a footer with "Clear all" (link) on the left and "Show {n} members" (primary) on the right.
  - Which filters appear still depends on what the server offers (`availableFilters`), as it does today.
  - On phones it stays the existing bottom-sheet `<dialog>`.
- **Panel toggle**: a 38×38 icon button, `ph-sidebar-simple` mirrored.
  - Open: highlighted (accent-tinted background and border). Closed: plain.
  - While closed, if there are pending requests, it shows a count badge in the top-right corner.

**3. Active-filter chips** (wrapping row, `gap: 6px`)
- Each chip is a pill: accent at 12% for the background, accent at 45% for the border.
- The filter key is shown in secondary text, then the value, then an ✕ that removes the filter.
- A "Clear" link at the end removes everything.

**4. Body**: a two-column grid, `minmax(0,1fr) 340px`. When the panel is closed it becomes `minmax(0,1fr) 0`, so the list takes the full width.

**List column**
- **Header row**: mono 10.5px, letter-spacing .06em, secondary colour. Columns: `28px | 1fr | 96px | 86px | 64px`.
  - Cells, in order: select-all checkbox | MEMBER | ROLE | POSITION | ATTEND. (right-aligned).
  - Every header except the checkbox sorts the list. The active one is shown in `--color-text` with an accent ↑/↓. Clicking it again flips the order. Attendance sorts descending first.
  - Sorting stays server-side, as today (`onSort`).
- **Rows**: same columns, `padding: 8px 20px`, 13.5px text, bottom border at 60% of `--color-border`.
  - Hover: background `--color-panel`.
  - Selected: background `--color-panel` plus a 3px accent bar on the left (`box-shadow: inset 3px 0 0 accent`).
  - Cell contents:
    - **Checkbox**: Phosphor square / check-square, 18px. Clicking it must not open the panel (`stopPropagation`).
    - **Member**:
      - 32px avatar (`MemberAvatar`).
      - Name in weight 600, then the status dots.
      - Under the name, the meta line "Country · Level" (12px, secondary).
      - Invited members show an "Invited" pill with a dashed border after the name, and "Invited {date} · not activated yet" as the meta line.
    - **Status dots** (7px circles, with a `title` tooltip):
      - `--color-danger` for *AUF expired* and *Past due*.
      - `--color-warning` for *No AUF* and *AUF expiring*.
      - These replace the text tags in the row; the full tags appear in the panel.
    - **Role**: plain text. If the member has a pending role request, a small pill "→ {requested role}" sits underneath (accent at 16%, 11px, weight 600).
    - **Position**: secondary text.
    - **Attendance**: mono 12.5px, right-aligned. Shows "No data" when there are no eligible sessions (FR-042).
  - Clicking a row selects it and opens the panel. Clicking the selected row again deselects it.
- **Legend** under the list (12px): a danger dot "Needs action" and a warning dot "Check soon".
- **Bulk bar**: replaces nothing; it appears above the header row when one or more checkboxes are ticked.
  - Style: accent at 12% over the background, accent at 45% for the bottom border.
  - Contents: "{n} selected", Email (icon), Export (icon), "Change role ▾" (opens a menu with the 4 roles), ✕ to clear.
  - Picking a role shows a confirm strip:
    - Style: warning at 9% for the background, warning at 35% for the border.
    - Text: "Change {n} member(s) to {role}?" with Cancel and **Change roles**.
  - Nothing is saved until **Change roles** is pressed.
- **Empty state** (filters return nothing):
  - Search icon at 28px.
  - "No members match these filters" (15px, weight 600).
  - "Showing {role} · {filter}. Try removing a filter." (13px, secondary).
  - A "Clear filters" button.

**Panel column** (panel background, 20px padding, 18px gap)

*State A — no member selected: "Club overview"*
- **Title**: "Club overview" (17px, weight 700) with the subtitle "Select a member to see their details or change their role."
  - A » button at the top right closes the panel.
- **Success notice**, shown after a decision: success colour at 10% for the background, success colour at 35% for the border, a check icon, and the message. Messages:
  - "{name} is now {role}."
  - "{name}'s request was rejected."
  - "{n} members are now {role}."
- **ROLE REQUESTS · {n}**: one card per request.
  - Card style: accent at 8% over the background, accent at 45% for the border, radius 8, 12px padding.
  - Card contents:
    - 32px avatar and the name, which links to that member's detail.
    - "{current role} → **{requested role}** · {date}" (12px).
    - The justification in quotes (13px, `#cfdeea`).
    - Approve (filled accent) and Reject (outlined; turns danger on hover).
  - The whole section is hidden when there are no requests.
- **AUF renewal card**: warning at 6% for the background, warning at 35% for the border.
  - Content: an identification-badge icon, "{n} AUF registrations need renewal", and a line naming each member and their AUF status.
  - Buttons: "Send reminder" (outlined in warning) and "View", which sets the AUF filter to expired/expiring.
  - After sending, the card reads "Reminder sent to {n} members · today".
- **NEEDS ATTENTION**: four rows, each a button with a coloured dot, a label and a mono count:
  - Without AUF.
  - AUF expired / expiring.
  - No emergency contact.
  - Membership past due.
  - Clicking a row toggles it as a list filter; the active row gets an accent border and tint.

*State B — member selected*
- **Header**: 52px avatar, the name (17px, weight 700, links to the full record) and the meta line. An ✕ returns to the overview.
- **Tags**: danger, warning and neutral pills, in mono 11.5px.
- **Invitation box** (invited members only):
  - Style: dashed border, 12px padding.
  - Text: "Invitation sent {date} · not accepted yet" and a "Resend invitation" button.
  - After resending, it shows "Sent again to {email}" in the success colour.
- **Role request box** (only if the member has one): the same style as the overview card, reading "Asked to be **{role}** · {date}", then the justification, then Approve and Reject.
- **ROLE**: a 4-option segmented control (Player / Coach / Committee / Admin), each option 6px tall in padding.
  - **Picking a role does not save.** A confirm strip appears with "{from} → {to}", Cancel and **Save role** (warning-tinted strip, as in the bulk bar).
  - After saving, it shows "✓ Role saved" in the success colour.
- **CONTACT**: one line each for email, phone and emergency contact, with an icon, the value and a copy icon.
  - If a value is missing, the line turns warning colour and shows an "Add" link. Visibility rules stay as in FR-090.
- **Facts grid** (2×2): ATTENDANCE (20px, bold), POSITION, AUF, MEMBERSHIP.
- **"Open full record"**: an outlined, full-width button.

### 2b — Phone (<768px), three states
1. **List**
   - Header: "Directory" (26px, bold) and two 44×44 buttons: ⋯ (more) and Invite (primary).
   - Search (44px tall) and a Filters button with a count; it opens the existing bottom sheet.
   - Role chips: horizontally scrollable pills, 9px×12px padding. Active chip: accent fill.
   - A line with "{n} members · swipe ← for actions" on the left and "Sort: Name ↑" on the right.
     - Sort opens a bottom sheet, "SORT BY": Name, Role, Position, Attendance. The active option is accent and shows its direction; tapping it again flips the order.
   - If there are requests, a banner "{n} role request(s) waiting · Review", at least 48px tall, opens the requests screen.
   - **Rows**: 40px avatar, name (15px, weight 600) with status dots, then "Role · Position" (13px), attendance in mono, and a caret.
   - **Swipe left** shows three icon-only 60px-wide actions (180px total):
     - Email: `#1c6ea4`.
     - Call: `#2e9e86`.
     - Emergency: `#bc3b2e`.
     - Missing data: background `#1a2a38`, icon `#5a7086`.
   - Swipe right or tap closes the actions. Use pointer events, a 30px threshold and `touch-action: pan-y`.
   - **⋯ menu**: a bottom sheet headed "{n} MEMBERS IN THIS VIEW", with:
     - "Email these members: Each one gets their own copy · 50/day".
     - "Export CSV: Only the columns your role can see".
     - Cancel.
2. **Role requests screen**
   - Header: a back arrow, "Role requests" and the count line.
   - One card per request:
     - 44px avatar, name and date.
     - "{current} → {requested}" as pills; the requested one in accent fill.
     - REASON with the justification.
     - Reject (outlined) and Approve (filled), both 44px tall.
   - When the list is empty: "All caught up · No requests are waiting for an answer."
3. **Member sheet**: a bottom sheet over the dimmed list. Radius 20 on the top corners, panel background.
   - A drag handle.
   - 54px avatar, name and meta line.
   - Tags.
   - **Icon-only round 48px contact buttons**: email, call, emergency. A missing value shows as a dashed warning outline.
   - The invitation box and the request box, as on desktop.
   - The ROLE segmented control, 42px tall, with the same confirm strip.
   - Attendance, AUF and Membership.
   - "Open full record" (primary, 46px tall).

## Interactions & state
- `selectedMemberId | null` drives the panel. Clicking the selected row again clears it; so do the ✕ and **Esc**.
- `panelOpen: boolean`. The toggle button flips it, and selecting a member forces it open.
- `roleDraft: {memberId, role} | null`. Saving goes through the existing role endpoint (`MemberRoleControl` / `SaveMemberRole`). Show "Role saved" after the server confirms. Remove the old inline select-plus-Save in the row entirely.
- `checkedIds: Set` drives the bulk bar. `bulkRoleDraft: role | null` must be confirmed before saving. Email and Export act on the checked members when any are checked; otherwise on the current filtered list (FR-092, FR-093).
- `sort: {key, direction}` is server-side, as today.
- Role requests: reuse `loadPendingRequests` and `submitRoleRequestDecision`. On approve, update the row's role (`onRoleGranted`) and show the success notice. Keep the double-submit guard.
- AUF reminder: **new**. It needs an endpoint and audit entry, like the directory email.
- Resend invitation: reuse `InvitationResend`.
- Filters stay in the URL (FR-091).
- Every icon-only button needs `aria-label` and `title`.
- Focus: `:focus-visible` outline 2px accent.

## Design tokens (from `src/app/globals.css`, dark theme)
- `--color-background` `#0c1a26`
- `--color-panel` `#13283a`
- `--color-border` `#274055`
- `--color-text` `#e8f0f7`
- `--color-text-secondary` `#8aa1b5`
- `--color-accent` `#33a1e0`
- `--color-on-accent` `#0c1a26`
- `--color-success` `#6fd6b4`
- `--color-warning` `#f2ce78`
- `--color-danger` `#f2887a`
- Sidebar: `#163a55` / hover `#1d4869`; the avatar background uses `#1d4869`.
- Values used in the mocks that are not tokens yet:
  - hover `#1a3349`
  - light accent text `#cfe8f7`
  - soft text `#cfdeea`
  - accent hover `#5ab4e8`
  - Consider adding these as variables.
- Tints are made with `color-mix(in srgb, <token> N%, transparent)`, using the percentages given above.
- Radii: 8 (controls, cards), 6 (inner segmented/menu items), 10 (popover), 20 (sheet top), 999 (pills).
- Shadow: `--shadow`.
- Light theme: apply the same layout with the light-theme tokens; the mocks only show dark.

## Assets
- Icons: Phosphor (regular + fill). Names used:
  - magnifying-glass, funnel-simple, sidebar-simple, envelope-simple, download-simple, user-plus
  - user-switch, x, caret-down, caret-right, caret-double-right, arrow-right, arrow-left
  - check, check-circle, copy, phone, first-aid, identification-badge, paper-plane-tilt
  - hand, sort-ascending, dots-three-vertical
  - square, check-square, minus-square
- Swap these for whatever icon set the app already uses, if it uses a different one.
- No images. The club logo is a placeholder.

## Screenshots (`screenshots/`)
1. `01-desktop-overview-with-requests.png`: the default view. No member is selected; the panel shows Club overview with the role requests, the AUF card and Needs attention.
2. `02-desktop-member-selected-role-confirm.png`: a member is selected and has a pending request. A new role has been picked and the Save-role confirm strip is showing.
3. `03-desktop-bulk-selection-confirm.png`: three members are checked. The bulk bar and the "Change 3 members to Coach?" confirm are showing.
4. `04-desktop-panel-closed-filters-open.png`: the panel is collapsed, so the list is full width, and the Filters popover is open.
5. `05-desktop-empty-state.png`: the filters return no members.
6. `06-desktop-invited-member.png`: an invited member who hasn't activated yet is selected; the panel shows "Resend invitation".
7. `07-mobile-list-requests-member-sheet.png`: phone list with one row swiped, the role-requests screen, and the member sheet.
8. `08-mobile-sort-sheet.png`: the sort bottom sheet.
9. `09-mobile-more-menu-email-export.png`: the ⋯ sheet with Email and Export CSV.

The screenshots show the sample data. The behaviour described in this README takes precedence over them.

## Files
- `Directory Upgrade.dc.html`: the interactive mock. Build section **2** (`#2a`, `#2b`). Its logic class at the bottom shows every state transition.
- `support.js`: the runtime the mock needs to open in a browser.
