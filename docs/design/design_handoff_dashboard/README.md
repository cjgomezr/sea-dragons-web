# Handoff: Dashboard (Home) redesign

## Overview
This redesigns the home screen in `cjgomezr/sea-dragons-web`: the files under `src/components/dashboard/*`, the `.dashboard-*` styles in `globals.css`, and `GET /api/v1/dashboard`.

Today the top of the screen is four stat tiles that mostly serve Admins, and RSVP only appears on mobile. The new home puts **what's next** first, for everyone:
- the next event, with the RSVP buttons;
- the player's team, when teams have been published;
- this week;
- news with images.

Below that, the content depends on the role:
- **Player**: their own attendance and their membership.
- **Admin / Coach**: a **To do** list and the club numbers.
- **Expired member**: the same home, read-only, with a prominent **Renew membership** call to action.

## What to build
In `Dashboard Upgrade.dc.html`:
- **`#1a`** is desktop and **`#2a`** is mobile (under 768px).
- The **"Ver como"** switch above the frames toggles **Player / Expired member / Admin-Coach** in both frames.

The mock's data is invented.

## About the design files
These files are design references made in HTML, not production code. Rebuild them in the existing `DashboardScreen`, and keep:
- the greeting logic (`greetingPeriodAt`);
- `useEventRsvp` and `EventRsvp` (Going / Maybe / Can't go);
- `MembershipNotice`, `ContactReminderNotice`;
- `canCreateTrainings`;
- the loading and failure states;
- i18n in both `en.ts` and `es.ts`.

Reuse the visuals from the earlier handoffs:
- event type colours and fallback images (`design_handoff_calendar`);
- news cover images and pinning (`design_handoff_news`);
- team labels (`design_handoff_teams`).

## Fidelity
The mock is high fidelity, built on the dark tokens. Use CSS variables; the light theme should follow the same layout with the light tokens.

## Layout: desktop `#1a`
**Header**
- An eyebrow ("THU 15 OCT · HOME", mono) and an H1 greeting (28px).
- Admins and Coaches also get a primary **+ Event** button on the right, opening the calendar's new-event flow (`NEW_TRAINING_HREF`).

**Notices strip** (optional, under the header)
- **Contact reminder** (active members only): a slim strip tinted 12% with warning, a phone icon, the text, "Add contact" and a dismiss button.
- **Expired membership**: a strip tinted 14% with danger, with a 50% danger border, and a `warning-circle` icon.
  - Title: "Your membership expired on {date}".
  - Body: "You can still see what's on. Renew to RSVP, be picked for teams and get the member price on sessions."
  - A primary **Renew membership** button, linking to Payments.
  - When the membership is expired, the contact reminder is **hidden**, so it doesn't compete with this notice.

**Main grid**: `1fr | 340px`, with an 18px gap.

**Left column**
1. **Next-up card**: a grid `280px | 1fr` with radius 14.
   - **Image side**:
     - the event cover, or the type fallback (`linear-gradient(135deg, type 34% over panel, panel 85%)` with an 84px type icon);
     - a "NEXT UP · IN {n} DAYS" pill at the top left;
     - a 4px bar in the type colour along the bottom.
   - **Body**:
     - the type tag and the audience;
     - the H2 title (22px);
     - "{day} · {start} – {end} · {duration}" with a clock icon;
     - the place, with a map-pin icon and a **Directions** link (maps URL as in the calendar handoff);
     - **RSVP**: three 40px buttons, **Going · Maybe · Can't go**. The selected one gets a 22% tint of its status colour and a 60% border. Below them, "{going} going · {maybe} maybe".
   - **Expired member**: the RSVP buttons are replaced by a locked row: a `lock-simple` icon, "RSVP is for current members." and a **Renew** link.
   - **Player with a published team**: a team strip that links to the event's lineups.
     - Background: the team colour at 26% over the base; border: the team colour at 60%.
     - A 30px swatch with a `t-shirt` icon.
     - "YOU'RE PLAYING IN" (mono, 10.5px) and "**{team}** · {colour} bib · {position}".
     - "Lineups ›".
     - Hidden when there's no published split, when the viewer isn't in it, or when the membership is expired.
   - **Admin/Coach, when the next event has a saved but unpublished split**: a dashed row, "Teams are saved but **not published** yet.", with an **Open teams ›** link.
2. **This week**
   - A header ("This week" and "Calendar →").
   - A **7-day strip**, from today to today + 6. Each day is a button showing the mono weekday, the date (18px) and up to three 7px dots in the event type colours.
     - Today's weekday is in accent.
     - The selected day gets a `#1d4869` background and an accent border.
     - Meetings appear only for Admins and Coaches.
   - **The selected day's events**, as rows in the grid `4px bar | 92px time (start/end) | title + place | my response`.
     - My response shows Going (success), Maybe (warning) or RSVP (accent).
     - Empty state: "Nothing on {day}."
     - The default selection is the day of the next-up event.

**Right column**
- **Player**:
  - **My attendance**:
    - "This season", with a 34px mono percentage and "{n} of {m} sessions";
    - a **Last 10** strip of ten 22px blocks (present = success, late = warning, absent = danger) with a legend.
  - **Membership**: a row with a 38px icon tile, then "Membership active" and "Full member · renews {date}" (success tint), with a caret to Payments.
    - Expired: "Membership expired" and "Expired {date} · renew in Payments" (danger tint).
- **Admin / Coach**:
  - **To do**: a card with a count badge (warning background).
    - Rows are at least 56px tall: a 32px tinted icon tile, a title, a subtitle, and an accent call to action.
    - Include only the items that apply:
      - **"{n} role requests"** → Review (directory requests);
      - **"Take attendance"**, "{event} · {date}": the most recent past session without saved attendance → Take;
      - **"Publish teams"**, "{event} · saved, not published" → Open;
      - **"{n} haven't replied"**, "{next event}" → See who (opens the event).
    - Empty state: "✓ All caught up." in success.
  - **Club numbers**: a 2 × 2 grid.
    - **Club attendance**: "78%" with "↑ 4 pts vs last month". The trend arrow and text are success when the rate went up and danger when it went down. The comparison is the last 30 days against the 30 days before. Links to Attendance.
    - **My attendance**: "85%", "{n} of {m} sessions". **Hide this cell** when the viewer has no attendance records (an Admin who doesn't train).
    - **Members**: "86", "+{n} this month". Links to the Directory.
    - **Unread news**: "2", "{n} announcement". Links to News.

**News** (full width, below the grid)
- A header ("News", "All news →").
- A grid `1.35fr | 1fr`:
  - **Featured**: the pinned post, or the latest one. A card with a 240px cover (or the category fallback), "📌 PINNED" in warning (or the category), "{category} · {relative time}", the title (17px, 700) and a 2-line excerpt.
  - **Two minis**: a 64px thumbnail, the meta line, a 2-line title, and an 8px accent **unread dot**.
- **Expired members**: the design keeps News visible, which is a change from today, where the restricted home hides it. **This needs a product decision.** If the product owner says no, hide the News section for restricted dashboards.

## Layout: mobile `#2a`
One scrolling column with 14px side padding and a 16px gap, above the existing bottom tab bar.

- **Greeting**: the date eyebrow, then the greeting (24px). Admins and Coaches also get a 44px **+** button.
- **Expired notice**: a card with the danger tint, the title, a line of text, and a full-width 46px **Renew membership** button.
- **Next-up card**:
  - a 130px image area on top;
  - the title (19px), the time and the place;
  - a full-width 44px **Directions** button;
  - **three 56px RSVP buttons, each with the icon above the label**;
  - the going line;
  - the team strip (at least 52px tall) or the Admins' "Teams not published" row;
  - expired members get the locked row instead of the buttons.
- **To do** (Admin/Coach): rows at least 60px tall, each ending with a caret.
- **This week**: the 7-day strip with a single-letter weekday, a 16px date and 6px dots. Below it, the selected day's events as 56px rows: the bar, the start time, the title, "end · place", and my response.
- **Player**: two side-by-side cards:
  - **My attendance**: the percentage and a mini last-10 bar.
  - **Membership**: Active or Expired, with the date.
- **Admin**: the 2 × 2 club numbers.
- **News**: the featured card (120px cover) and the two minis (56px thumbnails).

## Data / API changes (`GET /api/v1/dashboard`)
Additions to the member and restricted payloads:
- **`nextUp`**: the next event the viewer can see (not only trainings). It carries:
  - `id`, `title`, `eventType`, `startsOn`, `startTime`, `endTime`;
  - `location { place, address, lat, lng }` and `coverUrl`;
  - `goingCount`, `maybeCount`, `myResponse`;
  - `myTeam`: `{ team: { name, color }, position } | null`, set only when the split is published and the viewer is in it;
  - `teamsStatus`: `"none" | "draft" | "published"`, for Admins and Coaches.
- **`week`**: the events from today to today + 6, each with `{ id, title, eventType, startsOn, startTime, endTime, location.place, myResponse }`. Committee meetings appear only for Admins and Coaches.
- **`me.attendance`**: `{ percent, attended, sessions, last10: ("present" | "late" | "absent")[] } | null`, for the season. Return it for every role whenever the viewer has records.
- **`membership`**: `{ status: "active" | "expired", renewsOn | expiredOn }`.
- **Admin / Coach only**:
  - `club.attendance`: `{ percent, previousPercent }` (last 30 days compared with the 30 days before);
  - `club.members`: `{ active, joinedThisMonth }`;
  - `club.unreadNews`: `{ count, announcements }`;
  - `todos`, a list where each item is one of:
    - `{ kind: "role_requests", count }`
    - `{ kind: "attendance_missing", eventId, title, startsOn }`
    - `{ kind: "teams_unpublished", eventId, title }`
    - `{ kind: "no_reply", eventId, title, count }`
- **`latestNews`**: add `coverUrl`, `isPinned` and `isRead` to each item. Order: the pinned post first, then the newest.

The four tiles (`tiles.*`) can be retired once the new fields ship.

## Copy / i18n (new)
- "NEXT UP · IN {n} DAYS", "Directions", "{going} going · {maybe} maybe".
- "YOU'RE PLAYING IN", "{colour} bib", "Lineups".
- "Teams are saved but not published yet.", "Open teams".
- "This week", "Nothing on {day}.", "Calendar".
- "My attendance", "This season", "{n} of {m} sessions", "Last 10".
- "Membership active", "Full member · renews {date}", "Membership expired", "Expired {date} · renew in Payments".
- "To do", "{n} role requests", "Take attendance", "Publish teams", "{n} haven't replied", "Review / Take / Open / See who", "All caught up."
- "Club attendance", "{n} pts vs last month", "Members", "+{n} this month", "Unread news".
- "Your membership expired on {date}", the expired-notice body text, "Renew membership", "RSVP is for current members.", "Renew".
- "News", "All news", "PINNED".

## Tokens
- Event types: training `#33a1e0`, competition `#f2ce78`, social `#6fd6b4`, meeting `#b7c7d6`.
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
  - row line `#22394d`
  - muted `#5a7086`
  - selected `#1d4869`
- Radii: 7, 8, 10, 12, 14, 999.
- Icons: Phosphor.

## Screenshots (`screenshots/`)
1. `01-desktop-player.png`
2. `02-desktop-admin.png`
3. `03-desktop-expired.png`
4. `04-mobile-player.png`
5. `05-mobile-admin.png`
6. `06-mobile-expired.png`

When a screenshot and this text disagree, follow the text.

## Files
- `Dashboard Upgrade.dc.html`: the interactive mock. Use the "Ver como" switch to see each role.
- `support.js`: needed to open the mock.
