# Handoff: "Email members" composer redesign

## Overview
This redesigns `DirectoryEmailComposer` (`src/components/directory/DirectoryEmailComposer.tsx`) in `cjgomezr/sea-dragons-web`. It changes three things:
1. **Recipients** become compact chips with a × button. Long lists fold behind a "+N more" chip, because the composer can open with 20 or more people from Groups.
2. **Add recipients inside the composer**, with a member search combobox.
3. **Basic formatting** in the message: bold, italic, links, bulleted and numbered lists. A small toolbar sits above the message, and a **Write | Preview** tab shows the formatting. No images, no tables.

The current behaviour stays:
- the composer still opens as a panel under the Directory header (full screen on mobile);
- the confirm dialog before sending, which now shows the daily quota (50 a day) before and after;
- the existing limits and the email rules in `src/lib/directory/directory-email-rules.ts`.

## Files
- `Email Members Upgrade.dc.html`: the canvas with every state.
  - Desktop: `#1a`–`#1e`.
  - Mobile: `#2a`–`#2e`.
  - Light and dark alternate between frames.
- `Email Composer.dc.html`: the composer itself, fully interactive. Its props are `mode` (`desktop` | `mobile`), `start` (`edit` | `search` | `preview` | `errors` | `confirm`) and `count` (number of recipients). Its logic class contains the markdown parser and the toolbar insertion code, as a reference.
- `support.js`: needed to open the mocks.
- `screenshots/`: see the list below.

These are HTML design references, not production code. Rebuild the composer in the existing component with the tokens in `globals.css`: the mock's `--bg/--panel/--text/--accent…` map one-to-one to `--color-*`. Keep i18n in both `en.ts` and `es.ts`.

## States
| ID | Platform | Theme | State |
| --- | --- | --- | --- |
| 1a | Desktop | Dark | 3 recipients |
| 1b | Desktop | Light | 25 recipients (opened from Groups), searching "ma" |
| 1c | Desktop | Dark | Message in Preview |
| 1d | Desktop | Light | Errors: no subject, message too long (5,240 of 5,000) |
| 1e | Desktop | Dark | Confirm dialog, 25 recipients, quota 41 → 16 |
| 2a–2e | Mobile | Alternating | The same five states |

## Layout — desktop (the panel under the Directory header)
- **Container**: `--color-panel`, a 1px border, radius 12, `--shadow`.
- **Header**: a 36px icon tile (`envelope-simple`, `--seg` fill), the title "Email members" (18px, weight 650), the description "Each member gets their own email from the club's address. Replies come to you." (13.5px, secondary), and a **×** icon button (34px) on the right. It replaces the "Close" text button, matching the icon-only directory actions.
- **Field labels**: mono, uppercase, letter-spacing .08em, 11.5px, secondary ("TO · 3 members", "SUBJECT", "MESSAGE"), the same as the News editor.

### TO (recipients)
- **One bordered box** (min height 40px, radius 10, `--bg` fill) holds the chips and the search input, which wrap together.
  - The border turns accent while the input has focus.
  - Clicking anywhere in the box focuses the input.
- **Chip**: 24px tall, radius 999, `--seg` fill, 4px gap.
  - Contents: an 18px initials avatar (accent fill, mono 8px), the name (12.5px, cut with an ellipsis at 180px max), and a 20px **×** button with `aria-label="Remove {name}"`.
- **Folding**: when there are more than 11 recipients, show the first **10** and a dashed "+N more" chip with `aria-label="Show all {n} recipients"`. Expanding shows all chips and a "Show less" link.
- **"Clear all"**, a text button on the right of the label row, appears when there are 2 or more recipients.
- **Empty**: "No one to email yet. Add members by name." (an info icon, secondary).

### Add by name (combobox)
- An inline input with a `user-plus` icon and the placeholder "Add a member by name". It fills the rest of the line, 200px minimum.
- **ARIA**: `role="combobox"`, `aria-expanded`, `aria-controls` pointing to the listbox, and `aria-autocomplete="list"`.
- **Matching**:
  - case-insensitive and accent-insensitive (NFD with combining marks stripped), on the member's full name;
  - **active members only, and only those not already on the list**;
  - up to 6 results.
- **Listbox**: a popover under the box (radius 10, `--shadow`). Each option is at least 44px tall and shows:
  - a 28px initials avatar;
  - the name with the **matched part in bold**;
  - a meta line (role · first group);
  - "Add" on the right, or "Enter ↵" on the highlighted option.
- **Keyboard**: ↑ / ↓ move, **Enter** adds the highlighted option, **Esc** clears the query, **Backspace** in an empty input removes the last chip. After adding, the query clears and focus stays in the input. A footer line in the listbox lists these keys.
- **No results**: "No members match "{q}"." If every match is already a recipient: "Everyone matching "{q}" is already on the list."
- **Data**: reuse the directory's member list that's already loaded on the page. No new endpoint is needed unless the directory paginates; in that case use the existing search endpoint.

### SUBJECT
- A 40px input, with an "n / 150" counter (mono 12px) on the right of the label row.

### MESSAGE
- A **Write | Preview** segmented tablist (28px) on the right of the label row.
- **Editor box**: radius 10.
  - **Toolbar** (`role="toolbar"`, `--bar` fill), with 32px icon buttons: **Bold** (`text-b`), **Italic** (`text-italic`), **Link** (`link-simple`), a divider, **Bulleted list** (`list-bullets`) and **Numbered list** (`list-numbers`). A mono syntax hint sits on the right ("**bold** · _italic_ · - list").
    - Buttons use `onMouseDown preventDefault`, so the textarea keeps its selection.
    - Shortcuts: **Ctrl/⌘ + B / I / K**.
  - A **textarea** (min height 220px, resizable vertically, 14.5px, line height 1.55), with the placeholder "Write your message…".
  - **Footer bar**: "Bold, italic, links and lists. No images or tables." on the left, and an "n / 5,000" counter on the right. The counter turns text colour above 90% and danger + bold above the limit.
- **Toolbar insertion** (see `fmt()` in the logic class):
  - Bold and italic wrap the selection in `**…**` and `_…_`. With no selection they insert a placeholder ("bold text") and select it.
  - Link turns the selection into `[text](https://)` and selects `https://` so it's ready to type over.
  - The list buttons prefix every selected line with `- ` or `1. `, `2. `…, and replace an existing list marker instead of stacking two.
- **Preview** (`role="tabpanel"`) shows the email as a member receives it:
  - a dashed-rule header with "From **Victoria Seadragons** · replies go to you", "To **{n} members · each gets their own copy**" (or the name when there's only one), and the subject (15.5px, weight 650, or "No subject yet" in secondary);
  - then the body: paragraphs (single line breaks kept), `ul` and `ol` lists, **bold**, *italic* and links in the accent colour;
  - empty: "Nothing to preview yet."

### Footer bar (`--bar` fill, bottom radius)
- On the left, the **quota**: "{remaining} of 50 emails left today" and a 4px bar (success, or warning when fewer than 10 are left).
- An error summary when there are errors: "2 things to fix" (danger).
- **Cancel** (ghost), and **Send to {n}** (primary with a paper-plane icon). Send is disabled when there are no recipients or the recipients exceed the remaining quota.

### Errors (shown after a send attempt, as today)
- **Subject**: "Add a subject." or "Keep the subject to 150 characters (now n)."
- **Message**: "Write a message." or "The message is {n} characters too long. Shorten it to 5,000."
- How errors look:
  - the field border turns danger, with `aria-invalid` and `aria-describedby` pointing at the error;
  - the error line shows a `warning-circle` icon in danger colour;
  - **focus moves to the first invalid field**; if the message is invalid while Preview is open, the composer switches back to Write.
- **Over quota** (warning banner, `role="alert"`): "Only {r} emails left today. Remove {n − r} people or send the rest tomorrow."
- **Server errors**: keep the existing messages, shown as a danger banner above the footer.

### Confirm dialog
A modal over the panel (`role="dialog"`, `aria-modal`, 440px wide, radius 14).
- **Title**: "Send to {n} members?", or "Send to {name}?" for a single recipient.
- **Body**: "Each one gets their own email from Victoria Seadragons with the subject "{subject}". Replies come to you."
- **Quota box** (`--bar` fill):
  - "Emails left today **{before} → {after}** of 50";
  - a split bar with the remaining part in success and the part being used in accent;
  - a note: "The count goes back to 50 tomorrow.", or "After this, only {after} left until tomorrow." when fewer than 10 remain, or "This uses the last emails for today." at 0.
- **Actions**: Cancel, and **Send {n} emails** (primary). While sending, the button shows a spinner and "Sending…", and both buttons are disabled.

### Sent
- The panel body is replaced by a success state:
  - a check circle;
  - "{n} emails sent";
  - "Replies will come to your inbox. {remaining} of 50 emails left today.";
  - **Write another** (clears the subject and message, keeps the recipients), and Close.
- Use `role="status"`.

## Layout — mobile (full-screen sheet, under 768px)
- **Top bar** (56px): × close (44px), "Email members" (17px, weight 650), and **Send** (40px, primary) on the right.
- The description line sits under the top bar. When there are errors, a danger summary sits above the fields: "2 things to fix before sending".
- **Chips**: 32px tall with a 22px avatar and 13.5px text.
  - The × is 30px wide, with an invisible hit area extended around it.
  - Folding keeps **6** chips visible, then "+N more".
- **Search**: a separate 46px input under the chips (16px text, to avoid iOS zoom), with a clear button. Results show **inline** (not as a popover), with 58px rows and a "+" icon.
- **Subject**: 48px tall, 16px text.
- **Message**:
  - the label with the counter on the same line;
  - a full-width Write | Preview control (38px);
  - a toolbar with five 44px buttons;
  - a textarea (min height 240px, 16px text);
  - the hint line below.
- The quota line and bar sit at the bottom of the scroll.
- **Confirm**: a bottom sheet (top radius 20, handle) with the same content as the dialog and 48px buttons.

## Server changes (`/api/v1/directory/email` or the existing send action)
- **Accept markdown** in `message`. Keep the same 5,000-character limit, counted on the raw markdown.
- **Render on the server**:
  - **HTML**: use a strict, small parser such as `marked` with only paragraphs, line breaks, `strong`, `em`, `a`, `ul`, `ol` and `li` enabled (no HTML passthrough, images, tables, headings or code), then **sanitize** it (`sanitize-html` or DOMPurify with an allowlist of those tags plus `href`).
  - **Plain text**: the same content with the markers stripped and links written as "text (url)". Send both versions as multipart.
- **Links**: only `https?://` and `mailto:` become links; anything else stays plain text. Add `rel="noopener noreferrer"` and `target="_blank"`.
- **Email template**: a simple wrapper with the club name in the header, the body at 15px, and the accent colour for links.
- **Quota**: return `remainingToday` together with the composer data (it may already be there) so the footer and the dialog can show it without an extra request. Enforce the quota on the server as today.

## Copy and i18n (new or changed)
- **Labels**: "To", "Subject", "Message", "Write", "Preview".
- **Recipients**:
  - "{n} members", "nobody yet", "Clear all", "+{n} more", "Show all {n} recipients", "Show less", "Remove {name}";
  - "Add a member by name", "No members match "{q}".", "Everyone matching "{q}" is already on the list.", "No one to email yet. Add members by name.".
- **Toolbar**: "Bold", "Italic", "Add link", "Bulleted list", "Numbered list".
- **Message**: "Bold, italic, links and lists. No images or tables.", "Nothing to preview yet.", "No subject yet".
- **Preview header**: "From {club} · replies go to you", "{n} members · each gets their own copy".
- **Quota**: "{r} of 50 emails left today", "Emails left today", the over-quota text, and the three quota notes.
- **Errors**: the error texts above, and "{n} things to fix".
- **Actions**: "Send to {n}", "Send {n} emails", "Sending…", "{n} emails sent", "Replies will come to your inbox.", "Write another".

## Tokens
These map to `globals.css`.

**Dark**
- bg `#0c1a26` · panel `#13283a` · border `#274055`
- text `#e8f0f7` · secondary `#8aa1b5` · soft `#cfdeea`
- accent `#33a1e0` · accent text `#5ab4e8` · on-accent `#0c1a26`
- danger `#f2887a` · warning `#f2ce78` · success `#6fd6b4`
- Values used here that aren't tokens yet: `--seg` `#1d4869`, `--bar` `#0f2131`, `--hover` `#1a3349`.

**Light**
- bg `#eff3f7` · panel `#ffffff` · border `#dee6ed`
- text `#1c3245` · secondary `#5a7086` · soft `#2f4659`
- accent `#1c6ea4` · on-accent `#ffffff`
- danger `#bc3b2e` · warning `#c99a3e` · success `#2e9e86`
- Values used here that aren't tokens yet: `--seg` `#d6e6f2`, `--bar` `#f5f8fa`, `--hover` `#cfdae5`.

**Other**
- Radii: 6, 7, 8, 10, 12, 14, 20, 999.
- Focus: a 2px accent outline.
- Icons: Phosphor.

## Screenshots
1. `01-desktop-dark-3.png`
2. `02-desktop-light-25-search.png`
3. `03-desktop-preview.png`
4. `04-desktop-errors.png`
5. `05-desktop-confirm.png`
6. `06-mobile-light-3.png`
7. `07-mobile-dark-25-search.png`
8. `08-mobile-preview.png`
9. `09-mobile-errors.png`
10. `10-mobile-confirm.png`

The search popover only opens while the input has focus, so it may not appear in screenshots 02 and 07; open the mock to see it. When a screenshot and this text disagree, follow the text.
