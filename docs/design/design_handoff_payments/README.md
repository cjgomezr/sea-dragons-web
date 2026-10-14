# Handoff: Payments redesign

## Overview
This is a redesign of `/pagos` (Payments) in `cjgomezr/sea-dragons-web`, under `src/components/payments/*`. Today the screen is one column of big cards, with the plan, the levies (each one with an inline "who paid" table for admins) and the payment history stacked together. The redesign:
- **Splits personal from management.** The **My membership** tab holds the plan, the club extras the member can buy, and their payment history. The **Club extras** tab shows the sales for each extra and is only for Admin and Committee.
- **Treats levies as optional "club extras".** Members buy them if they want, nothing is overdue, and there is no "missing" list or reminders. Admins see the number sold, the revenue and the buyers.
- **Uses compact rows instead of big cards.**
- **Groups the payment history by month**, with a filter and a status shown as a colour plus a word.

## What to build
- Desktop: option **`#1a`** in `Payments Upgrade.dc.html`, section 1.
- Mobile (under 768px): **`#2a`, `#2b`, `#2c`**, section 2.
- `#1b` is exploration. Don't build it. It still shows progress against a total, a "who's missing" list and reminders, all of which were rejected.

## About the design files
These files are **design references made in HTML**, not production code. Rebuild them inside the existing Next.js app, keeping what already works:
- the hooks and components: `useMembershipLoad`, `useMembershipWait`, `StripeSessionButton`, `PlanChange`, `PlanChoice`, `MembershipNotice`;
- the return-from-Stripe states;
- the i18n keys, in `en.ts` and `es.ts`;
- the role check: `canSeeLevyPayers`, already decided on the server.

Open the `.dc.html` in a browser to try it. It needs `support.js` next to it. The data is invented.

## Fidelity
The mock is **high fidelity**, built on the dark-theme tokens in `globals.css`. Use the CSS variables, not the hex values. The light theme should follow the same layout with the light tokens.

## Desktop `#1a` — `PaymentsScreen.tsx`
**Header**
- The H1 "Payments" (28px, weight 700).
- Underneath it, an underline tab bar: **My membership** | **Club extras**, with a count badge.
- Tab style:
  - Each tab is 14px, weight 600, with 10px of vertical padding, and never wraps (`white-space: nowrap`).
  - The active tab is in `--color-text` with a 2px accent underline. Inactive tabs are in `--color-text-secondary`.
  - The badge is 20px tall, `#1d4869` background, `#cfe8f7` text, 11.5px bold.
- The **Club extras** tab only renders when `canSeeLevyPayers` is true. Without it, show the My membership content with no tab bar.
- Keep the tab in the URL (`?tab=extras`).

### Tab: My membership
Padding 24px 28px; the sections are 26px apart.

1. **Plan strip** (replaces the `PlanCard` layout). Panel background, 1px border, radius 10, padding 16px 18px. One row that wraps:
   - Left:
     - First line: the plan name (17px, weight 700) and the **status chip**, a pill in the success, warning or danger tint (14% background, 40% border, 12px bold text). Keep `CHIP_TONES`.
     - Second line, 13.5px in `--color-text-soft`, 18px gap: the price ("A$25.00 / month"), a calendar icon with "Next charge {date}", and a credit-card icon with "{brand} •••• {last4} · exp {MM/YY}".
     - Waiver and Casual cases: show the same details (`PlanDetails`) on that second line. For a Casual plan, show the remaining sessions plus small session-pack buttons on the strip itself, instead of a separate card.
   - Right: the secondary buttons **Change plan** (`PlanChange`) and **Update card**, or **Resubscribe**, following the rules in `PlanActions`.
   - Pending, choosing a plan, and waiting for Stripe: keep `PlanChoice`, `PendingOffer` and `SubscriptionWaitStatus`, rendered inside the strip area.
2. **CLUB EXTRAS** (`LevyCharges`, member view).
   - The label is mono 11px, uppercase, with the hint "Optional · buy what you need".
   - Rows sit in one bordered list, radius 10. Each row is a grid `1fr | 120px | 96px | 100px`, padded 11px × 16px, with these cells:
     - the name (14.5px, weight 600) with the one-line description under it (12.5px, secondary, ellipsis);
     - when bought, "Bought {date}" in secondary text; empty otherwise (there is no availability or end date);
     - the price, in mono and right-aligned;
     - the action: a primary **Buy** button (Stripe Checkout through `requestLevyCheckout`), or "✓ Bought" in the success colour when `isPaid`.
   - Hide the section when there are no levies, as today.
3. **PAYMENT HISTORY** (`PaymentHistory`).
   - Header on the right: a segmented filter (**All · Paid · Failed**; add Pending only if it appears in the data) and a 34px icon button for **Export CSV**, which is new and exported from the client.
   - The table is a grid `72px | 1fr | 170px | 96px | 96px | 32px`, with a header row on `#0f2131`: DATE · DESCRIPTION · METHOD · AMOUNT (right-aligned) · STATUS · (receipt).
   - **Month group rows** ("October 2026") go before each month's payments, in 12.5px bold `--color-text-soft`.
   - Each payment row is 13.5px. A failed row shows the failure reason in danger red under the description, when Stripe gives one.
   - The status is a 7px dot plus the word, in the success or danger colour.
   - The receipt icon only shows for paid payments. It opens Stripe's hosted receipt or invoice for that payment in a new tab (`target="_blank" rel="noopener"`), where the member can view it again or download it as PDF whenever they want. **Use only options that carry no extra Stripe fee.**
     - **Membership (subscription)** payments: Stripe already creates an Invoice for every billing cycle at no extra cost. Use `invoice.hosted_invoice_url`, which shows the invoice and has "Download invoice" and "Download receipt" PDF buttons.
     - **Club extras and session packs** (one-off Checkout payments): use the charge's `receipt_url` (`payment_intent.latest_charge.receipt_url`). It is a free, printable hosted receipt; members can save it as PDF from the browser. **Do not** turn on `invoice_creation` in Checkout, because Stripe charges extra for those invoices.
     - Add `receiptUrl: string | null` to `PaymentView`. Store the Stripe ID (the invoice ID or the charge ID) when the webhook records the payment, and resolve the URL from it on request, because hosted URLs can expire.
     - If there's no URL, hide the icon.
   - When the filter matches nothing: "No payments match this filter."
   - Keep `SessionActivity`, for Casual members only, as a second history block in the same style.

### Tab: Club extras (Admin / Committee) — replaces `LevyPayers` inline toggle
- A two-column grid, `1fr | 360px`.
- **List column** (padding 20px 24px):
  - Lead line: "{n} extras on sale · created by the committee in Stripe".
  - Table header: EXTRA · PRICE · SOLD · REVENUE. Columns `1fr | 84px | 90px | 110px`, with the numbers in mono and right-aligned.
  - Each row shows the name with its description under it (one line, ellipsis), then the price, the count sold and the revenue.
  - Clicking a row selects it. The selected row gets a panel background and a 3px accent bar on the left. The first row is selected by default.
- **Detail panel** (panel background, padding 20px, 16px gap):
  - The name (17px, bold), the description, and the price.
  - Two stat tiles: **Sold** (the count) and **Revenue** (the sum). Each tile is `--color-background`, with a border and radius 8.
  - **BUYERS**: a scrolling list (max 360px) where each row has a 28px avatar, the name and the purchase date in mono.
  - **Export CSV**: a full-width secondary button. Keep `levyPayersCsv` and `saveFile`, but take the "missing" columns out of the CSV.
- **Removed:** the missing list, any total or progress figure, and reminders. Extras are optional.
- Data: reuse `loadLevyPayers(priceId)` and use only `summary.paidCount`, `summary.collectedCents` and `payers`. Fetch it when a row is selected, and cache it per extra.

## Mobile
Touch targets are at least 44px.

**`#2a` My membership**
- Header:
  - "Payments" (26px).
  - A full-width 2-part segmented control (40px): My membership | Club extras with its count. The active segment has a `#1d4869` background and bold text.
  - Members without the admin or committee role don't see the segmented control.
- **Plan card**, radius 12:
  - the plan name and status chip;
  - two icon lines: price · next charge, and the card;
  - two 42px buttons side by side: Change plan and Update card.
- **CLUB EXTRAS**:
  - Each row is at least 56px tall, with the name and the price.
  - On the right, a primary **Buy** button (40px tall) or "✓ Bought".
- **PAYMENT HISTORY**:
  - An export icon button (44px) on the right of the header.
  - Filter chips that are 44px tall.
  - Month labels.
  - Each row is at least 56px tall, with three parts: a 36px status circle (success or danger tint, with a check or an X), the description with the date (and the failure reason in red), and the amount plus the status word.

**`#2b` Club extras (admin)**
- A lead line, then rows at least 64px tall.
- Each row shows the name with the price, then the revenue in mono with "{n} sold" under it, then a caret.

**`#2c` Extra detail**: a bottom sheet over the dimmed list, with top radius 20 and a drag handle. It contains:
- the name (18px), the description and the price;
- the Sold and Revenue tiles;
- **BUYERS**: rows at least 44px tall, with a 32px avatar, the name and the date, scrolling;
- an **Export CSV** button, 46px tall.

## Copy / i18n changes
- `payments.levies.title`: "Club extras" / "Extras del club".
- New lead: "Optional · buy what you need" / "Opcional · comprá lo que necesites".
- `payments.levies.pay`: "Buy" / "Comprar".
- `payments.levies.paid`: "Bought" / "Comprado".
- `levyPayers.*`: drop the missing-related keys. Add "Sold" / "Vendidos", "Revenue" / "Recaudado" and "Buyers" / "Compradores".
- New keys:
  - the tab names;
  - the history filter labels;
  - "No payments match this filter.";
  - the Export CSV labels.

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
  - table header `#0f2131`
  - selected tab or segment `#1d4869`
- Radii: 6, 8, 10, 12, 20 (sheet), 999 (pills).
- Focus: 2px accent outline.
- Icons: Phosphor (`calendar-blank`, `credit-card`, `currency-dollar`, `download-simple`, `receipt`, `check`, `x`, `check-circle`, `caret-right`).

## Screenshots (`screenshots/`)
1. `01-desktop-my-membership.png`: the desktop My membership tab.
2. `02-desktop-club-extras-admin.png`: the desktop Club extras tab, with an extra selected and its buyers in the panel.
3. `03-mobile-my-membership.png`: the mobile My membership screen.
4. `04-mobile-club-extras-admin.png`: the mobile Club extras list.
5. `05-mobile-extra-detail-sheet.png`: the mobile detail sheet for an extra.

When a screenshot and this text disagree, follow the text.

## Files
- `Payments Upgrade.dc.html`: the interactive mock. Build `#1a`, `#2a`, `#2b` and `#2c`.
- `support.js`: needed to open the mock.
