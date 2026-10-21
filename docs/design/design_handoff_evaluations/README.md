# Handoff: Evaluations redesign

## Overview
This redesigns `src/components/evaluations/*` in `cjgomezr/sea-dragons-web`:
- `EvaluationsScreen`, `EvaluationRoster`, `EvaluationSheet`, `EvaluationRatings`;
- `EvaluationCategoriesScreen`, `EvaluationCategoryItems`, `CategoryNameForm`.

**Problems today**
- The roster is a plain list of names on the left, which doesn't scale past a handful of players.
- Categories live on a separate page, with big cards and Up/Down buttons.

**New design**
1. **Players as a table**, with search, a "Not evaluated" filter, a position filter and sorting.
2. **A side panel.** With no player selected, it shows a **squad overview**. With one selected, it shows that player's sheet, with ‹ › to step through the filtered list and **Save & next**.
3. **Categories become a tab** inside Evaluations: compact one-line rows, **drag and drop** to reorder (↑/↓ on the keyboard), inline rename, and an add row at the bottom.

## What to build
In `Evaluations Upgrade.dc.html`:
- **`#1a`**: desktop, with the Players and Categories tabs.
- **`#2a`**: mobile players, the list and then a full-screen sheet.
- **`#2b`**: mobile categories.

The mock's data is invented: 24 players, 5 of them not evaluated.

## About the design files
These are HTML design references, not production code. Rebuild them in the existing app and keep:
- **Data and rules:** the roster loader and `compareNames` ordering, `RATING_MIN`/`RATING_MAX` (1–10), the default rating of 5 for new evaluations, the conflict handling, and the existing category API clients (create, rename, reorder, deactivate, reactivate).
- **Roles:** the same as today. Admin and Coach can evaluate; categories are Admin-only if that's the current rule.
- **i18n** in both `en.ts` and `es.ts`.

## Fidelity
The mock is high fidelity, built on the app's dark tokens (not Nocturne). Use CSS variables; the light theme should follow the same layout with the light tokens.

## Desktop `#1a`
**Header**
- H1 "Evaluations" (28px), with the lead "Rate players by category. Their overall (OVR) is the average, and Teams uses it to balance."
- **Tabs**: Players (`users`, with a count) and Categories (`list-numbers`, with a count). The active tab has a 2px accent underline. Use `role="tablist"`, and keep the open tab in the URL (`?tab=categories`).
- A **success notice** (`role="status"`) under the tabs after any save. It disappears after about 3 seconds.

### Tab: Players
**Toolbar**
- A **Search** field (38px, magnifier icon). It ignores accents and capitals; reuse the directory's normaliser.
- **Chips**: **All · n** and **Not evaluated · n** (with a warning dot). The active chip has a `#1d4869` background and an accent border.
- **Position** select (All positions plus the club's positions).
- **Sort** select: Name A–Z (default) · OVR high → low · OVR low → high · Oldest evaluation first. Players without an evaluation sort last for OVR and first for "oldest".
- Keep the filters and sort in the URL.

**Layout**: a grid `1fr | 400px`. The panel is sticky at the top.

**Table**
- Bordered, radius 12.
- **Header row** (36px, `#0f2131`, mono 11px): (avatar) · PLAYER · OVR (right-aligned) · UPDATED (right-aligned).
- **Rows**: a `<button>` with the grid `40px | 1fr | 60px | 92px`, at least 52px tall.
  - A 36px avatar (photo, or initials).
  - The name (14.5px, 600, ellipsis) with the position (12.5px, secondary) underneath.
  - OVR: mono, 15px, bold. "—" in muted when not rated.
  - Updated: the date in secondary, or **"Not evaluated" in warning**.
- **Selected row**: a `#16304a` background, an inset 3px accent bar on the left, and `aria-current`. Clicking the selected row again **closes the panel** and goes back to the overview.
- Hover: `#16304a`.
- The list area scrolls on its own, with `max-height` set to about 560px. With many players, virtualise it or page it.
- **Footer** (`#0f2131`): "{n} of {m} players" and "OVR = average of active categories".
- **Empty state**: "No players match." with a **Clear filters** link.

> The earlier per-category bar column was **dropped on purpose**. It was hard to read and didn't scale with many categories. Don't add it back.

**Panel: no player selected (squad overview)**
- **SQUAD OVERVIEW**:
  - "{done} of {total} players evaluated" (30px mono figure) and an 8px progress bar.
  - A primary **"Evaluate the {n} pending"** button. It sets the filter to Not evaluated, clears the search and position, sorts by name, selects the first player and opens their sheet in edit mode.
  - When everyone is done: "✓ Everyone has an evaluation." in success.
- **SQUAD AVERAGE BY CATEGORY**, plus the overall average OVR on the right:
  - one row per active category: the name, a 6px bar (`value × 10%`) and the value;
  - the **lowest category's bar is in warning**;
  - under it: "Lowest: **{category}** — something to work on in training."
- **LONGEST WITHOUT REVIEW**: the 3 evaluated players with the oldest update. Each is a 38px row with the name, the date and a caret; clicking it opens that player.

**Panel: player selected**
- **Top bar**: "{i} of {n} in this list" (or "Not in the current filter"), then 32px buttons for **× close**, **‹ previous** and **› next**. Previous and next are disabled at the ends.
- **Identity**: a 56px avatar, the name (19px, 700), and "position · Profile link". On the right, the **live OVR** (30px mono). It recalculates while you edit.
- **Not evaluated**: a dashed box with "{first name} hasn't been evaluated yet", "Every category starts at 5. Until then, Teams counts them as 5." and a primary **Start evaluation** button, which opens edit mode with every category at 5.
- **RATINGS · 1–10**: one row per active category, in the Categories order. Each row is a grid `104px | 1fr | 28px`, at least 38px tall.
  - **Read mode**: the name, a 6px accent bar, and the value. A category added after this evaluation shows "new · not rated" in warning with "—", and doesn't count in the OVR.
  - **Edit mode**: the panel border turns accent; each row gets a native range input (1–10, step 1) with a label `for` it, and the value updates live.
- **Footer**
  - Read mode: "Updated {date} by {evaluator}" and **Edit ratings** (secondary).
  - Edit mode: **Cancel** (ghost), **Save** (secondary) and **Save & next ›** (primary).
    - Save & next saves, then moves to the next player in the filtered list, already in edit mode.
    - It's disabled on the last player.

### Tab: Categories
- Max width 680px.
- Lead: "The order here is the order on every evaluation. Deactivating hides a category from new ratings; old scores are kept."
- **Table** (bordered, radius 12):
  - **Header row** (34px, `#0f2131`): (handle) · # · CATEGORY · (actions).
  - **Rows**: the grid `36px | 28px | 1fr | 84px`, at least 46px tall.
    - **⋮⋮ handle**: a 30px button, `aria-label="Reorder {name}, position {i} of {n}"`, with the title "Drag, or use ↑ ↓".
    - **Rank** (mono).
    - **Name** (14.5px, 600).
    - **Rename** (`pencil-simple`) and **Deactivate** (`eye-slash`, danger on hover).
  - **Rename inline**: the name becomes a 32px input with an accent border, and the actions become ✓ (primary) and ×. **Enter** saves and **Esc** cancels.
  - **Drag and drop**:
    - The dragged row drops to 45% opacity, and a 2px accent line marks where it will land.
    - Dropping saves the new order right away, shows "{name} moved to {i} of {n} · saved" and announces it.
    - **Keyboard**: with the handle focused, ↑/↓ move the row one place, and focus stays on the handle.
    - Use **dnd-kit** (`@dnd-kit/sortable`), as in the club settings handoff.
  - **Remove the Up/Down buttons.**
- **Add row**: the last row, with a `#0f2131` background.
  - A + icon, the input "New category, e.g. Speed" (34px, max 40 characters) and **Add** (primary). Add is disabled while the field is empty or the name is a duplicate. Enter adds.
  - **Duplicate check**: case- and accent-insensitive, against both active and deactivated categories. The error reads "There is already a category with that name." with a danger border.
  - After adding: "{name} added · it shows as "not rated" on existing evaluations".
- **Deactivated · n**: a collapsible list with the hint "— hidden from new ratings, kept on old ones". Each row has the name and **Reactivate**, which adds the category back at the end.

## Mobile
Touch targets are at least 44px, and inputs use 16px text.

**`#2a` Players**
- **List screen**:
  - the title "Evaluations" (24px);
  - search (46px);
  - chips (36px, scrolling sideways) plus a compact sort select;
  - rows at least 64px tall: a 40px avatar, the name (up to 2 lines), "position · date / Not evaluated" (warning), the OVR (16px mono) and a caret.
- **Tapping a row** opens a **full-screen sheet**:
  - **Top bar**: back (44px), "{i} of {n} in this list", and 44px **↑ / ↓** buttons for the previous and next player.
  - **Identity**: a 60px avatar, the name and the live OVR.
  - **Ratings card**, one block per category: the name and value, then, in edit mode, **− [range] +**, with 44px − and + buttons.
  - **Sticky footer**:
    - read mode: **Edit ratings** (48px);
    - edit mode: **Cancel** and **Save & next** (48px), which reads **Save** on the last player.
- The squad overview isn't shown on mobile for now. Optionally, show it as a card above the list.

**`#2b` Categories**
- The hint "Hold ⋮⋮ and drag to reorder. Tap to rename."
- A card with rows at least 58px tall: a 44px handle, the rank, the name and a caret.
- **Tap** opens a **bottom sheet** (radius 20) with the **Name** field (48px), **Deactivate** (outlined, danger) and **Save** (primary), each 48px tall.
- **Add**: a 48px input with **Add** next to it, and the same duplicate error.
- **Deactivated** list: rows at least 56px tall, with Reactivate buttons.
- **Touch drag**: use dnd-kit's TouchSensor or PointerSensor with a long press of about 150 ms, and `touch-action: none` on the handle.

## Data / API
- **Roster**: each player needs `overall` (the average of the active categories, or null), `updatedAt`, `updatedBy`, and `positionName`. If the roster doesn't return `updatedAt` yet, add it. It's needed for the "Updated" column, the "Not evaluated" state and the "Oldest evaluation first" sort.
- **Squad averages**: compute them on the client from the roster, using each player's ratings, or add a small `GET /evaluations/summary` that returns `{ evaluated, total, categoryAverages[], overallAverage }`. Prefer the server endpoint once there are many players.
- **Categories**: no change. Reorder sends the full order; rename, deactivate and reactivate use the existing calls.

## Copy / i18n (new or changed)
- Tabs: "Players", "Categories".
- Filters: "Search by name", "All", "Not evaluated", "All positions".
- Sort options: "Name A–Z", "OVR high → low", "OVR low → high", "Oldest evaluation first".
- Table: "{n} of {m} players", "OVR = average of active categories", "No players match.", "Clear filters".
- Overview:
  - "SQUAD OVERVIEW", "{done} of {total} players evaluated", "Evaluate the {n} pending", "Everyone has an evaluation."
  - "SQUAD AVERAGE BY CATEGORY", "Lowest: {category} — something to work on in training."
  - "LONGEST WITHOUT REVIEW".
- Player sheet:
  - "{i} of {n} in this list", "Not in the current filter".
  - "{name} hasn't been evaluated yet", "Every category starts at 5. Until then, Teams counts them as 5.", "Start evaluation".
  - "RATINGS · 1–10", "new · not rated", "Updated {date} by {name}", "Edit ratings".
  - "Save & next", "{name} saved".
- Categories:
  - "The order here is the order on every evaluation…", "Drag, or use ↑ ↓", "Hold ⋮⋮ and drag to reorder. Tap to rename."
  - "New category, e.g. Speed", "There is already a category with that name.", "{name} added · it shows as "not rated" on existing evaluations".
  - "{name} moved to {i} of {n} · saved", "{name} deactivated · old scores kept", "{name} reactivated · added at the end".
  - "Deactivated · {n}", "— hidden from new ratings, kept on old ones", "Reactivate".
- Remove the move up / move down button labels. Keep the move announcements for screen readers.

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
  - table header and add row `#0f2131`
  - row line `#22394d`
  - hover and selected row `#16304a`
  - icon-button hover `#1a3349`
  - muted `#5a7086`
  - active chip `#1d4869`
- Radii: 7, 8, 10, 12, 20, 999.
- Focus: 2px accent outline.
- Icons: Phosphor.

## Screenshots (`screenshots/`)
1. `01-desktop-overview.png`: Players tab, nothing selected, with the squad overview.
2. `02-desktop-player.png`: a player selected, read mode.
3. `03-desktop-editing.png`: a player in edit mode, with Save & next.
4. `04-desktop-categories.png`: the Categories tab.
5. `05-mobile-list.png`: the mobile players list.
6. `06-mobile-player-editing.png`: the mobile player sheet in edit mode.
7. `07-mobile-categories.png`: mobile categories.

Photos may appear blank in the screenshots. When a screenshot and this text disagree, follow the text.

## Files
- `Evaluations Upgrade.dc.html`: the interactive mock.
- `support.js`: needed to open the mock.
