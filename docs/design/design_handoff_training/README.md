# Handoff: Training v1 (routines + cycles)

> **This replaces `design_handoff_training`** (the full macrocycle version). Don't build that one; use it only as a reference for later versions.
>
> Also read **`DATA_MODEL.md`** (tables, RLS, RPCs) and **`EXCEL_TEMPLATE.md`** (the downloadable template and its import).

## 1. Goal and scope
A **simple, sport-agnostic** Training section for `cjgomezr/sea-dragons-web`:
- **Coaches and admins** build **routines** (lists of exercises) and lay them out on a **cycle**: a grid of weeks × days that counts down to an optional target event. They can do it in the app or with an Excel template.
- **Members with an active membership** see this week, the day's routine, how to do each exercise (photos, tips, YouTube), and **their own kilos**, calculated from their private **marks**.

**In v1**
- Routines, cycles (several cycles; one active), shared routines.
- An exercise library (free-exercise-db) plus the club's own exercises.
- Club-defined marks (best single lift, kg), with private member values and "% of mark" loads.
- Excel template download and import.
- The membership gate.

**Not in v1 (don't build)**
- Calculated time targets (PB + n).
- Heart-rate zones.
- Estimating 1RM from 3RM.
- Automatic session rotation.
- Sport presets or fixed session types (gym / pool / other).
- Routine colour picking: the colour is assigned automatically.
- Per-member progress tracking or logging.

## 2. Files
| File | What it is |
| --- | --- |
| `Training v1.dc.html` | The interactive mock. Open it in a browser with `support.js` next to it. All frames share state, so a change in one shows in the others. |
| `training-img/` | 58 sample photos from free-exercise-db, used by the mock only. |
| `screenshots/` | One PNG per screen and state (see §9). |
| `DATA_MODEL.md` | Tables, RLS, RPCs and seed data. |
| `EXCEL_TEMPLATE.md` | The exact template layout, locking, validation and import rules. |

The mock is a design reference in HTML, not production code. Rebuild it with the app's existing patterns:
- Next.js and Supabase;
- RLS, with writes through `security definer` RPCs and every write recorded in `audit_log`;
- i18n in both `en.ts` and `es.ts`;
- the tokens in `globals.css`. The mock's hex values map to the existing dark tokens; use the CSS variables, not the hex values.

**Frame IDs in the mock**
- Desktop: `1a` member · `1b` coach/admin · `1c` expired membership.
- Mobile: `2a` member · `2b` coach/admin · `2c` expired membership.

The "Probar con 3 / 10 marcas" switch at the top only exists to preview a club with many marks.

## 3. Navigation and access
- A new nav item **Training** (`ph-barbell`), visible to every signed-in member.
- **Member view** (`/training`): needs `membership.status = 'active'` or a waiver.
  - Without one, show the locked screen (`1c` / `2c`).
  - Enforce access in RLS too, not only in the UI.
- **Manage view** (`/training/manage`): Admins and Coaches. Add a "Plan training" entry for them in the Training header, or in the nav.
- Coaches and Admins with an active membership also see the member view.

## 4. Member screens

### 4.1 Desktop `1a`
**Header**
- An eyebrow `TRAINING`, then the H1 with the active cycle's name.
- A trophy icon and "{event} · {Thu 22 Apr 2027}". Without an event: "Ends {date}".
- On the right, a countdown: "{weeks to go}" (30px mono) with "week {k} of {N}" under it. Before the cycle starts: "starts {date}". After it ends: "cycle finished".

**Week strip**
- One 34px button per week, flexed to fill the row, labelled with the week number (mono).
- The current week has a `NOW` pill above it. The selected week has a `#1d4869` fill and an accent border. Past weeks drop to 50% opacity.
- The event week's label is in warning colour, with a border at 55% warning.

**Layout**: a grid `1fr | 520px`. Both columns start at the top. On the real page the right panel can be `position: sticky`, but it must start aligned with the left column.

**Left column**
- **Week navigation**: ‹ › buttons (32px) and "Week {k} of {N}" with "{Mon date} – {Sun date}". When browsing another week, a "Back to this week" link appears.
- **7 day rows**, at least 56px tall, with the grid `4px colour bar | 64px day | 36px icon tile | title + subtitle | TODAY pill + caret`.
  - **Routine day**: the routine name and "{n} exercises", a solid border.
  - **Rest day**: "Rest" and "Nothing planned", a dashed border, muted text.
  - **Event days** (the last week, from the event date on): a trophy icon, the event name and "Event day".
  - The selected row gets a `#16304a` fill and an accent border. By default the selected day is today (when today has a routine), otherwise the first day of the week with a routine.
- **My marks card**:
  - title "My marks", "{n} of {m} set" (mono), and "🔒 Only you see these";
  - one line: "Your best single lift (1RM). Routines with "% of" use it to show your kilos.";
  - the fields sit in an auto-fill grid with columns at least 170px wide. Each field has a label and a 38px input (mono, right-aligned, decimal) followed by "kg".
  - **More than 4 marks**: show only the marks used by this week's routines (each with a "this week" pill), plus a "Show all {m} marks" / "Show only this week's marks" toggle. If no routine this week uses a mark, show the first 3.

**Right panel**: the day's routine.
- A 4px bar in the routine colour, a 42px icon tile, the routine name (18px, 700) and "{Weekday} {date} · {n} exercises".
- **Exercise rows** (buttons, at least 60px tall, `aria-expanded`), with the grid `48px thumbnail | name + dose | load | caret`.
  - **Thumbnail**: the exercise's start photo; without a photo, the generic `ph-person-simple-run` icon on `#0f2131`.
  - **Dose** (mono): "{sets} × {reps}", or just "{reps}" when there are no sets, then " · rest {rest}" in secondary. The note appears under it when there is one.
  - **Load** (right column; see §6.3): "60 kg" with "75% of back squat 80" under it; or a text load such as "Bodyweight"; or, in warning colour, "75%" with "of back squat · add your mark".
- **Expanded row**:
  - if the load is "% of" a mark: a warning-tinted inline field "Your {mark} best lift [___] kg". Typing in it saves the mark and the kilos update live.
  - **2 photos** side by side (4:3), with mono "START" and "END" captions;
  - **tips** as a list, when there are any;
  - **Watch on YouTube**: the exercise's link, or `https://www.youtube.com/results?search_query={encoded query}`, opened in a new tab.
- **Missing mark**: under the list, "Open the row to add your {mark}, or use My marks." in warning.
- **Rest day**: a moon icon with "Rest day / Nothing planned. Recover well."
- **Event day**: "{Event} / Good luck out there."

### 4.2 Mobile `2a`
- **Header**: the eyebrow, the cycle name (21px), and "{n} weeks to go · week {k} of {N}".
- **Week navigation**: 44px ‹ › buttons, with "Week {k}" and the date range between them.
- **7 day pills** (56px tall, one grid row): the day initial, the date number, and a 7px dot in the routine colour. Today's initial is in accent; the selected day has a `#1d4869` fill.
- **The day's routine** (the content scrolls): a 44px icon tile, the name (18px) and the meta line, then the exercise cards. Exercise rows are at least 64px tall, with a 48px thumbnail.
- **Expanded row**: the inline mark field (44px input, 16px text), 2 photos, tips, and a full-width 44px "Watch on YouTube" button.
- **My marks card** at the end: rows at least 48px tall, each with the mark name (and "In this week's routines" when that applies) and a 44px input with "kg". The same "Show all" toggle as desktop.

### 4.3 Expired membership `1c` / `2c`
- The cycle header stays visible.
- **Lock card**:
  - a 44px warning-tinted lock icon;
  - "Renew to see your plan";
  - "Training is for members with an active membership. Yours expired on {date}. Renew and you'll pick up the cycle where the club is now.";
  - a primary **Renew membership** button (46px on desktop, 48px on mobile), linking to Payments.

## 5. Coach / admin screens

### 5.1 Desktop `1b`
- **Header**: `TRAINING · MANAGE`, the H1 "Plan training", and "Members with an active membership see it." on the right.
- **Tabs** (`role="tablist"`, no wrapping): **Cycle** ({N} wk) · **Routines** ({n}) · **Exercises** ({n}) · **Marks** ({n}). The active tab has a 2px accent underline.
- **Success notices**: a green-tinted strip with `role="status"`, which clears after about 3 seconds.

#### Tab Cycle
- **Cycle cards**: one row that scrolls sideways; cards don't wrap.
  - Each card is 270px wide: the name (ellipsis), a status pill (**Active** success, **Draft** warning, **Archived** neutral), and "{N} weeks · {start} – {end} · {n} routines".
  - The selected card has a `#16304a` fill and an accent border.
  - Then a dashed **+ New cycle** card (150px).
  - Archived cycles are hidden behind a "Show archived · {n}" toggle. The selected cycle always stays visible.
- **Action strip** (`#0f2131`): "Editing **{name}**", then:
  - **Make active**: drafts only, success outline. It archives the previous active cycle.
  - **Duplicate**: copies the cycle as a draft named "{name} (copy)", together with **its own routines** (new IDs) and the grid remapped to the copies. Shared routines aren't copied. The notice reads: "Duplicated as a draft · rename it and set the dates · {n} routines copied".
  - **Archive**: hidden for archived cycles.
- **Fields**: Cycle name · Target event (optional) · Event first day (date) · Weeks (1–52).
- **Calculated line**:
  - Active: "Week 1 starts Mon {date} · week {N} is event week. Members are in week {k} today."
  - Draft: "Week 1 would start Mon {date} · draft: members don't see it until you make it active."
  - Archived: "Ran {start} – {end} · archived. Duplicate it to reuse it."
- **Date rule**: week 1 starts on the Monday of the event week minus (N − 1) weeks. Without an event, ask for a start date instead, and the cycle ends after N weeks.
- **Grid**: a sticky header `WK | DATES | MON … SUN`, then one row per week (scrolling, max height about 460px).
  - Each cell is a 32px `<select>`: "Rest", then the routines of **this cycle plus the shared ones** (shared ones end with "(shared)").
  - A cell with a routine gets a 20% tint of the routine colour and a border at 45% of it. Rest cells are muted.
  - The current week's row is tinted (active cycle only). The last week's number is in warning colour.
  - Changes save immediately.
- **Copy week 1 to all weeks**: copies row 1 into weeks 2 to N − 2 and leaves the last 2 weeks untouched (taper and event week).
- **Excel panel** (330px, right): see `EXCEL_TEMPLATE.md`.
  - **Download template**, with a note: "{n} exercises · {n} routines · {n} marks in its lists".
  - A list of the 5 sheets with an icon and one line each.
  - **Upload filled template**: opens the import review.

#### Tab Routines
- **Filter row**: "Routines of [select]" (no wrapping), then the hint "A cycle shows its own routines plus the shared ones."
  - Options: the active and draft cycles ("{name} · active" / "· draft"), then **Shared routines only**, then an optgroup **Archived cycles**.
  - There is **no "All" option**.
- **Left column (300px)**: routine buttons, at least 54px tall, each with a colour tile, the name, and "{n} exercises · used {k}×" (counted across all cycles). Shared routines show a "Shared" tag and are listed last.
  - **+ New routine in this cycle** / **+ New shared routine** (dashed). The routine colour is assigned automatically: `palette[count % 6]`.
- **Right column: the editor.** It only shows a routine that's in the filtered list; otherwise it falls back to the first one. When the list is empty: "No routines here yet / Create one, or import the Excel template for this cycle."
  - **Routine name** (40px, 15px weight 600). That's the only routine-level field: no type, no colour, no "belongs to".
  - **Exercise table**, with columns `drag | EXERCISE | SETS | REPS / DIST. | REST | LOAD | delete`:
    - **Drag handle** (`ph-dots-six-vertical`) to reorder. Use dnd-kit, as in the other handoffs. The keyboard alternative is ↑ / ↓ on the focused handle.
    - **Exercise**: a 36px thumbnail, the name, and an inline "Note (optional)" input under it.
    - **Sets**: digits only, can be empty.
    - **Reps / distance**: free text ("8", "max", "50 m", "30 s", "5 each side").
    - **Rest**: free text ("1:30").
    - **Load**: a select with **No load** · **% of {mark}** (one per club mark) · **Text…**. With "% of", a 48px numeric field for the percentage; with Text, an 86px text field ("Bodyweight").
    - **Delete** (trash icon).
  - **Add row** (`#0f2131`): a search input "Add exercise — search the library or your club's".
    - Results appear in a popover under the input (the table wrapper must **not** clip it): up to 6, each with a thumbnail, the name and a source tag (**Library** / **Club**).
    - Choosing a result adds a row **pre-filled with the last dose used for that exercise anywhere in the club** (sets, reps, rest, load, load value). If it was never used, the row is blank.
    - **No match**: "No exercise called "{q}"." with **Create "{q}"**. That creates a club exercise with just the name, adds it, and shows "…created as a club exercise and added. Add tips or a photo in Exercises."
  - **Footer hint**: ""% of" a mark shows each member their own kilos. Members without that mark see the %."

#### Tab Exercises
- **Left column**:
  - a search field and filter chips: **All · Library · Club's own**, each with a count. There are no sport or type filters.
  - a list of rows (at least 54px tall), each with a 40px thumbnail or the generic icon, the name, "In {routine names}" or "Not in any routine yet", and a source tag.
  - the credit line: "Library photos: free-exercise-db (public domain)."
- **Right column**: the **New club exercise** form.
  - **Name** (required, must be unique among the library and the club's exercises: "There is already an exercise with that name.").
  - **How to do it** (optional, one tip per line).
  - **YouTube link or search** (optional; a URL is used as is, anything else as a search query; empty → the exercise name).
  - **Photo** (optional upload; without one, the generic icon shows).
  - **Add to club exercises**, then the hint "It shows up in routine search right away and in the next Excel template you download."
  - There is **no exercise type field**.
- Editing and deleting club exercises: same pattern as Marks (rename inline; can't delete while used in a routine).

#### Tab Marks
- Max width 620px.
- Lead: "The lifts your members can record (their best single lift, in kg). Routines use "% of" a mark to show each person their own kilos. Members only see marks you list here."
- **Rows** (at least 50px tall): the name, then "Used in {n} exercises · {k} members recorded it" (or "Not in any routine" / "Nobody recorded it yet"), with **Rename** (pencil) and **Delete** (trash) buttons.
  - **Rename** happens inline: an input with ✓ / × (Enter saves, Esc cancels) and the hint "Routines and members' values follow the new name." Routines and values reference `mark_id`, so nothing else changes.
  - **Delete**:
    - **Used by any routine row** → the button is disabled, with the tooltip "In use — change those routine rows first".
    - **Unused, and nobody recorded it** → delete immediately.
    - **Unused, but members recorded it** → an inline danger confirm: "{k} members recorded "{name}". Their values will be deleted too. This can't be undone." with **Cancel** and **Delete mark**. The confirm shows only the count, never names or values.
- **Add row**: "New mark, e.g. Power clean" and **Add**. Enter submits; duplicate names are blocked.
- Footer: "🔒 Coaches and admins never see members' values — only each member does."
- **Unit**: v1 marks are kg only. The column exists for later (see DATA_MODEL).

### 5.2 Mobile `2b`
- **Header**: `TRAINING · MANAGE`, "Plan training", and a 4-segment tab control (40px): Cycle · Routines · Exercises · Marks.
- **Cycle**:
  - one card with a **"Cycle" select** (48px; active and draft first, then an optgroup "Archived") instead of the desktop cards;
  - the status pill and "{N} weeks · {range} · {n} routines";
  - **name / event / date / weeks fields** (46px, 16px text): always visible for drafts, behind "Edit name and dates" for the active cycle, read-only for archived;
  - actions, each 44px: Make active (drafts), Duplicate, Archive (icon), **+** (new cycle);
  - the calculated line;
  - **one week at a time**: 44px ‹ › buttons, "Week {k} of {N}" and its dates, then 7 rows (56px) with the day label and a 44px routine `<select>`;
  - Copy week 1 (46px);
  - an Excel card: "Planning a whole cycle? The Excel template is faster on a computer. You can still download it here." with **Download template**.
- **Routines**:
  - a "Routines of" select (46px), routine rows (at least 64px) with a colour bar and a caret, and **+ New routine** (48px);
  - tapping a routine opens the **editor**:
    - "‹ Routines" (back), the name (48px);
    - **one card per exercise**: the thumbnail, the name, a 44px trash button; Sets / Reps or distance / Rest as 44px inputs in a `70px | 1fr | 80px` grid; the Load select (44px) and its value field; a Note field;
    - the add search (48px), with **inline** results (56px rows) and a **Create "{q}"** row when nothing matches.
  - Reordering on mobile: long-press drag with dnd-kit's TouchSensor (`touch-action: none` on the handle). The mock doesn't show the handle on mobile; add it to the left of each card.
- **Exercises**: search (46px), chips, a list (58px rows) and the New club exercise form (48px fields).
- **Marks**: the lead, rows (58px) with 44px Rename and Delete buttons, the inline rename and delete confirm (the confirm buttons are full width), and the add row (48px).
- **All inputs use 16px text** (to stop iOS zooming); touch targets are at least 44px.

## 6. Business rules

### 6.1 Cycles
- **Statuses**: `draft` → `active` → `archived`. Only one cycle is active per club; making one active archives the current one.
- **Week numbers** come from the dates: week `k` = `floor((today − start) / 7 days) + 1`, clamped to 1..N for display.
- **Changing Weeks**: added weeks start empty; removed weeks are cut from the end. Ask for confirmation when the removed weeks have routines in them.
- The **grid** stores one routine (or nothing) per day. Several routines on one day: not in v1.

### 6.2 Routines
- `cycle_id` set means the routine belongs to that cycle; `null` means shared (usable in every cycle).
- **Duplicating a cycle** deep-copies its own routines and remaps the grid. Shared routines are referenced, not copied.
- **Archiving a cycle** hides its routines from the selector (they appear under "Archived cycles"), but keeps them.
- **Deleting a routine**: ask for confirmation when the grid uses it ("Used on {n} days. Those days become Rest.").
- **Colour**: assigned on create from the palette `#33a1e0 #6fd6b4 #f2ce78 #f2887a #b7c7d6 #9e9ddc` (index = number of routines in that scope, modulo 6). It isn't shown as a choice.

### 6.3 Load and marks
- A row's `load_kind` is `none` | `pct` | `text`.
  - **`pct`**: `kg = round(mark × pct / 100 / 2.5) × 2.5`. Show "{kg} kg" with "{pct}% of {mark name, lowercase} {mark value}".
  - **`pct` without a member value**: show "{pct}%" in warning, with "of {mark} · add your mark".
  - **`text`**: show the text as is.
- **Member mark input**: accept digits, "." and "," (convert "," to "."); positive numbers only; save on change (debounced) through `save_member_mark`.
- **Privacy**: member values are readable only by that member, never by coaches or admins. The UI only ever shows staff **counts**.

### 6.4 Exercises
- The library comes from the seed and is read-only. Club exercises can be created, renamed and deleted (deleting is blocked while a routine uses the exercise).
- Name matching (search, duplicate checks, Excel import) is case- and accent-insensitive: NFD with combining marks removed, lowercase, trimmed.

## 7. Copy and i18n
New namespaces: `training.member.*`, `training.manage.*`, `training.marks.*`, `training.excel.*`.
- All the English copy is in the mock.
- Spanish is needed for all of it, for example: "Semana {k} de {N}", "Descanso", "Mis marcas", "Solo vos ves esto", "Ver en YouTube", "Renová para ver tu plan".
- Exercise names and tips come from the library in English. Club exercises are stored as typed. A later version can add `name_es`.

## 8. Tokens (dark)
- Core colours:
  - background `#0c1a26`
  - panel `#13283a`
  - border `#274055`
  - text `#e8f0f7`
  - secondary `#8aa1b5`
  - soft `#cfdeea`
  - muted `#5a7086`
  - accent `#33a1e0`, accent text `#5ab4e8`, on-accent `#0c1a26`
  - success `#6fd6b4`
  - warning `#f2ce78`
  - danger `#f2887a`
- Values used here that aren't tokens yet:
  - selected `#1d4869`
  - hover and selected row `#16304a`
  - table header and add row `#0f2131`
  - row rule `#22394d`
- Tints: `color-mix(in srgb, {colour} 20%, panel)`.
- Radii: 6, 7, 8, 10, 12, 32 (phone frame only), 999.
- Focus: a 2px accent outline.
- Icons: Phosphor.
- The light theme follows the same layout with the light tokens.

## 9. Screenshots (`screenshots/`)
| File | Screen |
| --- | --- |
| `d01-member-week.png` | Desktop member: the week and the day's routine with kilos |
| `d02-member-exercise-open.png` | Desktop member: an exercise expanded (photos, tips, YouTube) |
| `d03-coach-routines.png` | Desktop coach: Routines tab (filter, list, editor) |
| `d04-coach-cycle.png` | Desktop coach: Cycle tab (cards, fields, grid, Excel panel) |
| `d05-coach-exercises.png` | Desktop coach: Exercises tab and the new exercise form |
| `d06-coach-marks.png` | Desktop coach: Marks tab |
| `d07-locked.png` | Desktop: expired membership |
| `m01-member-day.png` | Mobile member: day pills and the routine |
| `m02-member-exercise-open.png` | Mobile member: an exercise expanded |
| `m03-coach-cycle.png` | Mobile coach: Cycle (select, details, one week) |
| `m04-coach-routines.png` | Mobile coach: the routine list |
| `m05-coach-routine-editor.png` | Mobile coach: the routine editor |
| `m06-coach-exercises.png` | Mobile coach: Exercises |
| `m07-coach-marks.png` | Mobile coach: Marks |
| `m08-locked.png` | Mobile: expired membership |

Photos can render blank in some screenshots; open the mock to see them. When a screenshot and this text disagree, follow this text.
