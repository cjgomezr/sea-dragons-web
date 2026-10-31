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

const PHONE_QUERY = "@media (width < 768px)";

describe("la medida de la cabecera del móvil", () => {
  it("vive en :root como --app-phone-header-height", () => {
    const rootProperties = cssCustomProperties(declarationsIn(":root", null));

    expect(rootProperties["app-phone-header-height"]).toBeDefined();
  });
});

describe("la cabecera por debajo de 768 px (#957)", () => {
  it("se pega arriba del todo", () => {
    const block = declarationsIn(".app-sidebar", PHONE_QUERY);

    expect(block).toContain("position: sticky;");
    expect(block).toContain("top: 0;");
  });

  // Por encima de lo pegado en el contenido (6) y de la barra de pestañas
  // (10), porque la búsqueda y los avisos que abre son pantallas enteras
  // dentro de ella; por debajo de los desplegables del contenido (20).
  it("queda entre la barra de pestañas y los desplegables", () => {
    const zIndex = Number(
      /z-index: (\d+);/.exec(declarationsIn(".app-sidebar", PHONE_QUERY))?.[1],
    );
    const tabBarZIndex = Number(
      /z-index: (\d+);/.exec(declarationsIn(".app-tabbar", null))?.[1],
    );

    expect(zIndex).toBeGreaterThan(tabBarZIndex);
    expect(zIndex).toBeLessThan(20);
  });

  it("las anclas de la página quedan por debajo de la cabecera", () => {
    expect(declarationsIn("html", PHONE_QUERY)).toContain(
      "scroll-padding-top: var(--app-phone-header-height);",
    );
  });
});

/* Las barras de pantallas del móvil que se pegan arriba: con la cabecera
   fija, empiezan justo debajo de ella (#957). */
const PHONE_BARS = [
  { selector: ".profile-phone-bar", media: PHONE_QUERY },
  { selector: ".news-post-bar", media: null },
  { selector: ".news-publish-bar", media: null },
  { selector: ".agenda-screen-bar", media: null },
] as const;

describe("las barras que sólo existen en el móvil", () => {
  for (const bar of PHONE_BARS) {
    it(`${bar.selector} se pega justo bajo la cabecera`, () => {
      expect(declarationsIn(bar.selector, bar.media)).toContain(
        "top: var(--app-phone-header-height);",
      );
    });
  }

  // Va dentro de un <dialog> a pantalla completa, en la capa superior: se
  // pega arriba del diálogo, no de la página.
  it(".event-form-bar sigue pegada a 0", () => {
    expect(declarationsIn(".event-form-bar", null)).toContain("top: 0;");
  });
});
