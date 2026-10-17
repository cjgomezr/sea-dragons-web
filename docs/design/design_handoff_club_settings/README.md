# Handoff: Club settings + Account menu redesign

## Overview
This redesigns the club settings page (`src/components/club/*`, `ClubSettingsScreen`) and the account menu (`src/components/AccountMenu.tsx`) in `cjgomezr/sea-dragons-web`.

**Club settings**
- Today it is one long page. It splits into **four sections**:
  - **General**: identity and brand.
  - **Sign-in page**: the headline and paragraph members see before they sign in.
  - **Positions**.
  - **Session packs**.
- Positions and packs become **compact one-line rows**, reordered by **drag and drop** with a keyboard alternative. The up/down buttons go away.
- Desktop shows the sections as **tabs**. Mobile shows a **list of sections**, and each one opens on its own screen.

**Account menu**
- Sign out, theme and language stay here, because they are personal preferences, not club settings.
- The menu is restyled. Appearance gains a **System** option, and Language becomes a two-option control.

## What to build
In `Club Settings Upgrade.dc.html`:
- **`#1a`**: desktop, with tabs and the account dropdown.
- **`#2a`**: the mobile account screen.
- **`#3a` + `#3b`**: mobile club settings, the list and an open section.

`#2b` and `#2c`, the mobile chip tabs, are a **rejected alternative. Don't build them.** They are kept in the file only for comparison.

## About the design files
These are design references made in HTML, not production code. Rebuild them in the existing app and keep:
- the existing API clients (`club-settings-client`, `club-sign-in-texts-client`, `club-positions-admin-client`, `club-session-packs-client`);
- conflict handling (409, "Load latest");
- validation (`findClubSettingsIssues`, `findSessionPackIssue`, sign-in text limits);
- `ClubLogoField` (the logo still saves immediately);
- the accent evaluation (`evaluateAccentColor`), focus management, and the aria-live announcements;
- i18n, in both `en.ts` and `es.ts`.

To view the mock, open the `.dc.html` in a browser with `support.js` next to it. The data is invented.

## Fidelity
The mock is high fidelity, built on the dark-theme tokens in `globals.css`. Use the CSS variables, not the hex values. The light theme should follow the same layout with the light tokens.

## Roles
- **Admin**: sees all four sections. *Club settings* appears in the account menu.
- **Committee**: sees **only Session packs**, as today. Desktop shows no tab bar. Mobile shows no list: the account menu opens Packs directly.

## Desktop `#1a`

### App header
Add a right-aligned header row containing:
- the notifications icon button;
- the **account button**, a 38px circle with the user's initials. When the menu is open, it shows a `#1d4869` background and a 2px accent ring.

### Account menu (dropdown) — `AccountMenu.tsx`
- **Panel**: 300px wide, anchored to the right edge of the account button, 6px below it. It uses the panel background, a 1px border, radius 12, `--shadow` and 6px of padding.
- **Contents, from top to bottom**:
  1. **Identity**: a 40px avatar, the name (14.5px, weight 600) and "{role} · {email}" (12.5px, secondary). Rule underneath.
  2. **My profile** (`user-circle` icon).
  3. **Club settings** (`gear-six` icon), Admin only. On the settings page it is highlighted, with "You're here" on the right.
  4. **APPEARANCE**: a mono label, then a 3-option segmented control **Light · Dark · System**, with the icons `sun`, `moon` and `desktop`. The selected option has a `#1d4869` background and bold text.
     - **System** is new. It follows `prefers-color-scheme` and should be the default for new users.
     - This replaces the current `ThemeToggle` switch.
  5. **LANGUAGE**: a 2-option segmented control, **English · Español**. It replaces `LanguageToggle` and keeps its server refresh.
  6. **Sign out**: in danger red, with a `sign-out` icon, separated by a rule above it. Keep `SignOutButton`.
- Keep the current behaviour: `useDismissal`, Esc and click-outside close the menu, focus moves to the heading when it opens, and focus returns to the button when it closes.

### Club settings page — `ClubSettingsScreen.tsx`
- **Header**:
  - H1 "Club settings" (28px) with the lead "What members see and how the club is set up."
  - Below it, the **tab bar**: General (`identification-card`) · Sign-in page (`sign-in`) · Positions (`soccer-ball`) · Session packs (`ticket`). Use a different icon if the sport isn't football.
  - Tab style: 14px, weight 600, no wrapping. The active tab is in `--color-text` with a 2px accent underline. Inactive tabs are secondary.
  - A tab with unsaved changes shows a 7px **warning dot**.
- Use `role="tablist"`, `role="tab"` and `aria-selected`, with arrow-key navigation between tabs. Keep the open tab in the URL (`?tab=positions`).
- **Saving**:
  - **General**, **Sign-in page** and **Session packs** collect a draft. A **sticky "Unsaved changes" bar** appears at the bottom of the content only while that tab has changes.
    - The bar has a panel background and a border at 40% of the warning colour, `--shadow`, a warning dot, the text "Unsaved changes to {the club details | the sign-in page | session packs}", **Discard** (ghost) and **Save changes** (primary).
    - Save is disabled while the form is invalid.
    - After saving, show a "✓ Saved" toast in the success colour, bottom right, for about 2.5 seconds.
  - **Positions** saves each change immediately, as today: move, role, rename, archive, reactivate and create. A short inline notice ("Forward moved to 3 of 6 · saved") appears at the top right of the tab, and the aria-live announcement stays.
  - Switching tabs with unsaved changes keeps the draft and the dot. Leaving the page with unsaved changes should ask first, with `beforeunload` and a confirm on route change.

#### Tab: General — `ClubSettingsForm`, `ClubAccentField`, `ClubLogoField`
Two columns, `1fr | 300px`.

**Left column**
- **IDENTITY**
  - **Club name**, with an "n / 60" counter and the error "The club needs a name.".
  - **Initials · optional**, 220px wide. The placeholder shows the automatic initials. Hint: "Shown when there's no logo. Up to 3 letters."
- **BRAND**
  - **Accent colour**:
    - five 32px preset swatches (the selected one gets a 2px ring);
    - a divider;
    - a 110px mono hex field, with the error "Use a code like #33A1E0.";
    - keep the native colour picker as an option if you want it;
    - keep the server-side readability check.
  - **Logo**: one row with a 56px preview (initials in the accent colour when there's no logo), the text "PNG or SVG, square, at least 256 px. Saves right away." and an **Upload** button. When there is a logo, add **Replace** and **Remove**.

**Right column**: a sticky **PREVIEW** card showing a sidebar header with the mark and the club name, a primary button and a link, all in the chosen accent. It replaces the current `AccentPreview` chip.

#### Tab: Sign-in page — `ClubSignInTextsSection`
Two columns, `1fr | 340px`.

**Left column**
- The lead "The headline and paragraph on the sign-in page. Leave a field empty to use the app's text."
- An **English | Español** segmented control. It replaces the four stacked fields.
- **Headline**: an input with an "n / 80" counter, and the app's own text for that language as the placeholder.
- **Welcome paragraph**: a 5-row textarea with an "n / 400" counter.
- A note on the other language: "Español has its own text." or "Español uses the app's text."

**Right column**: a **SIGN-IN PAGE · EN** preview card. It shows the club mark, the headline (20px) and the paragraph, and falls back to the app's text when a field is empty.

#### Tab: Positions — `ClubPositionsSection`, `ClubPositionItems`, `PositionCoverageControl`
- Lead: "The order here is the order everywhere: directory filters, teams and evaluations. The role tells auto-balance where each position plays."
- **The list is one bordered table.**
  - Columns: `36px | 28px | 1fr | 170px | 84px`.
  - The header row has a `#0f2131` background and reads: (handle) · # · POSITION · ROLE IN AUTO-BALANCE · (actions).
  - Each row is about 46px tall, with 7px × 12px padding.
- **Row contents**:
  - **⋮⋮ drag handle** (`dots-six-vertical`): a 30px button with `aria-label="Reorder {name}, position {i} of {n}"`.
  - **Rank** (mono).
  - **Name** in the screen's language (14.5px, weight 600), then the other language's name in 12.5px secondary ("ES · Portero"). If one name is missing, show "No Spanish name" (or "No English name") in **warning**.
  - **Role**: a 32px select with No role, Goalkeeper, Defence and Attack. It **saves on change**: there's no separate Save button any more.
  - **Actions**: icon buttons for **Rename** (`pencil-simple`) and **Archive** (`archive`).
- **Rename** happens inline: the name cell turns into two 32px inputs (English, Español), and the action cell becomes ✓ (primary) and ×. Keep `PositionNamesForm` validation: at least one name.
- **Add row**: the last row of the table, with a `#0f2131` background. It has a + icon, the inputs "New position (English)" and "Español", the hint "One name is enough." and an **Add** button that is disabled until a name is typed.
- **Archived**: a collapsible "▸ Archived · n — hidden from new records, kept on old ones". Each archived row shows the name and a **Reactivate** button.
- **Drag and drop** (desktop):
  - The dragged row drops to 45% opacity, and a 2px accent line marks where it will land.
  - Dropping sends `reorderManagedPositions(newOrder)`, then focus returns to the handle and the move is announced.
  - **Keyboard**: with the handle focused, **↑ / ↓** move the row one place, the same as today's buttons. Keep the focus on the handle after each move.
  - Recommended library: **dnd-kit** (`@dnd-kit/core` + `@dnd-kit/sortable`). It handles mouse, touch and keyboard, plus screen-reader announcements.

#### Tab: Session packs — `ClubSessionPacksSection`
- Max width 620px.
- Lead: "Bundles Casual members can buy. Each pack costs the Casual session price × sessions (now A$15.00 per session in Stripe)."
- **The list is a bordered table** with columns `36px | 1fr | 110px | 40px`.
  - Each row has the ⋮⋮ handle, a sessions badge (mono, bold, `#1d4869` background) with the label "{n} sessions", the price (mono, right-aligned, `priceSessionPack`), and a trash icon button that turns danger red on hover.
  - The empty state reads: "No packs. Casual members can only pay per session."
- **Add row**: the last row, with a + icon, a numeric field (80px wide), "sessions", the live price of the new pack, and a 32px **+** button.
  - Errors appear inline: "Between 2 and 50." and "Already in the list."
- Footer hint: "From 2 to 50 sessions, no repeats. Members see them in this order."
- Reordering uses the same drag-and-drop and keyboard behaviour as positions, but it only changes the **draft**. It's saved with the sticky bar.

## Mobile
Touch targets are at least 44px, and inputs use **16px text**.

### `#2a` Account (full screen, as today)
- Back arrow and the title "Account".
- Identity: a 52px avatar, the name and "role · email".
- A grouped card holding **My profile** and **Club settings**, each 54px tall with a caret.
- **APPEARANCE**: Light / Dark / System, as a 42px segmented control.
- **LANGUAGE**: English / Español, also 42px.
- **Sign out**: a 50px outlined button in danger red.

### `#3a` Club settings: the list
- **Header**: back to Account, with the title "Club settings".
- **Club identity row**: a 44px mark, the club name, and "Only Admins see this."
- **A grouped card with 4 rows**, each at least 68px tall. Every row has a 36px icon tile (`#1d4869`), a title and a one-line summary, then a caret:
  - General: "Name, initials, colour #33A1E0, logo".
  - Sign-in page: "English: app text · Español: custom".
  - Positions: "6 positions · 1 archived".
  - Session packs: "4 packs · 5, 10, 20, 8 sessions".
- A row with unsaved changes shows **"● Unsaved"** in warning next to its title.

### `#3b` A section screen
- **Header**: "‹ Settings" on the left, which goes back to the list, and the section title in the centre. Going back with unsaved changes keeps the draft and marks the row; optionally, ask "Discard changes?".
- **General**:
  - a logo row with a 44px Upload button;
  - Name and Initials fields, each 48px tall;
  - 44px colour swatches;
  - a hex field.
- **Sign-in page**: a 42px EN / ES control, the Headline and Paragraph fields, and a preview card.
- **Positions**:
  - The hint "Hold ⋮⋮ and drag to reorder", plus a "✓ Saved" notice after each change.
  - A card with 60px rows. Each row has a 44px handle, the name with "role · missing-name warning" underneath, and a caret.
  - **Tapping a row** opens a **bottom sheet** (top radius 20, drag handle, dimmed backdrop) containing:
    - the position name;
    - the English and Español inputs;
    - **ROLE IN AUTO-BALANCE** as 2×2 buttons, each 44px;
    - **Archive** (outlined) and **Save** (primary), both 48px.
  - Below the card: a "New position" field (48px) with **Add**, and the collapsible Archived list with 56px rows and Reactivate buttons.
- **Session packs**: 60px rows with the handle, the sessions badge, the price and a 44px trash button. Below them, the add row with a 48px numeric field, the live price and **Add**.
- The **sticky Discard / Save changes bar** (48px buttons) sits at the bottom of the screen, only while the section has unsaved changes.
- **Touch drag**: the native HTML5 drag-and-drop **does not work with touch**. Use dnd-kit's TouchSensor or PointerSensor, with a long press of about 150 ms or a small distance threshold, and `touch-action: none` on the handle.
  - The lifted row scales to 1.02, gets a `#1d4869` background and a shadow, and the drop target shows an accent line.

## Copy / i18n (new or changed)
- Tabs and list: "General", "Sign-in page", "Positions", "Session packs", plus the list summaries.
- Saving: "Unsaved changes to …", "Discard", "Save changes", "Saved", "Unsaved".
- Positions: "Role in auto-balance", "No role", "Hold ⋮⋮ and drag to reorder", "Drag to reorder, or use the arrow keys", "One name is enough.", "No Spanish name" / "No English name".
- Packs: "{n} sessions", "Between 2 and 50.", "Already in the list.".
- Account: "Appearance" with "Light / Dark / System", and "Language".
- Remove the `move.up` and `move.down` button labels. Keep the move announcement strings for the screen reader.

## Data / API
- **No new endpoints** are needed. Reordering uses the existing endpoints, with the full new order; coverage, rename, archive and reactivate use the per-position endpoints; packs keep the whole-list save.
- **Theme "System"**: store `theme: "light" | "dark" | "system"`, with `system` as the default, in the same place the toggle stores the theme today.

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
  - table header and add row `#0f2131`
  - selected segment and badge `#1d4869`
  - sidebar `#163a55`
- Radii: 6, 8, 10, 12, 20 (sheet), 999.
- Focus: 2px accent outline.
- Icons: Phosphor.

## Screenshots (`screenshots/`)
1. `01-desktop-positions.png`: Positions tab.
2. `02-desktop-packs-unsaved.png`: Session packs tab with the unsaved-changes bar.
3. `03-desktop-general.png`: General tab with the preview.
4. `04-desktop-sign-in.png`: Sign-in page tab, English, with the preview.
5. `05-desktop-account-menu.png`: the account dropdown open.
6. `06-mobile-account.png`: the mobile Account screen.
7. `07-mobile-settings-list.png`: the mobile Club settings list.
8. `08-mobile-positions.png`: the mobile Positions screen.
9. `09-mobile-position-sheet.png`: the mobile position edit sheet.
10. `10-mobile-packs-unsaved.png`: the mobile Packs screen with the save bar.

When a screenshot and this text disagree, follow the text.

## Files
- `Club Settings Upgrade.dc.html`: the interactive mock. Build `#1a`, `#2a`, `#3a` and `#3b`.
- `support.js`: needed to open the mock.
