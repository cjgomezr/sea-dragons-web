# Handoff: "Invite a member" form redesign

## Overview
This redesigns the Admin's new-member flow in `cjgomezr/sea-dragons-web`:
- `NewMemberScreen` and `NewMemberForm` (`src/components/directory/`), today a separate page at `/directorio/nuevo`;
- `new-member-client.ts` and `src/lib/members/member-invitation.ts`.

**What changes**
1. **It opens as a panel under the Directory header**, the same pattern as the "Email members" composer, instead of a separate page. The `user-plus` header button toggles it. On mobile it opens full screen.
2. **Only name and email are shown up front.** Groups are toggle chips. Country, position, experience, gender and AUF move into a collapsible **"Player details · optional"** section.
3. **Recommended rule change: only name and email are required.** The member fills in the rest after signing in, through the profile's existing "Missing" strip. This needs a server change; see "Validation" below. The mock's **Reglas** tweak (`rules=current`) shows the form with today's rules, where all 8 fields are required, in case the product owner keeps them.
4. **Errors**: a summary at the top with a link to each field, plus the error next to its field. When the email already belongs to a member, the error links to that member's profile.
5. **Invitation preview**: a collapsible view of the email the member will receive.
6. **Result states**: "Invitation sent", or "Added, but the email didn't go out" with **Resend**. They replace `CreatedNotice`.

## Files
- `Invite Member Upgrade.dc.html`: the canvas.
  - Desktop: `#1a` filled, `#1b` errors, `#1c` sent, `#1d` not sent.
  - Mobile: `#2a` empty, `#2b` errors, `#2c` sent.
  - Light and dark alternate between frames. The **Reglas** tweak switches every frame between recommended and current rules.
- `Invite Form.dc.html`: the form itself, fully interactive. Props: `start` (`empty` | `filled` | `errors` | `sent` | `notSent`), `rules` (`recommended` | `current`), `frame` (`panel` | `phone`).
- `support.js`: needed to open the mocks.
- `screenshots/`: see the list below.

These are HTML design references, not production code. Rebuild the flow in the existing components:
- Keep `createMember`, `resendMemberInvitation`, `InvitationResend`, `describeNewMemberIssue` / `describeNewMemberFailure`, the double-submit guard (`isSendingRef`), and `loadGroups` / `loadPositionChoices`.
- Use the tokens in `globals.css`: the mock's `--bg/--panel/--accent…` map one-to-one to `--color-*`.
- Keep i18n in both `en.ts` and `es.ts`.

## Layout
- **Container**: panel background, a 1px border, radius 12 (0 on mobile, where it's full screen), `--shadow`.
- **Header**: a 36px icon tile (`user-plus`), "Invite a member" (18px, weight 650), the lead "They get an email from the club to set a password and sign in.", and a 44px **×** close button.
- **Body** (scrolls; padding 16/20/24; 18px gap between sections):
  1. **Error summary**, only after a failed send. A danger-tinted box with `role="alert"` and `tabIndex=-1`, which gets focus.
     - The title reads "{n} things to fix before sending".
     - Then one link per issue ("Email: This email already belongs to a member."). Each link focuses its field and opens Player details if the field is inside it.
  2. **WHO** (mono uppercase label):
     - **Full name** and **Email** in an auto-fit grid of columns at least 240px wide, so they sit side by side on desktop and stack on mobile.
     - Inputs are 44px tall with 16px text. Email uses `inputMode="email"`.
  3. **GROUPS · {n chosen | none}**, with "Optional" on the right.
     - Toggle chips: 36px tall, radius 999, `aria-pressed`.
     - Off: a + icon and a border. On: `--seg` fill, an accent border, a check icon, weight 600.
     - This replaces the checkbox list from `GroupsField`.
  4. **Player details** (a collapsible card with radius 12):
     - **Header row**: at least 56px tall, `--bar` fill, `aria-expanded`/`aria-controls`.
       - A caret, then the title "Player details · optional".
       - Subtitle: "Leave them empty and {first name} fills them in after signing in." When there's no name yet: "…and the member fills them in…".
       - A badge on the right: "{n} of 6" filled, or "{n} to fix" in danger.
       - Collapsed by default under the recommended rules; open by default under the current rules.
     - **Inside**:
       - **Country**: a native select. An optgroup **"Most common in the club"** comes first: the top 4 countries among the club's members, from a new query, or the club's country as a fallback. Then an optgroup **"All countries"** with the full `COUNTRY_CODES` list, named with `Intl.DisplayNames` in the screen locale and sorted. Don't hard-code the list.
       - **Position**: a select of the club's active positions, as today. Hide it when the club has none.
       - **Gender**: a select, with "🔒 only Admins and the member" next to the label.
       - **Experience**: a 3-option segmented `radiogroup`, 38px tall. Under the recommended rules, tapping the selected option clears it.
       - **AUF registration**, below a dashed divider, with the hint "Both or neither" (or "Required" under the current rules):
         - **Number**: mono, `inputMode="numeric"`;
         - **Expires**: a date input.
  5. **Server error banner** (network, rate limited, forbidden): danger tint, above the preview.
  6. **"What {first name} will receive"**: a collapsible dashed card. Open, it shows:
     - From **Victoria Seadragons** · to **{email}**;
     - the subject "You're invited to Victoria Seadragons";
     - "Hi {first}, {admin name} added you to the club on Seadragons. Set a password to see the calendar, RSVP to trainings and keep your details up to date.";
     - a fake "Set my password" button;
     - "The link works for 7 days. You can resend it from their profile."

     Use the real template copy if it differs.
- **Footer** (`--bar` fill, fixed below the scrolling body):
  - a note on the left: "Only name and email are required." (or "All fields are required.");
  - **Cancel** (ghost);
  - **Send invitation** (primary, `paper-plane-tilt`), which shows "Sending…" with a spinner while sending.
  - The whole `fieldset` is disabled while sending.
- **Mobile**: the same component, full screen. The body is a scroll container (`flex: 1 1 auto; min-height: 0; overflow-y: auto`; with a basis of `0` the body collapses inside the desktop panel, whose height is set by its content) and the footer stays fixed at the bottom.
  - **Important:** don't put `overflow` on the `<fieldset>` itself. A scrolling fieldset doesn't scroll reliably in some browsers, so wrap it in a scrolling `<div>`.

## Result states (they replace the form body)
- **Sent** (`role="status"`):
  - a 48px success check;
  - "Invitation sent to {email}";
  - "{name} shows as Invited in the directory until they sign in. The link works for 7 days and you can resend it from their profile."
- **Not sent** (`invitation: "not_sent"`, `role="alert"`):
  - a warning icon;
  - "{first name} was added, but the email didn't go out";
  - "{name} is in the directory as Invited. Try sending the invitation again; if it keeps failing, check the address.";
  - a primary **Resend invitation** button (using `InvitationResend`).

  After resending, it switches to the sent state with "Invitation sent again to {email}".
- **Actions** in both states: **Invite another**, which resets the form but **keeps the chosen groups** (useful when adding a whole squad), and **Open {first name}'s profile →** (the member record).
- After a successful create, refresh the directory list so the new row appears with the Invited pill.

## Validation
Errors show on submit, as today, and clear on the next edit.

**Recommended rules** (change `listNewMemberIssues` and the server together):
- **Required**: `fullName` (trimmed) and `email` (`looksLikeEmail`).
- **Optional**: `country`, `positionId`, `experienceLevel`, `gender`. When one is sent it must still be valid; keep the `*_unknown` codes.
- **AUF**: both or neither.
  - A number without an expiry date → a new code `auf_expiry_missing`.
  - An expiry date without a number → `auf_number_missing`.
  - Keep `auf_number_too_long` and `auf_expiry_before_joined`.
- **Database**: the new member is created with these columns as `null`; check the `members` columns and constraints in the migrations.
- **Profile**: completing them is already prompted by the profile's "Missing" strip (`contactReminderOf` / profile completeness). Add country, position, experience and gender to that check.
- `positionId` stays optional even when the club offers positions. This is a change from `checkPosition` today.

**Current rules** (if the product owner keeps them): no server change. The details section is open by default and the footer note changes.

**Messages** (English copy; add Spanish):

| Code | Message |
| --- | --- |
| `full_name_missing` | "Add their full name." |
| `email_malformed`, empty | "Add their email so we can send the invitation." |
| `email_malformed`, invalid | "That email doesn't look right. Check for typos." |
| email taken (conflict) | "This email already belongs to a member." plus the link "Open {name}'s profile" (the API should return the existing member's `userId` and name) |
| `auf_number_too_long` | "Keep the AUF number to 20 characters." (use `AUF_NUMBER_MAX_LENGTH`) |
| `auf_expiry_missing` | "Add when this registration expires." |
| `auf_number_missing` (expiry without a number) | "Add the number for this expiry date." |
| `auf_expiry_before_joined` | "This registration has already expired. Use the new expiry date." |
| current rules only | "Choose a country." · "Choose a position." · "Choose a level." · "Choose an option." · "Add the AUF number." · "Add the expiry date." |

**Field errors**: the error text sits under the field with a `warning-circle` icon in danger colour, the border turns danger, and the field gets `aria-invalid` plus `aria-describedby` pointing at the error.

## Server and API
- `POST /api/v1/members`:
  - accept the optional fields as `null` (see Validation);
  - on `EMAIL_TAKEN_REASON`, include `{ existingMember: { userId, fullName } }` so the UI can link to that member.
- **New, for the country select**: `GET /api/v1/club/common-countries` returning the top 4 member countries. Alternatively, fold it into the response that already loads groups and positions.
- **Routing**: keep `/directorio/nuevo` working as a deep link (it opens the directory with the panel open), or redirect it to `/directorio?invite=1`.

## Copy and i18n (new or changed)
- **Header**: "Invite a member", "They get an email from the club to set a password and sign in."
- **Labels**: "WHO", "GROUPS", "{n} chosen", "none", "Optional".
- **Player details**: "Player details · optional", the two subtitle variants, "{n} of 6", "{n} to fix".
- **Country and gender**: "Most common in the club", "All countries", "Choose a country…", "only Admins and the member".
- **AUF**: "AUF registration", "Both or neither", "Number", "Expires".
- **Preview**: "What {first} will receive", plus the preview copy.
- **Footer**: "Only name and email are required.", "Send invitation", "Sending…".
- **Errors**: "{n} things to fix before sending", plus the messages above.
- **Result states**: "Invitation sent to {email}", "Invitation sent again to {email}", the not-sent title and text, "Resend invitation", "Invite another", "Open {first}'s profile", "Open their profile".

## Tokens
These are the same as the email handoff.

**Dark**
- bg `#0c1a26` · panel `#13283a` · border `#274055`
- text `#e8f0f7` · secondary `#8aa1b5` · soft `#cfdeea`
- accent `#33a1e0` · accent text `#5ab4e8`
- danger `#f2887a` · warning `#f2ce78` · success `#6fd6b4`
- Values used here that aren't tokens yet: `--seg` `#1d4869`, `--bar` `#0f2131`, `--hover` `#1a3349`.

**Light**
- bg `#eff3f7` · panel `#ffffff` · border `#dee6ed`
- text `#1c3245` · secondary `#5a7086`
- accent `#1c6ea4`
- danger `#bc3b2e` · warning `#c99a3e` · success `#2e9e86`
- Values used here that aren't tokens yet: `--seg` `#d6e6f2`, `--bar` `#f5f8fa`.

**Other**
- Radii: 7, 8, 9, 10, 12, 999.
- Focus: a 2px accent outline.
- Icons: Phosphor.
- Set `color-scheme` per theme so the date picker matches.

## Screenshots
1. `01-desktop-filled.png`
2. `02-desktop-errors.png`
3. `03-desktop-sent.png`
4. `04-desktop-not-sent.png`
5. `05-mobile-empty.png`
6. `06-mobile-errors.png`
7. `07-mobile-sent.png`

The screenshots use the recommended rules. When a screenshot and this text disagree, follow the text.
