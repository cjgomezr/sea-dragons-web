# Handoff: Calendar redesign

## Overview
This is a redesign of the Calendar in `cjgomezr/sea-dragons-web` (`src/components/calendar/*`). It adds five things:
- **Colour per event type**: training, competition, social and meeting each get their own colour.
- **An optional image** per event, with a type-colour fallback when there is none.
- **An end time** (and a duration) for every event, plus **events that run over several days**.
- **A location that opens the map**: a "Directions" link and a "Copy address" button.
- **A clearer weekly repeat**: days of the week, an "until" date, a summary and the next dates.

## What to build
In `Calendar Upgrade.dc.html`:
- Desktop: **`#1a`**, the agenda list plus the event panel, and **`#1c`**, the create/edit dialog.
- Mobile (under 768px): **`#2a`** agenda, **`#2b`** event screen, **`#2c`** create/edit.
- `#1b` (month grid plus cards) is exploration. **Don't build it.**

## About the design files
These files are **design references made in HTML**, not production code. Rebuild them in the existing Next.js app and keep what already works:
- `AgendaScreen`, with its periods, paging, focus rules and notices;
- `useEventDetail`, `useEventRsvp`, `useEventTeam`;
- `EventOrganizerActions`, `EventTeams`, `TakeAttendanceLink`;
- the membership-gated RSVP;
- i18n in both `en.ts` and `es.ts`.

To view the mock, open the `.dc.html` in a browser, with `support.js` and `image-slot.js` next to it. The data and places are invented.

## Fidelity
The mock is **high fidelity**, built on the dark-theme tokens in `globals.css`. Use the CSS variables, not the hex values. The light theme should follow the same layout with the light tokens.

## Event type colours
| Type | Colour | Icon (Phosphor) |
| --- | --- | --- |
| training | `--color-accent` #33a1e0 | `timer` |
| competition | `--color-warning` #f2ce78 | `trophy` |
| social | `--color-success` #6fd6b4 | `confetti` |
| meeting | neutral #b7c7d6 (new token, `--color-type-meeting`) | `users-three` |

- **Tag background**: the type colour at 24% over the panel, with text in `--color-text`. This replaces the current `.agenda-type-*` styles.
- **Fallback when there's no image**: `linear-gradient(135deg, <colour> 32% over panel, panel 80%)` with the type icon in the type colour.

## Desktop

### `#1a` Agenda + panel — `AgendaScreen.tsx`, `AgendaRow.tsx`, `EventDetailPanel.tsx`
**Header**
- Eyebrow plus H1, as today.
- On the right: the **Upcoming | Past** segmented control (the existing `PeriodChoice`, restyled) and the primary **+ Event** button.
- Under the header, the **type filter chips**: one pill per type with a colour dot.
  - On: the type tint and a border at 50% of the type colour.
  - Off: no background, secondary text, and the dot at 35%.
  - This is new and client-side. Keep it in the URL (`?types=`).

**Body**: a grid of `1fr | 380px`.

**List column**
- **Day groups**: a mono 11px label, "TODAY" (accent) or "SAT · OCT 17" (secondary), with an optional secondary sub-label ("This weekend").
- **Rows**: a grid `4px | 74px | 56px | 1fr | auto`, radius 10. On hover the row gets the panel background; the selected row keeps the panel background.
  - **4px bar**: the type colour, full row height.
  - **Time**: the start time in mono, bold, with the end time underneath in secondary text.
  - **56px thumbnail**: the event image, or the type fallback with a 24px icon.
  - **Body**:
    - the title (15px, weight 650, ellipsis);
    - a line with the type tag, a `repeat` icon when the event belongs to a series, and the place as a **map link** with a map-pin icon. The link opens Google Maps in a new tab and uses `stopPropagation`, so clicking it doesn't select the row.
  - **Right side**:
    - **My response**: when there is one, a pill (Going in success, Maybe in warning, Can't go in danger). Otherwise "RSVP" in the accent colour.
    - **"{n} going"**, in secondary text.
- Clicking a row selects it and fills the panel. On desktop this replaces the current accordion. Keep the keyboard rules: the title is a button, so Enter or Space selects the row.

**Panel** (panel background), from top to bottom:
1. **Image**, 190px tall, or the fallback with a 76px icon, plus a 4px bar in the type colour along the bottom edge.
2. **Type tag** and the audience, then the H2 title (21px).
3. **Time block**:
   - a 36px icon tile with a clock in the type colour;
   - "Wednesday, October 14" and "6:00 pm – 7:30 pm · 1 h 30 min";
   - multi-day events show "Sat, Oct 24 – Sun, Oct 25" and "8:30 am Sat – 5 pm Sun · 2 days";
   - an icon button **Add to my calendar** (`calendar-plus`). It is new: it downloads an `.ics` file, which costs nothing.
4. **Repeat block** (series only): a `repeat` icon tile with "Every Wednesday" and "Until Dec 16 · 10 sessions left".
5. **Location card** (border, radius 10):
   - a map preview area, 110px tall, linking to Maps (see "Map and location" below);
   - the place name and address, with an icon button **Copy address** (it shows a check after copying);
   - a full-width **Directions** link (accent, bold, `navigation-arrow` icon).
6. **ARE YOU GOING?**: three 38px buttons, **Going · Maybe · Can't go**.
   - The selected one is tinted with its colour (success, warning or danger).
   - This replaces `EventRsvp` Yes/Maybe/No with the same `aria-pressed` rules.
   - Disabled when the membership isn't current, as today.
7. **GOING · n** with "n maybe": up to 7 overlapping 30px avatars, "+n more", and "See all". "See all" opens the existing names list.
8. **NOTES**, when there are any.
9. **Teams**: keep `EventTeams` here for training and competition events.
10. **Actions row**:
    - **Take attendance** (primary), only when the existing rules allow it;
    - **Edit** (secondary);
    - a **cancel** icon button in danger red.

**Editing a series**: clicking Edit on an occurrence shows an inline chooser above the actions:
- "This event repeats. What do you want to edit?"
- **This session only**: "Changes only {date}. The rest stay the same."
- **This and all following sessions**.
- Cancel.

This maps onto the existing `event` and `series` layouts.

### `#1c` Create / edit dialog — `EventDialog.tsx`, `EventForm.tsx`, `EventFormFields.tsx`
The dialog is 640px wide, with a header ("New event" / "Edit event" and ×) and a footer (Cancel, and **Create event** / **Save**). Fields in this order:

1. **Image · optional**
   - Empty: a 120px banner in the type fallback, with "Without an image, the {type} background is used." and an **Add image** button.
   - Filled: a 160px image with a **Remove image** link.
   - Uploads go through the existing storage, as a new kind: `event_cover`.
2. **Type**: four 38px buttons with their icons. The selected one gets the type tint and a border in the type colour.
3. **Title**.
4. **When**
   - Date (or "Starts" for a weekly series), **Starts** time and **Ends** time.
   - Under them:
     - "Lasts 1 h 30 min", or, in danger red, "The end must be after the start." (the Ends field border also turns red);
     - a **"Ends on another day"** switch, for one-off events only, which adds an **End date** field.
   - **Quick length** chips: 1 h · 1 h 30 · 2 h · 3 h. They set Ends to Start plus that length.
5. **Repeat**: a **Once | Weekly** segmented control. Weekly opens a panel with:
   - **On these days**: seven 42px round toggles, M T W T F S S.
   - **Until** (date).
   - A summary: "Every Monday and Thursday, 6 pm – 7:30 pm · 18 sessions until Thu, 17 Dec".
   - **Next**: the first 4 dates as mono chips, then "+n more".
   - The hint "Each session gets its own RSVP and attendance. You can still edit or cancel a single one."
   - Errors: "Pick at least one day." and "No sessions fall between the start and the until date." These are the client side of the existing `series_weekdays_empty` and `series_without_sessions` checks.
6. **Location**
   - A search field with up to 3 results, each showing the place and its address. Picking one shows a confirmed card:
     - a green pin, the place and the address;
     - a "Check on map" link;
     - an × to change the place.
   - Then an optional **Where exactly** field, for example "Field 2, near the pavilion".
   - Free text stays allowed; it just opens a map search for that text.
7. **Notes** and **Who it's for**: unchanged.

Create stays disabled while the end time is before the start, or a weekly series has no days.

## Mobile
Touch targets are at least 44px, and inputs use **16px text** so iOS doesn't zoom in.

**`#2a` Agenda**
- **Header**: "Calendar" (26px) and a 44px primary **+** button.
- **Upcoming | Past**: full width, 38px tall.
- **Type chips**: 36px tall, scrolling sideways.
- **Day labels** as on desktop.
- **Cards** (panel background, radius 10, 6px gap):
  - a 4px colour bar and a 52px thumbnail;
  - first line: "6:00–7:30" in mono, the repeat icon if it applies, and my response on the right;
  - the title, up to 2 lines;
  - a pin icon and the place.
  - Tapping a card opens the event screen.

**`#2b` Event screen**
- **Top bar**: back, the type tag, and ⋯.
- An image, 200px tall, with the bottom type-colour bar.
- Then, in order:
  - the title (24px) and the audience;
  - the time block, with a 44px "Add to calendar" button;
  - the repeat block, for series;
  - the **location card**: place and address with a 44px copy button, and a full-width **Directions** link, 48px tall;
  - **ARE YOU GOING?**: three 58px buttons with an icon above the label;
  - the GOING avatars, as a row that opens the full list;
  - Notes;
  - **Take attendance** (48px, primary), when allowed.
- **⋯ bottom sheet**:
  - For a series: the label "THIS EVENT REPEATS", then **Edit this session only** (with the date) and **Edit this and following**.
  - For a one-off event: **Edit event**.
  - **Cancel event**, in danger red.
  - Close.

**`#2c` Create / edit** (full screen)
- **Top bar**: Cancel, "New event", and a primary **Create** button.
- The form scrolls underneath, in order:
  - **Image**: a 120px banner, or a 160px image once chosen.
  - **Type**: a 2×2 grid of 46px buttons.
  - **Title**.
  - **Date**, then **Starts / Ends** side by side, each 48px tall.
  - The duration line or the error.
  - The quick-length chips (40px), scrolling sideways.
  - The "Ends on another day" switch (44×26), for one-off events.
  - **Repeat**: Once | Weekly (40px).
    - The weekday circles are 44px and spread across the row.
    - Then **Until**, and a summary card with the next dates.
  - **Location** search: results at least 56px tall, then the confirmed card with a 44px × button.

## Data / API changes
- **`ends_at`** (time) on events and series, and **`end_date`** for multi-day one-off events.
  - It is required for new events. Validate end > start, or end date ≥ start date.
  - Existing events without an end time show the start time only, as today. Make the field optional in reads.
- **`cover_upload_id`** (nullable) on events and series. Feed and detail return `coverUrl | null`.
- **Location**: keep `location` as free text. Add the optional fields `place_name`, `address`, `lat`, `lng` and `place_detail` (the "where exactly" text).
- **Maps link** (no API key, no cost):
  - with coordinates: `https://www.google.com/maps/search/?api=1&query={lat},{lng}`;
  - otherwise: `https://www.google.com/maps/search/?api=1&query={encodeURIComponent(place + ", " + address)}`.
  - On phones this link opens the Google Maps app, or the browser. Optionally, offer Apple Maps on iOS: `https://maps.apple.com/?q=...&ll=lat,lng`.
- **Map preview** (optional):
  - Free options: an OpenStreetMap embed (`https://www.openstreetmap.org/export/embed.html?bbox=...&marker=lat,lng`) or a static tile.
  - Avoid paid static map APIs.
  - If there are no coordinates, hide the preview and keep only the link.
- **Place search**: needs a geocoding provider. Free options include Nominatim (OpenStreetMap, with usage limits and a required User-Agent; proxy and cache it on the server) and Photon. Pick one with the product owner.
- **Add to calendar**: generate an `.ics` file on the client or the server, using the start, end, location and notes.
- **Weekly repeat**: already supported (`repeat: weekly`, `weekdays`, `startsOn`, `endsOn`). No API change beyond the new fields above.

## Copy / i18n (new or changed)
- RSVP: "Going / Maybe / Can't go" in English and "Voy / Quizás / No puedo" in Spanish. The labels change; the values `yes`, `maybe` and `no` stay the same.
- Location: "Directions" / "Cómo llegar", "Copy address" / "Copiar dirección", "Add to my calendar" / "Agregar a mi calendario".
- Time: "Ends on another day" / "Termina otro día", "Lasts {duration}" / "Dura {duration}", "The end must be after the start." / "La hora de fin debe ser después del inicio.".
- Repeat: "Once / Weekly", "On these days", "Until", the repeat summary, and the scope options "This session only" and "This and all following sessions".
- Image: "Image · optional", "Add image", "Remove image".

## Tokens (dark, `globals.css`)
- Core colours:
  - background `#0c1a26`
  - panel `#13283a`
  - border `#274055`
  - text `#e8f0f7`
  - secondary `#8aa1b5`
  - soft `#cfdeea`
  - accent `#33a1e0`, hover `#5ab4e8`
  - on-accent `#0c1a26`
  - success `#6fd6b4`
  - warning `#f2ce78`
  - danger `#f2887a`
- Values used here that aren't tokens yet:
  - hover `#1a3349`
  - selected segment `#1d4869`
  - map preview ground `#0f2131`
  - meeting `#b7c7d6`
- Radii: 6, 8, 10, 12, 14 (dialog), 20 (sheet), 999 (pills).
- Focus: 2px accent outline.
- Icons: Phosphor.

## Screenshots (`screenshots/`)
1. `01-desktop-agenda-panel.png`: the agenda with the panel showing a social event that has an image.
2. `02-desktop-recurring-edit-scope.png`: a repeating training selected, with the edit-scope chooser open.
3. `03-desktop-create-weekly.png`: the create dialog for a weekly series (Mon and Thu), with location search.
4. `04-desktop-create-location-picked.png`: the create dialog after picking a place.
5. `05-mobile-agenda.png`: the mobile agenda.
6. `06-mobile-event.png`: the mobile event screen.
7. `07-mobile-event-actions.png`: the mobile ⋯ sheet for a repeating event.
8. `08-mobile-create.png`: mobile create, weekly.

When a screenshot and this text disagree, follow the text.

## Files
- `Calendar Upgrade.dc.html`: the interactive mock. Build `#1a`, `#1c` and `#2a`–`#2c`.
- `support.js` and `image-slot.js`: needed to open the mock.
- `screenshots/`: the images above.
