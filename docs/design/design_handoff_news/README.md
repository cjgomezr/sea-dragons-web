# Handoff: News redesign (feed, post, publish/edit)

## Overview
This is a redesign of the News section of `cjgomezr/sea-dragons-web`, under `src/components/news/*` and `src/lib/news/*`. It adds five things:
- **Cover images.** They are optional. A post without one falls back to a background for its category.
- **A featured post** at the top of the feed. It is either the **pinned** post or, when nothing is pinned, the newest one.
- **Thumbnails** on every row of the feed.
- **Markdown** in the body, with a formatting toolbar and **Write / Preview** tabs.
- **Pinning**: one post can be pinned at a time, for 1, 2 or 4 weeks or until it is unpinned.

## What to build
Everything to build is in `News Upgrade.dc.html`:
- **Section 2, feed `#2a`**: the featured card from 1a with the 1b-style list underneath, plus pinning.
- **Section 2, publish/edit `#2b`**: the 1e form plus the pin option. Editing uses the same form, filled in with the post.
- **Section 1, post screen `#1c`**: the cover on top with a reading column underneath. `#1d` is an alternative with a side column. Build 1c unless the product owner says otherwise.
- **Section 2, mobile (under 768px) `#2c`, `#2d`, `#2e`**: the feed, the post screen and the publish/edit form on a phone.

The rest of section 1 (1a, 1b, 1e, 1f) is exploration. Don't build it.

## About the design files
These files are **design references made in HTML**, not production code. Rebuild them inside the existing Next.js app using its own pieces:
- the `translate()` keys, adding keys to both `en.ts` and `es.ts`;
- `NewsCategoryLabel`, `AudienceField`, `NewsAttachmentsField` and `NewsAttachmentList`;
- the v1 API and the existing incremental feed and `recordNewsVisit`.

To view the mock, open `News Upgrade.dc.html` in a browser. It needs `support.js` and `image-slot.js` next to it. The photo boxes are drag-and-drop placeholders that only exist in the mock, and the sample data is invented.

## Fidelity
The mock is **high fidelity**, built on the dark-theme tokens in `src/app/globals.css`. Use the CSS variables, not the hex values. The light theme should follow the same layout with the light tokens. Use the app's own font tokens.

## Screens

### Feed (`#2a`) — `NewsFeedScreen.tsx`, `NewsFeedRow.tsx`
**Header**
- Left: the eyebrow `news.eyebrow` (mono, 11px, uppercase) and the `news.title` H1 (28px, weight 700).
- Right: the primary **+ Publish** button. It only shows when `canPublish`.

**Featured card**
- Layout: a grid with columns `1.25fr | 1fr`, panel background, 1px border, radius 10.
  - When the post is pinned, the border is the accent at 45%.
- Left column: the cover image, at least 300px tall, `object-fit: cover`. Without a cover, use the category fallback (described below) with an 88px icon.
- Right column, 24px padding, from top to bottom:
  1. A status row:
     - Pinned: a filled `push-pin` icon in the accent colour, the text "Pinned · until {date}" (or just "Pinned" when it has no end date), and an **Unpin** ghost button.
     - Not pinned: a mono "LATEST" label and a **Pin** ghost button.
     - Both buttons only show to people who can manage posts.
  2. The meta row: category label, a "New" dot if unread, then "{relative time} · {author}".
  3. The title, 24px, weight 700. It is the link to the post.
  4. The excerpt, 15px, in `--color-text-soft`.
  5. A footer with "Read post →" and the attachment count.

**List** (everything except the featured post, newest first)
- Above it, a mono label: "LATEST" when a post is pinned, "EARLIER" when not.
- Each row is a grid of `88px | 1fr | auto`, with a 16px gap. It has 10px padding and radius 10, and its background turns `--color-panel` on hover.
  - First column: an 88×88 thumbnail with radius 8 and a 1px border. Without a cover, it shows the category fallback with a 32px icon.
  - Second column, three lines:
    - the meta row: category, unread dot, "time · author" (no wrapping), and a paperclip with the attachment count;
    - the title, 16.5px, weight 650;
    - one line of excerpt, cut off with an ellipsis.
  - Third column: a 34px **pin** icon button, for managers only.
- Clicking pin opens an inline strip under that row:
  - "Pin to the top for" with a segmented control: **1 week · 2 weeks · 4 weeks · Until I unpin**.
  - A **Cancel** link.
  - If a post is already pinned, a warning line: "Replaces the post pinned now."
- Keep **Load more** and the existing incremental-load and focus behaviour.

**Unread**: a 7px accent dot, written out as "New" on the featured card. It comes from the existing seen and unread logic.

### Post (`#1c`) — `NewsPostScreen.tsx`
- From top to bottom:
  1. A back link.
  2. The cover, full width of the content, about 340px tall, radius 10. If the post has no cover, show the category fallback at the same height.
  3. A reading column, max 680px, centred, containing:
     - the category and the audience in secondary text;
     - the H1 title, 34px;
     - a byline row: avatar, author, "Published … · Edited …", and the **Edit** and **Withdraw** icon buttons, which keep the `NewsPostActions` logic;
     - a 1px rule;
     - the body as **rendered markdown**;
     - the attachments, as cards with a file-type icon, the name, the size and a download icon. This is `NewsAttachmentList` with a new look.
- Markdown body styles:
  - paragraphs 16px / 1.65 in `--color-text-soft`;
  - `#` → 23px, `##` → 19px, `###` → 16.5px, all weight 700 in `--color-text`;
  - lists with a 22px indent;
  - blockquote with a 3px accent left border, italic, 17px;
  - links in the accent colour;
  - inline code in mono on `#1a3349`;
  - images full width, 300px tall in the mock, radius 8, with an optional caption (13px, secondary).

### Publish / edit (`#2b`) — `NewsPublishForm.tsx`, `NewsPublishScreen.tsx`, `NewsEditScreen.tsx`
A single column, max 720px. Fields in this order:
1. **Cover photo · optional**
   - Empty: a 160px banner in the category fallback, with a large category icon on the right. It reads "No cover photo · The {category} background is used instead." and has an **Add cover photo** button.
   - Filled: a 220px image with the hint "Shown in the feed and at the top of the post. Landscape works best." and a **Remove cover** link.
   - Uploads go through the same upload flow as attachments: a new kind, `cover`.
2. **Category**: a segmented control (Announcement · News · Document), each option with its colour dot. The active option has a `#1d4869` background. It replaces the current `<select>`.
3. **Title**: 44px tall, with a mono counter "n / 120" (`NEWS_TITLE_MAX_LENGTH`).
4. **Body editor**: one bordered box, radius 10, with three parts.
   - **Top bar**, background `#0f2131`:
     - Left: tabs **Write | Preview**. The active tab has a 2px accent underline.
     - Right, Write tab only, the toolbar: Bold, Italic | Heading, Bulleted list, Numbered list, Quote | Link, Image. The buttons are 32px icon buttons; Phosphor icons `text-b`, `text-italic`, `text-h`, `list-bullets`, `list-numbers`, `quotes`, `link`, `image`.
   - **Write**: a textarea in mono 14px / 1.7, at least 300px tall.
     - The toolbar wraps the selection: `**`, `*`, `[text](https://)`.
     - It can also add a prefix to each selected line: `## `, `- `, `1. `, `> `.
     - It keeps the selection, and the buttons use `onMouseDown` with `preventDefault` so the textarea keeps focus.
     - **⌘/Ctrl+B** and **⌘/Ctrl+I** work in the textarea.
     - The Image button uploads a picture and inserts `![caption](url)`. In the mock it only inserts the placeholder text.
   - **Preview**: the same markdown renderer as the post screen. An empty body shows "Nothing to preview yet."
   - **Footer**: "Markdown supported · ⌘B bold · ⌘I italic" and a **Formatting help** link.
   - Replace `news.publish.bodyHint`, which currently says "Plain text", with the new markdown wording.
5. **Pin box** (new): a bordered box. When pin is on, its border and background use the accent tint.
   - A switch labelled "Pin to the top of the feed" with the hint "It stays as the featured post. Everything else is listed newest first."
   - When the switch is on:
     - the duration segmented control (1 week · 2 weeks · 4 weeks · Until I unpin);
     - the line "Unpins automatically on {date}." or "Stays until you unpin it.";
     - if another post is pinned, the warning "Replaces the post pinned now: “{title}”".
   - Show this box only to people who can pin.
6. **Who can see it**: keep `AudienceField` with its rules. The mock shows it as radios plus group chips.
7. **Attachments**: keep `NewsAttachmentsField`, restyled as file rows with a dashed **Add files** area.
8. **Publish** (primary)
   - It is disabled until there is a title, a body and a valid audience.
   - After success it shows "Published and pinned until {date} · {audience} notified".
   - Keep the double-submit guard and the wait for uploads.

### Mobile (under 768px)
Touch targets are at least 44px. Use the same data and rules as on desktop.

**`#2c` Feed**
- **Header**: the eyebrow and "Club feed" (26px). On the right, a 44px primary icon button (+) for Publish.
- **Featured card**: full width minus 16px of margin on each side, radius 12.
  - The cover is 190px tall, or the category fallback with a 64px icon.
  - If the post is pinned, a "Pinned" pill sits over the top-left corner of the image. It doesn't block taps (`pointer-events: none`).
  - Under the image, 14–16px of padding, then the meta row (category, unread dot, time · author), the title (20px, bold) and a 2-line excerpt.
- **List rows**:
  - The grid is `72px | 1fr`, with a 12px gap and 10px × 16px padding.
  - The thumbnail is 72×72, radius 8.
  - Next to it: the meta row (category, dot, time, attachment count) and the title (15.5px, weight 650, up to 2 lines). There's no excerpt on mobile.
  - There's **no pin button per row**. On mobile you pin from the post's ⋯ menu or while publishing.
- **Load more**: full width, 46px tall.

**`#2d` Post**
- **Top bar**: back (44px), the category name in the centre, and ⋯ (44px).
- Then the cover, full-bleed and 220px tall.
- Then the content, with 18px of padding:
  - the audience line;
  - the title (26px);
  - the byline: avatar, name and dates;
  - the markdown body (inline images 200px tall);
  - the attachment rows, at least 56px tall.
- **⋯ bottom sheet**: Edit post · Pin to top (it opens the duration picker: 1 week, 2 weeks, 4 weeks, until unpinned) · Withdraw (in danger red) · Cancel.
  - The rows are at least 52px tall. The sheet has a dimmed backdrop, top radius 20 and a drag handle.

**`#2e` Publish / edit**
- **Top bar**: Cancel on the left, "New post" (or "Edit post") in the centre, and a primary **Publish** button on the right, 36px tall.
  - The Publish button is disabled until the form is valid. After success it changes to "✓ Posted".
- Under the bar, the form scrolls. In order:
  - **Cover**: a 140px fallback banner with an "Add cover photo" button (40px) in the bottom-left. Once a photo is chosen, it is 180px tall with a "Remove cover" link.
  - **Category**: three equal segments, 40px tall.
  - **Title**: 48px tall, **16px font** so iOS doesn't zoom in.
  - **Body editor**:
    - Write and Preview tabs, full width, 44px.
    - The toolbar is its own row of 40px buttons that **scrolls sideways**.
    - The textarea is at least 260px tall.
    - The same "Markdown supported · Formatting help" note sits underneath.
  - **Pin box**: the label on the left and a 44×26 switch on the right. When it's on, the duration control shows (it scrolls sideways if it doesn't fit), plus the unpin date and a warning if it will replace another pinned post.
  - **Who can see it**: radio rows 44px tall, and group chips 9px × 14px.
  - **Attachments**: a dashed "Add files" button, 52px tall.

## Category fallback (no cover)
| Category | Label background | Fallback gradient | Icon (Phosphor) | Icon colour |
| --- | --- | --- | --- | --- |
| announcement | `--color-warning` 28% over panel | `linear-gradient(135deg, warning 30% over panel, panel 78%)` | `megaphone-simple` | warning |
| news | `--color-accent` 22% over panel | `linear-gradient(135deg, accent 32% over panel, panel 78%)` | `newspaper` | accent |
| document | `--color-success` 22% over panel | `linear-gradient(135deg, success 26% over panel, panel 78%)` | `file-text` | success |

- Draw the icon at about 0.35–0.65 opacity, with the size listed under each screen.
- Label text stays `--color-text`, the existing contrast rule in `.news-category`.
- Document gets its own green so the three categories can be told apart. Today it reuses the accent.

## Data / API changes
- `news_posts.cover_upload_id` (nullable). The cover is uploaded like an attachment; the feed item and the post detail return `coverUrl | null`.
- `news_posts.pinned_until` (timestamptz, nullable) plus `pinned` (bool), or a `pinned_at` column. A post counts as pinned if `pinned` is true and `pinned_until` is null or still in the future.
  - **Only one post per club** can be pinned. Pinning another post unpins the previous one in the same transaction.
  - Write an audit entry for pin and unpin.
  - Endpoints: `POST /api/v1/news/{id}/pin {until: ISO | null}` and `DELETE /api/v1/news/{id}/pin`.
  - The pin can also be set when publishing or editing, through `pin: {until} | null`.
  - Pinning needs the same permission as managing posts (`canManage`).
- Feed response: add `pinned: NewsFeedItem | null`, filtered by audience like everything else. The first page returns it; `posts` stays newest-first and leaves out the pinned post. If the pinned post isn't visible to the reader, return `null`, so the newest post becomes the featured one.
- Excerpt: build it from the body with **markdown stripped**: no `#`, `*`, links reduced to their text, images removed.
- Markdown rendering:
  - Use `react-markdown` with `remark-gfm`, or an equivalent, with **raw HTML disabled** and the result sanitised.
  - Only allow `http(s):`, `mailto:` and `#` links.
  - The body is still stored as text, so existing posts render unchanged, and their line breaks are kept by treating single newlines as `<br>` (`remark-breaks`).
- Inline images need an upload endpoint that returns a URL. They go through the same storage and permissions as attachments.

## Tokens (dark, `globals.css`)
- Core colours:
  - `--color-background` `#0c1a26`
  - `--color-panel` `#13283a`
  - `--color-border` `#274055`
  - `--color-text` `#e8f0f7`
  - `--color-text-secondary` `#8aa1b5`
  - `--color-text-soft` `#cfdeea`
  - `--color-accent` `#33a1e0`, hover `#5ab4e8`
  - `--color-on-accent` `#0c1a26`
  - `--color-success` `#6fd6b4`
  - `--color-warning` `#f2ce78`
  - `--color-danger` `#f2887a`
- Values used here that aren't tokens yet:
  - hover background `#1a3349`
  - editor bar `#0f2131`
  - selected segment `#1d4869`
  - dashed border `#3a5670`
- Radii: 6 (segments), 8 (controls, thumbnails), 10 (cards, editor, covers), 999 (pills).
- Focus: `:focus-visible` 2px accent outline.
- Icons: Phosphor, regular and fill. Use the app's icon set if it has one.

## Screenshots (`screenshots/`)
1. `01-feed-pinned.png`: the feed with a pinned announcement as the featured post.
2. `02-feed-pin-duration.png`: the inline duration picker on a list row.
3. `03-feed-no-pin.png`: the feed with nothing pinned, so the newest post is featured.
4. `04-publish-write.png`: the form in the Write tab, with the pin switch on and no cover (the category fallback).
5. `05-publish-preview.png`: the same form in the Preview tab.
6. `06-post-open-1c.png`: the post screen to build.
7. `07-post-open-1d.png`: the side-column alternative for the post screen.
8. `08-mobile-feed.png`: the mobile feed, with a pinned post featured.
9. `09-mobile-post.png`: the mobile post screen.
10. `10-mobile-post-actions.png`: the ⋯ bottom sheet with Edit, Pin and Withdraw.
11. `11-mobile-publish-write.png`: the mobile publish form in the Write tab, with the toolbar.
12. `12-mobile-publish-preview.png`: the mobile publish form in the Preview tab.

The empty photo boxes in the screenshots stand for the real cover images. When a screenshot and this text disagree, follow the text.

## Files
- `News Upgrade.dc.html`: the interactive mock. Its logic class contains the markdown renderer and the toolbar insert logic, as reference.
- `support.js` and `image-slot.js`: needed to open the mock.
- `screenshots/`: the images above.
