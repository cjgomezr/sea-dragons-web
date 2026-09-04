# Design System: Victoria Seadragons

This file is the visual source of truth. With a mockup, the ui-reviewer
compares against the mockup; **without a mockup, it reviews against this
file**. Keep every rule concrete and verifiable. No "should look nice".

**Mockups live in `docs/mockups/`**, exported from the interactive prototype
(`docs/Seadragons Platform.dc.html`) with `npm run export:mockups`. One PNG
per screen and theme, named `<screen>-<light|dark>.png` for web
(`dashboard-light.png`, `payments-dark.png`) and `mobile-<screen>-<light|dark>.png`
for mobile (`mobile-home-light.png`, `mobile-calendar-dark.png`). That is
where `write-ticket` points its `Mockup:` field and where the ui-reviewer
looks for its Mode A reference. They are not decoration: they are what every
UI ticket gets judged against.

Customize the tokens below per project; the checklists rarely change.

## Tokens

### Color

| Role                      | Value                                                     | Usage                         |
| ------------------------- | --------------------------------------------------------- | ----------------------------- |
| Primary                   | `#2563EB` (por defecto, SIN diseño de referencia todavía) | Primary actions, links, focus |
| Primary hover             | 10% darker                                                | Hover on primary              |
| Surface                   | `#FFFFFF`                                                 | Cards, panels                 |
| Background                | `#F8FAFC`                                                 | Page background               |
| Text                      | `#0F172A`                                                 | Body text                     |
| Text secondary            | `#64748B`                                                 | Captions, metadata            |
| Border                    | `#E2E8F0`                                                 | Dividers, input borders       |
| Success / Warning / Error | `#16A34A` / `#D97706` / `#DC2626`                         | States only, never decorative |

Rules: one accent color; success/warning/error appear only with their meaning;
never place text on a background with contrast ratio below 4.5:1 (3:1 for
text ≥ 24px).

### Spacing

Scale: **4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 px**. Every margin, padding and
gap must be a value from this scale. Same relationship = same spacing (all
cards in a grid share identical gaps; label-to-input distance is constant).

### Typography

- Font: system stack (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto`), por defecto. Max 2 families total.
- Scale: 12 / 14 / 16 (body) / 18 / 24 / 32 / 40 px. Line height ≥ 1.5 for
  body, ≥ 1.2 for headings. Max ~70ch line length for reading text.
- Hierarchy by size + weight, never by color alone.

### Shape & elevation

- Border radius: 8px everywhere interactive; pick ONE
  radius and stick to it.
- Max 2 elevation levels (e.g. card shadow + modal shadow).

## Mandatory component states

Every interactive component ships with ALL of: default, hover, focus-visible
(visible ring; never `outline: none` without replacement), active, disabled.
Every data view ships with: loading, empty (with helpful message + action),
error (with retry), and long-content (text 3× expected length must not break
layout).

## Responsive

Breakpoints to verify: **375px** (mobile), **768px** (tablet), **1440px**
(desktop). Rules: no horizontal scroll at any breakpoint; touch targets
≥ 44×44px on mobile; primary action reachable without scrolling on mobile
when feasible.

## Accessibility (hard requirements; axe-core enforces most)

- Contrast per the color rules above.
- Every input has a label; every image has alt; icon-only buttons have
  aria-label.
- Fully keyboard-navigable; logical tab order; focus trapped in modals.
- No information conveyed by color alone.

## Heuristic review questions (ui-reviewer, no-mockup mode)

1. Is there exactly ONE clear primary action per screen?
2. Do all spacings come from the scale, and do equal relationships have equal
   spacing?
3. Is everything that can be aligned actually aligned (edges, baselines)?
4. Is the visual hierarchy right? Is the most important element also the
   most prominent?
5. Do all mandatory states exist and look intentional?
6. At 375px: no overflow, no horizontal scroll, targets ≥ 44px?
7. Does any text truncate, overlap or escape its container with real-length
   content?
8. Would this screen look coherent placed next to the app's other screens
   (same tokens, same radius, same spacing rhythm)?
