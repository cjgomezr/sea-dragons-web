# Handoff: Teams builder redesign

## Overview
This redesigns the team builder in `cjgomezr/sea-dragons-web` (the files under `src/components/teams/*` and the `.team-*` styles in `globals.css`).

What changes:
- **Team name and colour can be edited.** They become **club-level defaults**: chosen once and used for every event from then on.
- **Avatars show the player's photo**, with a ring in the team colour.
- **"Switch" and "Remove" become icon buttons.**
- **Mode control plus "Balance teams" become one Auto-balance button**, with a status line next to it.
- **Each team shows its position coverage**, and warns when there is no goalkeeper.
- **Mobile uses tabs**: Team A · Team B · Bench, with Save and Publish fixed at the bottom.

What stays the same:
- the draft, the save and the publish flow, including the publish confirmation and the notify count;
- the swap suggestion;
- drag and drop on desktop;
- `aria-live` move announcements, the event picker and the beforeunload warning;
- i18n in both `en.ts` and `es.ts`.

The Teams screen is only for Admins and Coaches. Players don't see it. A "you're playing in…" card on the dashboard is planned for the dashboard redesign and is **out of scope** here.

## What to build
In `Teams Upgrade.dc.html`: **`#1a`** for desktop and **`#2a`** for mobile (under 768px). The mock's data is invented and its photos come from pravatar.cc.

## About the design files
These files are design references made in HTML, not production code. Rebuild them inside the existing components and keep their logic:
- `TeamBuilderPanel`, `TeamLists`, `TeamPlayerRow`, `TeamSummary`, `TeamActions`;
- `team-draft`, `use-team-builder`;
- `MemberAvatar`.

## Fidelity
The mock is high fidelity, built on the dark tokens in `globals.css`. Use the CSS variables; the light theme should follow the same layout with the light tokens.

## Data / API changes
**1. Club-level team labels**
- Add `club_team_labels` (or two columns in club settings): `{ a: { name, color }, b: { name, color } }`.
- The defaults are today's `DEFAULT_TEAM_LABELS` (Team Kelp `#1C6EA4`, Team Tide `#C99A3E`).
- New builders and auto-balance read their `teams` from the club labels, not from the constant.
- Add an endpoint `PATCH /api/v1/club/team-labels`, for Admin and Coach, that validates:
  - the name: trimmed, 1–24 characters;
  - the colour: one of the allowed swatches;
  - **the two colours are different**.

**2. Published splits keep a snapshot**
- Every saved or published split already stores `teams`. Keep it that way: a published split keeps the name and colour it was published with.
- Editing the labels updates the club defaults **and** the open draft's labels. Already published splits don't change, unless they are republished.

**3. Player photos**
- Add `photoUrl` to `RosterEntry` (squad, builder and balance responses), following the same visibility rule as the directory and attendance.
- Pass it to `MemberAvatar`; today `TeamPlayerRow` hard-codes `photoUrl={null}`.

**4. Colour names**
- The swatches all map cleanly to `nameTeamColor`.
- Gold `#C99A3E` reads as yellow or orange; consider adding `gold` and `navy` to `TeamColorName`, so the "Playing in …" card names those colours properly. Otherwise keep them as they are.

## Bib colour swatches
| Name | Hex | Text or check on top |
| --- | --- | --- |
| Red | #D64545 | white |
| Orange | #E07B2E | dark |
| Gold | #C99A3E | dark |
| Yellow | #E8C547 | dark |
| Green | #3E9B5F | white |
| Teal | #2A9D9A | white |
| Blue | #1C6EA4 | white |
| Navy | #2B3F7A | white |
| Purple | #7A5BC4 | white |
| Pink | #D9669A | white |
| Black | #2B2F36 | white |
| White | #F2F4F6 | dark |

The other team's colour is **disabled**: 35% opacity, a `prohibit` icon, and the label "{Colour} (used by {team})".

## Desktop `#1a`
**Header**
- An eyebrow ("TEAMS") and an H1 ("Sat 17 Oct · Scrimmage", 26px).
- On the right, **Save** (secondary, 40px). When there are changes it adds a warning dot and "Unsaved".
- Then **Publish** (primary, with a `paper-plane-tilt` icon).

**Toolbar**
- The event `select`, as today, with the label "Event".
- On the right:
  - a mode status, "Auto-balanced" (`scales` icon) or "Edited by hand" (`hand` icon), in secondary;
  - the **Auto-balance** button: outlined in the accent colour, 36px tall, with a `scales` icon. It replaces both the Manual/Auto segment and "Balance teams".
- Moving a player by hand still switches the mode to manual (RF-5).

**Publish confirmation**: inline, as today. It shows a panel with an accent border, the text "Publish teams? {n} players will be notified which team they're on.", Cancel, and Publish.

**Notices**: one line, tinted with the success colour, with a check icon. Examples: "Teams balanced and saved", "Saved — not published yet", "Published · {n} players notified", "Team updated · used for every event from now on".

**Totals**
- A panel showing "{Team A} {sum}" on the left and "{sum} {Team B}" on the right.
- In the middle, the gap status:
  - "Even", with a check in success, when the gap is ≤ 1;
  - "{gap} apart", with a warning icon in warning, otherwise.
- An 8px split bar, sized by `flex: sum`, in each team's colour.

**Team columns** (two equal columns)
- **Card**: panel background, border, radius 12, and a 4px strip in the team colour along the top.
- **Header**:
  - a 22px colour swatch;
  - the name (17px, weight 700) with "{n} players · avg {x}" underneath;
  - a 34px **edit** icon button (`pencil-simple`), labelled "Edit {team} name and colour".
- **Coverage chips**, 24px pills on the background colour: `GK n` (hand-palm icon), `DEF n` (shield), `ATT n` (lightning).
  - If the team has players and no goalkeeper, the GK chip becomes **"No goalkeeper"**: a warning icon on a background tinted 18% with the warning colour, and text in the warning colour.
  - Use the existing coverage data.
- **Player row**
  - Grid `36px | 1fr | 40px | auto`, minimum height 48px; hover background `#16304a`; draggable.
  - **Avatar**: 34px, with a **2px ring in the team colour**, showing the photo or the initials.
  - **Name**: 14.5px, weight 600, with an ellipsis if it's too long. Underneath, the position in mono 11.5px.
  - **OVR**: mono, 14px, bold. When the player isn't rated, show "—" in secondary.
  - **Actions**: icon buttons of 32px.
    - **Switch** (`arrows-left-right`), labelled "Move {player} to {other team}".
    - **Remove** (`x`, turns danger red on hover), labelled "Take {player} off {team}".
- **Empty team**: "Drag players here or use \"Add\" on the bench."

**Edit team popover** (anchored top-right in the column header, 320px wide)
- Title "Edit team".
- **Name** input, 24 characters max.
- **Bib colour**, followed by "· {colour name}". A 6×2 grid of 36px circles.
  - The selected colour shows a 2px ring and a check.
  - The other team's colour is disabled.
- The hint "The crossed one is the other team's colour.".
- An info line: "Used for every event from now on. Teams already published keep their colours."
- **Cancel** and **Apply**. Apply is disabled while the name is empty.
- **Behaviour**: Esc closes it; focus moves to the name field when it opens and returns to the edit button when it closes.

**Swap suggestion**
- Panel background, a dashed accent border and a `lightbulb` icon in the warning colour.
- The text: "**Suggestion:** swap {A} ({team A}) with {B} ({team B}) to bring the gap down to {x}."
- A **Swap** button (secondary).

**Bench** (two columns: "AVAILABLE · GOING" and "MAYBE", each with its count)
- Rows use the same grid as team rows, with a 32px avatar and no ring.
- Actions: one **Add** button per team, 30px tall, each with a 9px dot in that team's colour and the team's short name ("Kelp", "Tide"), and the label "Add {player} to {team}".
- Empty texts: "Everyone who said yes is on a team." and "No maybes.".

## Mobile `#2a`
**Header**
- The eyebrow and the title (20px).
- A 44px outlined **Auto-balance** icon button.
- The totals: both sums, the gap status, and a 6px bar.

**Tabs**: three 40px tabs, **{Team A short name} · {Team B short name} · Bench**. Each tab has a colour dot and a count. The selected tab gets a `#1d4869` background.

**Team tab**
- **Team card**:
  - the 4px colour strip;
  - the name and "n players · avg";
  - a 44px edit button;
  - the coverage chips (26px).
- **Rows**, at least 58px tall:
  - a 38px avatar with the team ring;
  - the name, up to 2 lines;
  - underneath, "{position} · OVR x.x" or "Not rated";
  - 44px Switch and Remove icon buttons.

**Bench tab**
- Both lists.
- Each row has 44px **Add** buttons, one per team: a 16px dot in the team colour with a `+`.

**Fixed bottom bar**: **Save** (with the unsaved dot) and **Publish**, both 48px. The top border turns warning-tinted while there are unsaved changes.

**Sheets** (top radius 20, with a dimmed backdrop):
- **Edit team**: a 48px name input with 16px text, 44px swatches, the info line, and Cancel / Apply.
- **Publish teams?**: the same confirmation as on desktop.

**Note**: drag and drop doesn't work with touch; the buttons are the main way to move players, as today.

## Copy / i18n (new or changed)
- Team editing:
  - "Edit team", "Name", "Bib colour"
  - the colour names: Red, Orange, Gold, Yellow, Green, Teal, Blue, Navy, Purple, Pink, Black, White
  - "The crossed one is the other team's colour."
  - "Used for every event from now on. Teams already published keep their colours."
  - "{Colour} (used by {team})"
  - "Team updated · used for every event from now on"
- Mode and balancing:
  - "Auto-balance", "Auto-balanced", "Edited by hand"
  - "Even", "{x} apart"
- Coverage: "GK / DEF / ATT {n}", "No goalkeeper".
- Player row:
  - "Move {player} to {team}", "Take {player} off {team}", "Add {player} to {team}"
  - "Not rated"
- Bench and mobile: "Bench", "AVAILABLE · GOING".
- **Remove**: `teams.mode.manual`, `teams.mode.auto` and the visible "Switch" / "Remove" button texts. Keep the accessible labels.

## Tokens
- Core colours:
  - panel `#13283a`
  - background `#0c1a26`
  - border `#274055`
  - text `#e8f0f7`
  - secondary `#8aa1b5`
  - accent `#33a1e0`, accent text `#5ab4e8`
  - success `#6fd6b4`
  - warning `#f2ce78`
  - danger `#f2887a`
- Values used here that aren't tokens yet:
  - hover `#16304a`
  - row line `#22394d`
  - muted `#5a7086`
  - selected tab `#1d4869`
- Radii: 7, 8, 10, 12, 20 (sheet), 999.
- Icons: Phosphor.

## Screenshots (`screenshots/`)
1. `01-desktop-builder.png`: the full builder.
2. `02-desktop-edit-team.png`: the edit-team popover.
3. `03-desktop-publish-confirm.png`: the publish confirmation.
4. `04-mobile-team-tab.png`: a team tab on mobile.
5. `05-mobile-bench-tab.png`: the bench tab with the Add buttons.
6. `06-mobile-edit-team.png`: the edit-team sheet on mobile.

When a screenshot and this text disagree, follow the text.

## Files
- `Teams Upgrade.dc.html`: the interactive mock. Build `#1a` and `#2a`.
- `support.js`: needed to open the mock.
