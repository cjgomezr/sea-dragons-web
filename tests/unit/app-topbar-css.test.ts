/**
 * #932: desde 768 px la barra de arriba se queda fija, y lo que ya se pegaba
 * arriba al hacer scroll baja hasta quedar bajo ella. Que de verdad se pegue
 * donde debe lo mira Playwright ("barra de arriba fija" en ui.spec.ts); aquí,
 * que cada regla usa la medida de la barra y no un número suelto.
 */
import { describe, expect, it } from "vitest";
import { cssCustomProperties, readGlobalsCss } from "./helpers/css-tokens";

const COMMENT = /\/\*[\s\S]*?\*\//g;
const TABLET_QUERY = "@media (min-width: 768px)";

const globalsCss = readGlobalsCss().replace(COMMENT, "");

type Rule = { readonly media: string | null; readonly body: string };

/** Las reglas cuyo selector es exactamente `selector`, con la media query que
 * las envuelve (o null si están fuera de una). */
function rulesFor(selector: string): readonly Rule[] {
  const rules: Rule[] = [];
  const mediaStack: string[] = [];
  let depth = 0;
  for (const match of globalsCss.matchAll(/([^{}]*)\{|\}/g)) {
    const prelude = match[1]?.replace(/\s+/g, " ").trim();
    if (prelude === undefined) {
      depth -= 1;
      if (mediaStack.length > depth) mediaStack.pop();
      continue;
    }
    if (prelude.startsWith("@media")) {
      mediaStack.push(prelude);
      depth += 1;
      continue;
    }
    const start = (match.index ?? 0) + match[0].length;
    const end = globalsCss.indexOf("}", start);
    if (prelude === selector) {
      rules.push({
        media: mediaStack.at(-1) ?? null,
        body: globalsCss.slice(start, end).replace(/\s+/g, " "),
      });
    }
    depth += 1;
  }
  return rules;
}

function declarationsIn(selector: string, media: string | null): string {
  const bodies = rulesFor(selector)
    .filter((rule) => rule.media === media)
    .map((rule) => rule.body);
  if (bodies.length === 0) {
    throw new Error(`Rule not found in globals.css: ${selector} in ${media}`);
  }
  return bodies.join(" ");
}

describe("la medida de la barra de arriba", () => {
  it("vive en :root como --app-topbar-height", () => {
    const rootProperties = cssCustomProperties(declarationsIn(":root", null));

    expect(rootProperties["app-topbar-height"]).toBeDefined();
  });
});

describe("la barra de arriba desde 768 px", () => {
  it("se pega arriba del todo", () => {
    const block = declarationsIn(".app-topbar", TABLET_QUERY);

    expect(block).toContain("position: sticky;");
    expect(block).toContain("top: 0;");
    expect(block).toMatch(/z-index: \d+;/);
  });

  it("las anclas de la página quedan por debajo de la barra", () => {
    expect(declarationsIn("html", TABLET_QUERY)).toContain(
      "scroll-padding-top: var(--app-topbar-height);",
    );
  });
});

const STUCK_PIECES = [
  { selector: ".directory-panel-inner", media: null, gap: "--space-4" },
  { selector: ".club-general-preview", media: TABLET_QUERY, gap: "--space-6" },
  {
    selector: ".evaluation-sheet, .evaluation-overview",
    media: "@media (min-width: 1024px)",
    gap: "--space-4",
  },
  {
    selector: ".agenda-panel-slot",
    media: "@media (min-width: 1024px)",
    gap: "--space-4",
  },
  {
    selector: ".training-panel",
    media: "@media (width >= 1280px)",
    gap: "--space-4",
  },
] as const;

describe("lo que se pega arriba al hacer scroll", () => {
  for (const piece of STUCK_PIECES) {
    it(`${piece.selector} se pega a ${piece.gap} por debajo de la barra`, () => {
      expect(declarationsIn(piece.selector, piece.media)).toContain(
        `top: calc(var(--app-topbar-height) + var(${piece.gap}));`,
      );
    });
  }

  it("el panel del directorio descuenta la barra de su alto máximo", () => {
    expect(declarationsIn(".directory-panel-inner", null)).toContain(
      "max-height: calc(100vh - var(--app-topbar-height) - 2 * var(--space-4));",
    );
  });

  it("el panel de la agenda descuenta la barra de su alto máximo", () => {
    expect(
      declarationsIn(".agenda-panel", "@media (min-width: 1024px)"),
    ).toContain(
      "max-height: calc(100vh - var(--app-topbar-height) - 2 * var(--space-4));",
    );
  });
});

/* Sólo existen en el móvil, donde no hay barra de arriba: se quedan en 0. */
const PHONE_ONLY_BARS = [
  ".news-post-bar",
  ".news-publish-bar",
  ".agenda-screen-bar",
  ".event-form-bar",
] as const;

describe("las barras que sólo existen en el móvil", () => {
  for (const selector of PHONE_ONLY_BARS) {
    it(`${selector} sigue pegada a 0`, () => {
      expect(declarationsIn(selector, null)).toContain("top: 0;");
    });
  }
});
