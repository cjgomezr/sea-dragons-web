# Handoff: Groups redesign

## Overview
This redesigns `src/components/groups/*` in `cjgomezr/sea-dragons-web`: `GroupsScreen`, `GroupList`, `GroupMembersPanel` and `GroupNameForm`.

**Today**
- A tall list of group cards with text buttons for Rename and Delete.
- Members are added **one at a time** from a `<select>`.
- Nothing shows where a group is used.

**New design**
1. A **compact list** on the left and the **group panel** on the right (master–detail). On mobile, the list leads to a group screen.
2. **Add several members at once**, with a search field and checkboxes.
3. **"Audience of"**: the events and news posts that use this group as their audience. Deleting a group warns about what it affects.
4. **Shortcuts**: Email all, Open in directory (filtered), Rename, Delete.

## What to build
In `Groups Upgrade.dc.html`:
- **`#1a`** is desktop and **`#2a`** is mobile (under 768px).

The data is invented.

## About the design files
These are HTML design references, not production code. Rebuild them in the existing app and keep:
- **Rules and API:** `normalizeGroupName` (1–60 characters, no control characters), the name-taken and not-found errors, the `groups-client` calls (create, rename, delete, roster, assign, remove), `isGroupGone` handling, `usePendingAction` (one action in flight at a time) and `compareNames` ordering.
- **Counting:** the existing count rule. Members who haven't activated their account stay assigned but don't count.
- **Access:** Admin, Coach and Committee (`manageGroups`).
- **i18n** in both `en.ts` and `es.ts`.

## Fidelity
The mock is high fidelity, built on the app's dark tokens (not Nocturne). Use CSS variables; the light theme should follow the same layout with the light tokens.

## Desktop `#1a`
**Header**
- H1 "Groups" (28px), with the lead "Groups are audiences: pick them when you create an event or a news post, and only their members see it."
- A success notice (`role="status"`) after any change. It disappears after about 3 seconds.

**Layout**: a grid `340px | 1fr`.

**Left column**
- **Create row**: the input "New group name" (38px, max 60 characters) and a primary **+ Create** button. Enter creates.
  - Duplicate check: case- and accent-insensitive. The error reads "There is already a group with that name." with a danger border. The server's `name_taken` is the final word.
  - After creating, the new group is **selected and its member picker opens**.
- **List** (bordered, radius 12):
  - Header (34px, `#0f2131`, mono): "{n} GROUPS" and "MEMBERS".
  - **Rows**: a `<button>` at least 54px tall.
    - The name (14.5px, 600, ellipsis), with the usage under it (12px, secondary): "2 events · 1 post" or "Not used yet".
    - Up to 3 overlapping 24px **avatars** (photo, or initials).
    - The **count** (mono, bold).
  - **Selected**: a `#16304a` background, an inset 3px accent bar, and `aria-current`. Clicking it again deselects.
  - Sort: alphabetical, as today.
  - Empty state: "No groups yet. Create the first one above."

**Right column: the group panel** (panel background, radius 12)
- **Header**:
  - the name (H2, 21px, 700);
  - the summary (13px, secondary): "{n} members · {k} not activated · {usage}" (the middle part only when k > 0);
  - four 38px icon buttons:
    - **Email all** (`envelope-simple`): a `mailto:` link to the club address, with every member's email in **BCC**. No extra service is needed. Skip members without an email.
    - **Open in directory** (`address-book`): goes to `/directorio?group={id}` (see "Directory filter" below).
    - **Rename** (`pencil-simple`): the title turns into an input (38px, accent border) with ✓ and ×. Enter saves, Esc cancels.
    - **Delete** (`trash`, danger).
- **Delete confirm** (inline, danger tint):
  - "Delete "{name}"?"
  - With usage: "Members stay in the club, but {n events} and {m news posts} will lose this audience. If that was their only group, nobody but Admins will see them."
  - Without usage: "Its {n} members stay in the club. It isn't the audience of anything."
  - **Cancel** and an outlined **Delete group** button in danger red.
- **Body**: a grid `1fr | 260px` with a rule between the two columns.
  - **Members column**
    - **Toolbar**: "Search in this group" (36px, accent- and case-insensitive) and an **Add members** button (`user-plus`, accent text). While the picker is open, the button gets a `#1d4869` background and an accent border.
    - **Picker** (inline, accent border, radius 10):
      - the search "Search members not in this group";
      - up to about 220px of scrolling rows, each at least 42px tall: a checkbox, a 28px avatar, the name, and "position · in {n} groups";
      - a footer (`#0f2131`) with "{n} selected" (or "{m} members not in this group"), **Cancel**, and a primary **Add {n} members** button, disabled while nothing is picked.
      - Empty states: "Everyone in the club is already in this group." and "No one matches."
      - **API**: add a bulk assign call (`POST /groups/{id}/members` with `{ userIds: [] }`). Until it exists, call the existing assign endpoint for each person, one after another, and report partial failures.
    - **Member rows**: the grid `34px | 1fr | auto | 34px`, at least 48px tall: a 32px avatar, the name (14px, 600), the position (12px, secondary), a **"Not activated"** pill (warning tint) when it applies, and a 32px **×** remove button (danger on hover), `aria-label="Remove {name} from {group}"`.
      - Removing happens right away, with a notice. No confirm step: re-adding is easy.
    - The list scrolls on its own (about 440px max).
    - Empty states: "No members yet. Use "Add members" to pick several at once." and "No one in this group matches."
  - **AUDIENCE OF column**
    - A mono label, then one row per item: a 30px tile (event: `calendar-blank` on an accent tint; news: `newspaper` on a success tint), the title (13.5px, 600, ellipsis) and the meta line (12px, secondary). Event meta looks like "Weekly · Wed 6 pm" or "Sat 24 Oct"; news meta looks like "Posted 12 Oct".
    - Each row links to the event or the post.
    - Show only **upcoming** one-off events, **active** weekly series and **published** posts. Cap it at 5 rows plus "+ {n} more".
    - Empty: "Not used yet. Pick it as the audience when you create an event or a news post."
- **No group selected**: a dashed box with "Pick a group to see and manage its members."

## Mobile `#2a`
Touch targets are at least 44px, and inputs use 16px text.

**List screen**
- Title "Groups" (24px).
- The create row: a 46px input and a 46px **+** button.
- Rows at least 66px tall: the name (15.5px, 600), "{n} members · {usage}", 3 avatars (26px) and a caret.

**Group screen**
- **Top bar**: back, the name, and **⋯**.
- The summary line.
- Two 46px buttons side by side: **Email all** and **Directory**.
- The **AUDIENCE OF** card: rows at least 44px tall, each with a caret.
- Search (46px).
- The members card: rows at least 60px tall with a 38px avatar, the name (up to 2 lines), "position" (or "position · not activated" in warning), and a 44px ×.
- A **sticky "Add members" button** (50px, primary) at the bottom.
- **Add members** opens a **full-screen picker**: Cancel and "Add to {group}" at the top, search (46px), rows at least 58px tall with 22px checkboxes, and a sticky **Add {n} members** button (50px) at the bottom.
- **⋯ bottom sheet**:
  - **Rename group**, which becomes an inline 48px input with **Save**;
  - a rule, then **Delete group** (danger), which switches the sheet to the same warning text with **Cancel** and **Delete** buttons (48px).

## Data / API changes
- **Group list**: add `usage: { events: number, posts: number }` and `previewMembers` (the first 3, each `{ id, fullName, photoUrl }`) to each group in `GET /groups`, or return them from a light summary endpoint.
- **Group detail**: add `GET /groups/{id}/audience`, which returns:
  - `events`: `{ id, title, startsOn | weekdays, startTime }[]` (one-off and series rows, using `event_groups` and `event_series_groups`; upcoming or active only);
  - `posts`: `{ id, title, publishedAt }[]` (`news_post_groups`; published only).
- **Bulk assign**: `POST /groups/{id}/members` with `{ userIds: string[] }`. It returns the updated roster and the candidate list. It must be idempotent for people who are already members.
- **Roster rows**: add `positionName` and `photoUrl` to the group members and the candidates, and the number of groups each candidate is already in (for "in {n} groups").
- **Directory filter (new)**: `/directorio?group={id}` filters the directory to that group and shows a "Group: {name} ×" chip next to the other filters. It needs a `group` query parameter on the directory endpoint.

## Copy / i18n (new or changed)
- Header: "Groups are audiences: …" (the lead).
- Create: "New group name", "Create", "There is already a group with that name.", "{name} created · now add its members".
- List: "{n} GROUPS", "MEMBERS", "{n} events", "{n} posts", "Not used yet".
- Summary: "{n} members", "{k} not activated", "Not activated".
- Actions: "Email the group", "Open in directory", "Rename", "Delete", "Group renamed".
- Delete confirm: "Delete "{name}"?", both warning texts, "Delete group", "{name} deleted".
- Members: "Search in this group", "Add members", "Search members not in this group", "{n} selected", "{m} members not in this group", "Add {n} members", "{n} members added to {group}", "in {n} groups".
- Member rows: "Remove {name} from {group}", "{name} removed from {group}".
- Empty states: "Everyone in the club is already in this group.", "No one matches.", "No members yet. …", "No one in this group matches.".
- Audience: "AUDIENCE OF", "Not used yet. Pick it as the audience…", "+ {n} more".
- Mobile: "Add to {group}", "Email all", "Directory", "Rename group", "Delete group".
- Remove the old text buttons ("Rename", "Delete", "Close") and the single-select "Add" picker labels.

## Tokens
- Core colours:
  - background `#0c1a26`
  - panel `#13283a`
  - border `#274055`
  - text `#e8f0f7`
  - secondary `#8aa1b5`
  - soft `#cfdeea`
  - accent `#33a1e0`, accent text `#5ab4e8`
  - success `#6fd6b4`
  - warning `#f2ce78`
  - danger `#f2887a`
- Values used here that aren't tokens yet:
  - table header and picker footer `#0f2131`
  - row line `#22394d`
  - hover and selected row `#16304a`
  - icon hover `#1a3349`
  - muted `#5a7086`
  - active button `#1d4869`
- Radii: 7, 8, 9, 10, 12, 20, 999.
- Focus: 2px accent outline.
- Icons: Phosphor.

## Screenshots (`screenshots/`)
1. `01-desktop-group.png`: a group selected (members and Audience of).
2. `02-desktop-add-members.png`: the picker open with 3 people checked.
3. `03-desktop-delete-warning.png`: the delete warning, with usage.
4. `04-mobile-list.png`
5. `05-mobile-group.png`
6. `06-mobile-add-members.png`
7. `07-mobile-actions.png`: the ⋯ sheet.

Photos may appear blank in the screenshots. When a screenshot and this text disagree, follow the text.

## Files
- `Groups Upgrade.dc.html`: the interactive mock.
- `support.js`: needed to open the mock.
