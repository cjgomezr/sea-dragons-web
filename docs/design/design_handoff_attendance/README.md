# Handoff: Attendance sheet redesign

## Overview
This redesigns the attendance sheet in `cjgomezr/sea-dragons-web`: the files under `src/components/attendance/*` and the `.attendance-*` styles in `globals.css`. The goals are:
- **No underline on member names.** The name still opens the record for Admins; a small ↗ icon and a hover colour now show that it's a link.
- **One compact line per member**, instead of the tall card. Today a row stacks the name above the segment on mobile and takes about 80px.
- **Totals in a single bar**, instead of three large cards.
- **Smaller session chips**. The "Older sessions" link loses its underline.
- **Unsaved changes are visible per row** (a yellow dot) and as a count on the Save button.

Behaviour stays the same: marking doesn't save, the whole sheet saves at once, the leave/discard confirm stays, `aria-live` stays on the totals and the notices, groups stay in RSVP order, and Coaches see the name as plain text.

## What to build
In `Attendance Upgrade.dc.html`:
- **`#1a`**: desktop.
- **`#2a`**: mobile (under 768px).
- `#1b`, the tile grid, is a rejected alternative. **Don't build it.**

## About the design files
These are design references made in HTML, not production code. Rebuild them in the existing components (`AttendanceSheetPanel`, `AttendanceRow`, `MemberAvatar`, `use-attendance-sheet`, `attendance-marks`) and keep i18n in both `en.ts` and `es.ts`. The mock's data is invented.

## Fidelity
The mock is high fidelity, built on the dark tokens in `globals.css`. Use the CSS variables; the light theme should follow the same layout with the light tokens.

## Desktop `#1a`

**Header**
- On the left, the eyebrow "TAKE ATTENDANCE" (mono, 11.5px, 700, letter-spacing .08em, secondary) and an H1 of about 26px: "{title} · {weekday} {day} {month}".
- On the right, the **Save attendance** button: primary, 40px tall, with a floppy-disk icon.
- When there are changes, the button adds a divider, a dark dot and "{n} unsaved". This replaces today's "· Cambios sin guardar".

**Session chips**
- Pills 30px tall, 13px text, labelled "Wed 14 · Training".
- The active chip has a `#1d4869` background, an accent border and bold text. Inactive chips have no background and a border.
- The row ends with an **"Older sessions →"** link: `--color-accent-text`, weight 600, **no underline**, with an `arrow-right` icon.

**Save notice**
- One line, in a panel tinted 12% with the success colour: a `check-circle` icon in success and "Saved · 12 present, 2 late, 3 absent".
- It replaces the border-left notice and stays `role="status"`.

**Totals**
- One panel (padding 12×14, radius 10) with three inline items. Each item is a 9px status dot, the count (mono, 18px, 700) and the label (13px, secondary).
- Right-aligned at the end: "{present + late} of {total} came", in secondary.
- Underneath, a 6px **stacked bar** with one segment per status, sized by `flex: count`, and a 2px gap between segments.
- Keep `aria-live="polite"`.

**Groups**
- Header: the label (GOING / MAYBE / NO REPLY / CAN'T GO, in mono, 11.5px, 700) and the count (mono, muted).
- Each group's rows sit in one bordered panel (radius 10).

**Row**
- Grid `30px | 1fr | auto`, gap 12, minimum height **44px**, padding 4px 8px 4px 12px.
- A 1px `#22394d` line separates rows. Hover background: `#16304a`.
- **Avatar**: 30px. Keep the `MemberAvatar` photo viewer; its button grows the touch area, as today.
- **Name**: 14.5px, weight 600, in `--color-text`, with **no underline** and an ellipsis if it's too long.
  - Admin: a link to `memberRecordHref`, followed by a 12px `arrow-up-right` icon in `#5a7086`. On hover the name turns `--color-accent-text`. Keep the accessible name "Open {name}'s record" and the `canLeaveSheet()` check.
  - Coach: plain text, without the icon.
- **Position chip**: mono 11.5px on the background colour, radius 5. The **Inactive** tag stays as an outline in danger.
- **Unsaved dot**: 6px, warning colour, with `title="Not saved yet"`. It shows when that member's current status differs from the saved one.
- **Segment**:
  - The container is the background colour with a border, radius 8 and 1px padding.
  - The buttons are 26px tall, padded 0 10px, 12.5px text, each with an icon and a label: **Present** (`check`), **Late** (`clock`), **Absent** (`x`).
  - **Selected**: the background is the status colour at 22% over the panel, the text is `--color-text` and bold, and the icon takes the status colour.
  - **Not selected**: transparent, secondary text, and the icon in `#5a7086`.
  - This replaces the solid `color-mix(status 60%, text)` fill. Check contrast on light: the text stays `--color-text`.
  - Keep `role="group"`, `aria-label={fullName}` and `aria-pressed`.

## Mobile `#2a`
**Header**: the eyebrow, then the title (21px) on up to two lines.

**Session chips**: 36px tall, in a single row that scrolls sideways (no wrapping) and ends with an **"Older →"** link.

**Totals**: the same three items (counts at 16px) and a 5px bar.

**The list scrolls** under the header. Each group's rows sit in a bordered panel with radius 12.

**Row**
- Flex layout, minimum height 56px, padding 6px 6px 6px 10px.
- **Avatar**: 32px.
- **Text block**: flex 1 and a minimum height of 44px, so it's a full touch target.
  - The **name** is 15px, weight 600, line-height 1.25, clamped to **2 lines** (`-webkit-line-clamp: 2`, `overflow-wrap: anywhere`), so long names stay readable. The ↗ icon sits inline after it, and the unsaved dot follows.
  - Underneath, "{position} · Inactive" (mono 11.5px, secondary), or "No position".
- **Segment**: one joined control, about **106px wide**.
  - The container is the background colour with a border, radius 9 and 2px padding.
  - The **icon-only** buttons are **34×40px** with 16px icons, and no gap between them.
  - Selected: a 22% status tint with the icon in the status colour. Not selected: transparent, icon in secondary.
  - Each button has `aria-label` set to the status name.
  - They are a little narrower than 44px, which is acceptable because the buttons are adjacent and 40px tall. If you need strict 44px targets, add invisible hit-area padding.

**Sticky save bar**
- Shown only while there are changes, fixed at the bottom of the screen.
- It has the panel background, a top border at 40% of the warning colour, a warning dot and "{n} unsaved", and **Save attendance** (48px, primary).
- On mobile it replaces the full-width Save button in the header.

## CSS changes (summary)
- `.attendance-record-link`:
  - remove `text-decoration`;
  - add `.attendance-record-icon`;
  - on hover, use `color: var(--color-accent-text)`;
  - drop the `min-height: 44px` on desktop. The row is already 44px tall, and on mobile the whole text block is the target.
- `.attendance-row`:
  - keep `flex-direction: row` on every screen size (no more stacking on mobile);
  - lower the padding (see the values above).
- `.attendance-choice`: on desktop, 26px with icon and label; on mobile, icon-only at 34×40, joined. The selected state becomes a tint, not a solid fill.
- `.attendance-totals`: becomes one panel with inline items and a stacked bar. Remove the three cards.
- `.attendance-session`: 30px on desktop, 36px on mobile, in a sideways-scrolling row on mobile.
- `.attendance-older-sessions`: no underline, with an arrow icon.
- `.attendance-notice`: a tinted background instead of `border-left`.

## Copy / i18n
- New:
  - "{n} unsaved" / "{n} sin guardar"
  - "{n} of {total} came" / "Vinieron {n} de {total}"
  - "Not saved yet" / "Sin guardar todavía"
  - "Older" (mobile chip) / "Anteriores"
- Unchanged: "Older sessions", the statuses, the group names, the saved notice and the discard question.

## Tokens
- Status colours: success `#6fd6b4`, warning `#f2ce78`, danger `#f2887a`.
- Core colours:
  - panel `#13283a`
  - background `#0c1a26`
  - border `#274055`
  - text `#e8f0f7`
  - secondary `#8aa1b5`
  - accent `#33a1e0`, accent text `#5ab4e8`
- Values used here that aren't tokens yet:
  - hover `#16304a`
  - row separator `#22394d`
  - muted icon `#5a7086`
  - active chip `#1d4869`
- Icons: Phosphor, bold weight for the status icons.

## Screenshots (`screenshots/`)
1. `01-desktop-list.png`: desktop, saved state.
2. `02-desktop-unsaved.png`: desktop with two changes (the dots and the count on the button).
3. `03-mobile-list.png`: mobile, saved state.
4. `04-mobile-unsaved.png`: mobile with the sticky save bar.

When a screenshot and this text disagree, follow the text.

## Files
- `Attendance Upgrade.dc.html`: the interactive mock. Build `#1a` and `#2a`.
- `support.js`: needed to open the mock.
