# Handoff: Profile redesign (own profile + member record)

## Overview
This redesigns two screens in `cjgomezr/sea-dragons-web`:
- `ProfileScreen` (`src/components/account/*`): the member's own profile.
- `MemberRecordScreen` (`src/components/directory/MemberRecord*`): the Admin's record of another member.

**One layout serves three viewers.** The header and cards are the same; what each viewer sees and can edit changes.
- **Me**: the member looking at their own profile.
- **Admin**: opened from the directory.
- **Committee**: read-only. ⚠️ This is new: today the record is Admin-only, so **confirm this with the product owner**.

**Main changes**
- **Read first, then edit.** Data shows as a read-only record, not as an always-open form. Each card has its own **Edit**, with Save and Cancel inline, and saves independently.
- **Hero header**: photo, name, role, position, level and country, plus membership and AUF status chips.
- **Missing data at the top, actionable.** It replaces `ContactReminderNotice` in the profile.
- **Admin tools**: contact icon buttons, an "AUF pending" strip with **Verify**, and a ⋯ menu for role, fee waiver, resending the invitation and deactivating.

## What to build
In `Profile Upgrade.dc.html`:
- **`#1a`** is desktop and **`#2a`** is mobile (under 768px).
- The **"Ver como"** switch toggles Me / Admin / Committee in both frames.

## About the design files
These are HTML design references, not production code. Rebuild them in the existing app and keep:
- **Validation and saving:** `saveOwnProfile`, `validateFullName`, `contactIssuesOf`, `saveMemberRecord`, `verifyMemberRecordAuf`.
- **Rules:** the offered and retired positions, the guardian proposal (`emergencyContactProposal`), the guardian-consent notice on date of birth, and the rule that an untouched AUF is never sent.
- **Admin components:** `MemberRoleControl` (with its confirm step), `MembershipWaiverControl`, `MemberStatusControl`, `InvitationResend`.
- **i18n** in both `en.ts` and `es.ts`.

## Fidelity
The mock is high fidelity, built on the existing dark tokens. Use CSS variables; the light theme should follow the same layout with the light tokens.

## Visibility matrix
| Card | Me | Admin | Committee |
| --- | --- | --- | --- |
| Header chips (membership, AUF) | ✓ | ✓ | membership only (no AUF chip) |
| Contact icon buttons (email, call, emergency) | — | ✓ | ✓ |
| ⋯ menu | — | ✓ | — |
| Missing-data strip | ✓ | — | — |
| AUF pending strip + Verify | — | ✓ (only while unverified) | — |
| About: name, country, position, experience | edit | read | read |
| About: gender (🔒 "only you") | edit | **hidden** | **hidden** |
| Contact: phone, email, emergency contact | edit | edit | read |
| AUF registration | propose/edit while unverified; read once verified | edit | **hidden** |
| Club record: date of birth, joined (🔒 Admin) | — | edit | — |
| Membership | read + "Payments" link | read (waive via ⋯) | read |
| Attendance | ✓ | ✓ | ✓ |
| Groups | read | edit | read |
| Evaluation | the private notice, or their own if visible (today's rule) | read + "Open" | **hidden** |
| Role request | ✓ | — (in the ⋯ menu) | — |

## Layout: desktop `#1a`
The page container is about 1080px wide.
- **Staff only:** a "← Directory" link at the top.

**Header card**
- Radius 14, `linear-gradient(135deg, #163a55, panel 70%)`.
- **96px photo** (`MemberAvatar`) with a 3px ground ring and a 2px accent ring.
  - **Me:** a 32px accent camera button at the bottom right, which opens the existing `ProfilePhoto` flow.
- **Name** (H1, 28px, 700) and a role pill (`#1d4869`).
- "Position · Experience · Country" (14.5px, soft).
- **Chips**, each 26px tall:
  - Membership: "Membership active" (success tint) or "Expired" (danger tint).
  - AUF: "AUF verified" (`seal-check`, success) or "AUF pending" (`seal-question`, warning).
  - "Member since {month year}" (secondary).
- **Staff, on the right:** 40px icon buttons for **email**, **call** and **emergency contact** (the emergency button has a danger icon and a border at 50% danger).
- **Admin only:** a **⋯** button that opens a 260px menu:
  - Change role (shows the current role)
  - Waive membership fee
  - Resend invitation (only when the account is `incomplete`)
  - A rule, then **Deactivate member** in danger red.

  The menu uses the same dismissal rules as the account menu.

**Strips** (under the header)
- **Me, when data is missing:** warning tint.
  - A 34px conic progress ring showing the completion percentage.
  - "Your profile is almost complete. Missing:".
  - One chip button per missing item, for example "+ Emergency contact". It opens that card in edit mode and focuses its first input.
  - Hidden when the profile is complete. Reuse `contactReminderOf`.
- **Admin, while the AUF is unverified:** warning tint, "{name} added AUF **{number}** (expires {date}). Check it and verify." and a primary **Verify AUF** button.
- **Deactivate confirm**, inline: danger tint, "Deactivate {name}? She won't be able to sign in. Her history stays and you can reactivate her later.", **Cancel**, and an outlined **Deactivate** button in danger red.
- **Success notice** after any save: "About saved", "Contact saved", "AUF verified", and so on. Use `role="status"`.

**Grid**: `1fr | 340px`, with a 16px gap.

**Left column**
- **About**
  - **Read mode:** a `dl` grid in 2 columns, with a 12px secondary label and a 14.5px value. Gender carries a lock icon (Me only).
  - **Edit mode (Me):**
    - the card border turns accent;
    - fields in a 2-column grid: Full name (full width), Country (select), Position (select, with the club's positions; a retired one is marked), Experience (a 3-option segmented control: Beginner, Intermediate, Advanced), and Gender (select, labelled "🔒 only you");
    - **Cancel** and **Save** at the bottom right.
- **Contact**
  - **Read mode**, two halves:
    - **Phone**: a 34px tile, the number in mono, and the email underneath.
    - **Emergency contact**: a danger-tinted tile, "{name} · {relationship}" and the phone in mono. When empty: "Not added yet" in warning.
  - **Edit mode:**
    - Phone;
    - an "EMERGENCY CONTACT" label;
    - Name and Relationship side by side;
    - Their phone.

    Keep the guardian prefill.
- **AUF registration** (Me and Admin)
  - Three cells: Number (mono), Expires ("{date} · in {n} days" in warning when under 90 days away), and Status (Verified or Pending).
  - **Me:** a note underneath. "An Admin will check it. Until then it shows as pending." or "Verified by the club. Ask an Admin to change it."
  - **Admin:** an "🔒 Admin" label next to the title.
- **Club record** (Admin only, "🔒 Admin"): Date of birth ("{date} · {age}") and Joined.
  - Editing it keeps the existing guardian-consent warning.

**Right column**
- **Membership**: a 38px tile, the plan name, and "Active · renews {date}".
  - **Me:** a "Payments" link (changing the plan stays in Payments, as today).
- **Attendance**: "This season", the percentage (30px, mono), "{n} of {m} sessions", a **Last 10** strip of 18px blocks (present, late, absent) and a legend.
- **Groups**: chips, each 28px tall.
  - **Admin:** an "Edit" button that opens the existing `GroupsField`, as a checkbox list.
- **Evaluation**
  - **Admin:** the overall score (30px, mono) with its date, and up to 4 category bars (6px, accent). "Open" goes to the full evaluation.
  - **Me:** an `eye-slash` icon and "Your coaches keep evaluations private this season. Ask them if you'd like feedback.", or, when it's visible, the same summary as the record (overall, date and bars) with every category.
- **Role** (Me only): a row reading "Role · Player" and "Coach or committee? Ask an Admin.", with a **Request** button. It reuses the `RoleRequestPanel` logic; if there's a pending request, show its status instead.

## Layout: mobile `#2a`
- **Top bar** (52px): back (44px), the title ("My profile" or "Member") and, for Admins, ⋯ (44px).
- **Header**, centred:
  - a 96px photo (Me: a 40px camera button);
  - the name (22px);
  - "Role · Position · Experience";
  - status chips.
- **Staff:** a row of 3 equal 48px icon buttons (email, call, emergency).
- **Me:** a missing-data card with "Almost there — {pct} complete" and a 44px row for each missing item.
- **Admin:** an AUF-pending card with a full-width 46px **Verify AUF** button.
- **About** and **Contact** cards:
  - The header row has a 44px **Edit** target.
  - Read rows are at least 46px tall (label on the left, value on the right).
  - Contact rows are at least 58px tall.
  - Edit mode stacks the fields: inputs **48px tall with 16px text**, Experience as a 40px segmented control, and Cancel / Save at 48px.
- **Attendance and Membership**: two side-by-side summary cards.
- **AUF**: a single 58px row with the status on the right (not shown for Committee).
- **Evaluation**: the same rules as desktop. Admins see the score and bars with an "Open" link (at least 44px tall); Me sees the private notice; Committee sees nothing.
- **Groups**: chips, each 30px tall.
- **Me:** a "Request a role change" row (56px).
- **Admin ⋯**: a bottom sheet with radius 20, a handle and 52px rows. It has the same items as the desktop menu, with Deactivate in danger red below a rule.

## Data / API
- **Own profile:** no API change.
- **Admin record:** add the fields the header needs to `GET` member-record: `positionName`, `experienceLevel`, `country`, `role`, `membershipPlan`. **Do not** return gender.
- **Committee read access (new):**
  - Allow `committee` on a read-only member endpoint (or the same `GET` with a reduced projection): contact, emergency contact, membership, attendance and groups.
  - **No** AUF, date of birth, evaluation or gender.
  - Every write endpoint stays Admin-only.
- **Profile completeness:** derive it on the client from the saved profile. For now: emergency contact, phone and country. Extend it later if needed.

## Copy / i18n (new or changed)
- Card titles: "About", "Contact", "AUF registration", "Club record", "Membership", "Attendance", "Groups", "Evaluation".
- Labels: "only you", "Admin".
- Missing data: "Your profile is almost complete. Missing:", "Almost there — {pct} complete", "Emergency contact".
- AUF: "{name} added AUF {number} (expires {date}). Check it and verify.", "Verify AUF", "AUF verified", "AUF pending", the two AUF notes for Me, "in {n} days".
- Contact: "Not added yet" / "No emergency contact yet".
- Header: "Member since {date}".
- ⋯ menu: "Change role", "Waive membership fee", "Resend invitation", "Deactivate member".
- Deactivate confirm text.
- Notices: "About saved", "Contact saved".
- Role: "Coach or committee? Ask an Admin.", "Request", "Request a role change".

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
  - row line `#22394d`
  - hover `#1a3349`
  - selected `#1d4869`
  - header gradient start `#163a55`
- Radii: 6, 8, 9, 10, 12, 14, 20, 999.
- Focus: 2px accent outline.
- Icons: Phosphor.

## Screenshots (`screenshots/`)
1. `01-desktop-me.png`: own profile, missing emergency contact.
2. `02-desktop-me-editing.png`: About in edit mode.
3. `03-desktop-admin-menu.png`: Admin view, with the AUF pending strip and the ⋯ menu open.
4. `04-desktop-committee.png`: Committee view, read-only.
5. `05-mobile-me.png`
6. `06-mobile-admin.png`
7. `07-mobile-committee.png`

When a screenshot and this text disagree, follow the text.

## Files
- `Profile Upgrade.dc.html`: the interactive mock.
- `support.js`: needed to open the mock.
