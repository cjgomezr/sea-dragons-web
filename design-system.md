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

Source of the tokens below: `docs/Seadragons Platform.dc.html` (Claude Design
handoff), the `[data-theme="light"]` and `[data-theme="dark"]` blocks.

## Tokens

### Color

Cómo se aplican (#174): el tema claro es la paleta por defecto y vive en
`:root` a secas, así que la pantalla tiene colores aunque el script del tema
no llegue a correr. El oscuro entra por `prefers-color-scheme` mientras nadie
haya elegido, y por `[data-theme="dark"]` en cuanto alguien elige. Cada tema
declara además su `color-scheme`, para que los controles nativos y la barra de
desplazamiento lo sigan.

#### Light theme (paleta por defecto, en `:root`)

| Role           | Value     | Usage                          |
| -------------- | --------- | ------------------------------ |
| Accent         | `#1C6EA4` | Primary actions, links, focus  |
| Background     | `#EFF3F7` | Page background                |
| Panel          | `#FFFFFF` | Cards, panels                  |
| Text           | `#1C3245` | Body text                      |
| Text secondary | `#5A7086` | Captions, metadata             |
| Border         | `#DEE6ED` | Dividers, input borders        |
| Success        | `#2E9E86` | Success state only             |
| Warning        | `#C99A3E` | Warning state only             |
| Danger         | `#BC3B2E` | Validation errors, destructive |
| Text on accent | `#FFFFFF` | Text/icons on an accent fill   |

> **Decisión del 2026-09-04.** El texto secundario del tema claro se desvía
> del prototipo a propósito. El valor original del prototipo, `#6B8095`, da
> 4.10:1 sobre el panel blanco y 3.64:1 sobre el fondo `#EFF3F7`: incumple el
> mínimo AA (4.5:1) que este mismo documento declara como regla. `#5A7086` da
> 5.15:1 sobre panel y 4.56:1 sobre fondo, los dos por encima de AA, y la
> diferencia visual frente al hex del prototipo es mínima. No lo devuelvas al
> hex del prototipo creyendo que es una errata: es una decisión de
> accesibilidad tomada en el issue #17.

#### Dark theme (`[data-theme="dark"]` y `prefers-color-scheme: dark`)

| Role           | Value     | Usage                          |
| -------------- | --------- | ------------------------------ |
| Accent         | `#33A1E0` | Primary actions, links, focus  |
| Background     | `#0C1A26` | Page background                |
| Panel          | `#13283A` | Cards, panels                  |
| Text           | `#E8F0F7` | Body text                      |
| Text secondary | `#8AA1B5` | Captions, metadata             |
| Border         | `#274055` | Dividers, input borders        |
| Success        | `#6FD6B4` | Success state only             |
| Warning        | `#F2CE78` | Warning state only             |
| Danger         | `#F2887A` | Validation errors, destructive |
| Text on accent | `#0C1A26` | Text/icons on an accent fill   |

Rules: one accent color; success/warning/danger appear only with their meaning;
never place text on a background with contrast ratio below 4.5:1 (3:1 for
text ≥ 24px).

> **Decisión del 2026-09-12 (issue #132).** `Danger` es un token nuevo, y
> existe porque el primer formulario de la aplicación necesitaba pintar un
> error de validación y lo estaba haciendo con `Warning`. Un campo que impide
> continuar no es una advertencia, y reutilizar el color de warning para eso
> rompe la regla de arriba. No lo sustituyas por `Warning`: el prototipo no
> traía un rojo porque no dibujaba ningún estado de error.

> **Decisión del 2026-09-12 (issue #132).** `Text on accent` no es un color
> nuevo: es el único valor que deja pasar AA al primer botón primario relleno
> de la aplicación, el de crear cuenta. Blanco sobre el acento claro da 5.1:1.
> Blanco sobre el acento oscuro daría 2.6:1, así que en tema oscuro el texto
> del botón es el fondo de página, que da 7.4:1. No inviertas los dos valores
> creyendo que están cambiados: `tests/unit/design-tokens.test.ts` comprueba
> el contraste de los dos.

#### Sidebar (no cambia con el tema)

El prototipo fija estos valores en `:root`, iguales en claro y oscuro. Los va
a necesitar el app shell.

| Role               | Value     |
| ------------------ | --------- |
| Sidebar background | `#163A55` |
| Sidebar text       | `#CFDEEA` |
| Sidebar text muted | `#89A1B5` |
| Sidebar border     | `#244B69` |
| Sidebar hover      | `#1D4869` |

#### Elevation (shadows, por tema)

| Role        | Light theme                                                           | Dark theme                                                     |
| ----------- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| Shadow      | `0 1px 2px rgba(13, 36, 54, 0.06), 0 6px 18px rgba(13, 36, 54, 0.06)` | `0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.28)` |
| Shadow (sm) | `0 1px 2px rgba(13, 36, 54, 0.07)`                                    | `0 1px 2px rgba(0, 0, 0, 0.35)`                                |

Max 2 elevation levels, matching the rule below: the regular `--shadow` for
cards/panels, `--shadow-sm` for small interactive elements.

### Spacing

Scale: **4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 px**. Every margin, padding and
gap must be a value from this scale. Same relationship = same spacing (all
cards in a grid share identical gaps; label-to-input distance is constant).

### Typography

- Fonts (from the mockup's `<helmet>`): **Archivo** for body text, **Space
  Grotesk** for headings, **Space Mono** for data and labels. Each declares
  its own system fallback stack, so the page stays legible without a network
  connection to Google Fonts:
  - Body: `Archivo, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  - Headings: `"Space Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  - Data / labels: `"Space Mono", ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace`
- Scale: 12 / 14 / 16 (body) / 18 / 24 / 32 / 40 px. Line height ≥ 1.5 for
  body, ≥ 1.2 for headings. Max ~70ch line length for reading text.
- Hierarchy by size + weight, never by color alone.

### Shape & elevation

- Border radius: 8px everywhere interactive; pick ONE
  radius and stick to it.
- Max 2 elevation levels: see `--shadow` and `--shadow-sm` above.

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
