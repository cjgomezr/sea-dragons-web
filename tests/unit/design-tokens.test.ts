import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cssBlock,
  cssCustomProperties,
  readGlobalsCss,
} from "./helpers/css-tokens";
import { contrastRatio, tintOver } from "./helpers/wcag-contrast";

const designSystem = readFileSync(
  join(process.cwd(), "design-system.md"),
  "utf-8",
);
const globalsCss = readGlobalsCss();

function token<T>(tokens: Record<string, T>, key: string): T {
  const value = tokens[key];
  if (value === undefined) {
    throw new Error(`Missing token: ${key}`);
  }
  return value;
}

function markdownTable(
  markdown: string,
  headingPattern: RegExp,
): Record<string, string> {
  const headingMatch = headingPattern.exec(markdown);
  if (!headingMatch) {
    throw new Error(`Heading not found in design-system.md: ${headingPattern}`);
  }
  const afterHeading = markdown.slice(
    headingMatch.index + headingMatch[0].length,
  );
  const rows: Record<string, string> = {};
  for (const line of afterHeading.split("\n")) {
    if (
      line.startsWith("####") ||
      (line.startsWith("##") && !line.startsWith("###"))
    ) {
      break;
    }
    const rowMatch = /^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|/.exec(line);
    if (rowMatch && rowMatch[1] !== undefined && rowMatch[2] !== undefined) {
      rows[rowMatch[1]] = rowMatch[2];
    }
  }
  return rows;
}

function markdownTwoValueTable(
  markdown: string,
  headingPattern: RegExp,
): Record<string, { light: string; dark: string }> {
  const headingMatch = headingPattern.exec(markdown);
  if (!headingMatch) {
    throw new Error(`Heading not found in design-system.md: ${headingPattern}`);
  }
  const afterHeading = markdown.slice(
    headingMatch.index + headingMatch[0].length,
  );
  const rows: Record<string, { light: string; dark: string }> = {};
  for (const line of afterHeading.split("\n")) {
    if (
      line.startsWith("####") ||
      (line.startsWith("##") && !line.startsWith("###"))
    ) {
      break;
    }
    const rowMatch =
      /^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/.exec(line);
    if (
      rowMatch &&
      rowMatch[1] !== undefined &&
      rowMatch[2] !== undefined &&
      rowMatch[3] !== undefined
    ) {
      rows[rowMatch[1]] = { light: rowMatch[2], dark: rowMatch[3] };
    }
  }
  return rows;
}

const lightTokens = markdownTable(designSystem, /#### Light theme/);
const darkTokens = markdownTable(designSystem, /#### Dark theme/);
const sidebarTokens = markdownTable(designSystem, /#### Sidebar/);
const elevationTokens = markdownTwoValueTable(designSystem, /#### Elevation/);

// El tema claro es el por defecto y vive en :root a secas, para que la paleta
// no dependa de que ThemeScript haya escrito data-theme (#174).
const rootCss = cssCustomProperties(cssBlock(globalsCss, ":root"));
const darkCss = cssCustomProperties(
  cssBlock(globalsCss, ':root[data-theme="dark"]'),
);

const colorRoleToCssVariable: Record<string, string> = {
  Accent: "color-accent",
  "Accent text": "color-accent-text",
  Background: "color-background",
  Panel: "color-panel",
  Text: "color-text",
  "Text secondary": "color-text-secondary",
  Border: "color-border",
  Success: "color-success",
  Warning: "color-warning",
  "Text on accent": "color-on-accent",
  Danger: "color-danger",
  Hover: "color-hover",
  "Accent soft text": "color-accent-soft-text",
  "Text soft": "color-text-soft",
  "Accent hover": "color-accent-hover",
  "Editor bar": "color-editor-bar",
  "Segment selected": "color-segment-selected",
  "Border dashed": "color-border-dashed",
  "Type meeting": "color-type-meeting",
};

describe("tokens de color: tema claro", () => {
  it.each(Object.entries(colorRoleToCssVariable))(
    "%s coincide entre design-system.md y globals.css",
    (role, cssVariable) => {
      expect(token(rootCss, cssVariable).toUpperCase()).toBe(
        token(lightTokens, role).toUpperCase(),
      );
    },
  );
});

describe("tokens de color: tema oscuro", () => {
  it.each(Object.entries(colorRoleToCssVariable))(
    "%s coincide entre design-system.md y globals.css",
    (role, cssVariable) => {
      expect(token(darkCss, cssVariable).toUpperCase()).toBe(
        token(darkTokens, role).toUpperCase(),
      );
    },
  );
});

describe("tokens de color: sidebar (independiente de tema)", () => {
  const sidebarRoleToCssVariable: Record<string, string> = {
    "Sidebar background": "color-sidebar-background",
    "Sidebar text": "color-sidebar-text",
    "Sidebar text muted": "color-sidebar-text-muted",
    "Sidebar border": "color-sidebar-border",
    "Sidebar hover": "color-sidebar-hover",
  };

  it.each(Object.entries(sidebarRoleToCssVariable))(
    "%s coincide entre design-system.md y globals.css",
    (role, cssVariable) => {
      expect(token(rootCss, cssVariable).toUpperCase()).toBe(
        token(sidebarTokens, role).toUpperCase(),
      );
    },
  );
});

describe("tokens de elevación (sombras, por tema)", () => {
  const elevationRoleToCssVariable: Record<string, string> = {
    Shadow: "shadow",
    "Shadow (sm)": "shadow-sm",
  };

  it.each(Object.entries(elevationRoleToCssVariable))(
    "%s coincide con globals.css en tema claro",
    (role, cssVariable) => {
      expect(token(rootCss, cssVariable)).toBe(
        token(elevationTokens, role).light,
      );
    },
  );

  it.each(Object.entries(elevationRoleToCssVariable))(
    "%s coincide con globals.css en tema oscuro",
    (role, cssVariable) => {
      expect(token(darkCss, cssVariable)).toBe(
        token(elevationTokens, role).dark,
      );
    },
  );
});

describe("contraste", () => {
  it("texto sobre fondo cumple AA en tema claro", () => {
    expect(
      contrastRatio(
        token(rootCss, "color-text"),
        token(rootCss, "color-background"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("texto secundario sobre panel cumple AA en tema claro", () => {
    expect(
      contrastRatio(
        token(rootCss, "color-text-secondary"),
        token(rootCss, "color-panel"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("texto secundario sobre fondo cumple AA en tema claro", () => {
    expect(
      contrastRatio(
        token(rootCss, "color-text-secondary"),
        token(rootCss, "color-background"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("texto sobre fondo cumple AA en tema oscuro", () => {
    expect(
      contrastRatio(
        token(darkCss, "color-text"),
        token(darkCss, "color-background"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("texto secundario sobre panel cumple AA en tema oscuro", () => {
    expect(
      contrastRatio(
        token(darkCss, "color-text-secondary"),
        token(darkCss, "color-panel"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("texto secundario sobre fondo cumple AA en tema oscuro", () => {
    expect(
      contrastRatio(
        token(darkCss, "color-text-secondary"),
        token(darkCss, "color-background"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["light", "dark"] as const)(
    "el color de error cumple AA sobre el fondo y sobre el panel en tema %s",
    (theme) => {
      const tokens = theme === "light" ? rootCss : darkCss;
      expect(
        contrastRatio(
          token(tokens, "color-danger"),
          token(tokens, "color-background"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(
          token(tokens, "color-danger"),
          token(tokens, "color-panel"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  // El botón primario es un relleno de acento con texto encima, y el acento
  // cambia con el tema: el mismo blanco que pasa en claro se queda en 2.6:1
  // sobre el acento oscuro.
  it("texto sobre relleno de acento cumple AA en tema claro", () => {
    expect(
      contrastRatio(
        token(rootCss, "color-on-accent"),
        token(rootCss, "color-accent"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("texto sobre relleno de acento cumple AA en tema oscuro", () => {
    expect(
      contrastRatio(
        token(darkCss, "color-on-accent"),
        token(darkCss, "color-accent"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

// #547: los tokens del rediseño del directorio. El fondo de acento suave es el
// acento mezclado con transparente sobre la superficie; 16 % es el tinte más
// fuerte del handoff, y el que menos contraste deja en los dos temas.
const STRONGEST_ACCENT_TINT = 0.16;
const AA_TEXT = 4.5;

describe.each([
  ["claro", rootCss],
  ["oscuro", darkCss],
] as const)(
  "contraste de los tokens del directorio en tema %s",
  (_, tokens) => {
    it.each(["color-panel", "color-background", "color-hover"])(
      "el texto suave cumple AA sobre %s",
      (surface) => {
        expect(
          contrastRatio(
            token(tokens, "color-text-soft"),
            token(tokens, surface),
          ),
        ).toBeGreaterThanOrEqual(AA_TEXT);
      },
    );

    it("el texto cumple AA sobre el hover", () => {
      expect(
        contrastRatio(
          token(tokens, "color-text"),
          token(tokens, "color-hover"),
        ),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each(["color-panel", "color-background"])(
      "el texto de acento suave cumple AA sobre el tinte de acento encima de %s",
      (surface) => {
        const tint = tintOver(
          token(tokens, "color-accent"),
          token(tokens, surface),
          STRONGEST_ACCENT_TINT,
        );
        expect(
          contrastRatio(token(tokens, "color-accent-soft-text"), tint),
        ).toBeGreaterThanOrEqual(AA_TEXT);
      },
    );

    it("el texto sobre acento cumple AA sobre el acento al pasar el ratón", () => {
      expect(
        contrastRatio(
          token(tokens, "color-on-accent"),
          token(tokens, "color-accent-hover"),
        ),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    });
  },
);

// #590: la etiqueta de categoría de las noticias. Su fondo es el tono de la
// categoría mezclado con el panel, y el texto va siempre en --color-text.
const CATEGORY_LABEL_TINTS = [
  ["announcement", "color-warning", 0.28],
  ["news", "color-accent", 0.16],
  ["document", "color-success", 0.22],
] as const;

describe.each([
  ["claro", rootCss],
  ["oscuro", darkCss],
] as const)("contraste de las noticias en tema %s", (_, tokens) => {
  it.each(CATEGORY_LABEL_TINTS)(
    "el texto de la etiqueta %s cumple AA sobre su fondo",
    (_category, tone, weight) => {
      const labelBackground = tintOver(
        token(tokens, tone),
        token(tokens, "color-panel"),
        weight,
      );
      expect(
        contrastRatio(token(tokens, "color-text"), labelBackground),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it("el texto cumple AA sobre el segmento elegido", () => {
    expect(
      contrastRatio(
        token(tokens, "color-text"),
        token(tokens, "color-segment-selected"),
      ),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("el texto cumple AA sobre la barra del editor", () => {
    expect(
      contrastRatio(
        token(tokens, "color-text"),
        token(tokens, "color-editor-bar"),
      ),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

// #641: la etiqueta de tipo de evento. Su fondo es el color del tipo al 24 %
// sobre el panel, y el texto va siempre en --color-text.
const EVENT_TYPE_TAG_WEIGHT = 0.24;
const EVENT_TYPE_COLORS = [
  ["training", "color-accent"],
  ["competition", "color-warning"],
  ["social", "color-success"],
  ["meeting", "color-type-meeting"],
] as const;
// Lo que no es texto (la barra y el punto del tipo, su icono) pide 3:1.
const AA_NON_TEXT = 3;

describe.each([
  ["claro", rootCss],
  ["oscuro", darkCss],
] as const)("contraste de los tipos de evento en tema %s", (_, tokens) => {
  it.each(EVENT_TYPE_COLORS)(
    "el texto de la etiqueta %s cumple AA sobre su fondo",
    (_eventType, color) => {
      const tagBackground = tintOver(
        token(tokens, color),
        token(tokens, "color-panel"),
        EVENT_TYPE_TAG_WEIGHT,
      );
      expect(
        contrastRatio(token(tokens, "color-text"), tagBackground),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it("el color de Reunión se distingue del panel (3:1 o más)", () => {
    expect(
      contrastRatio(
        token(tokens, "color-type-meeting"),
        token(tokens, "color-panel"),
      ),
    ).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

// #581: el hover claro de #547 (#E6EDF3) se quedaba en 1.18:1 sobre el panel
// y casi en nada sobre el fondo, así que el puntero no se notaba. No es texto:
// los umbrales son los que hacen visible el cambio a simple vista.
const HOVER_OVER_PANEL_MIN = 1.4;
const HOVER_OVER_BACKGROUND_MIN = 1.25;
const DARK_HOVER = "#1A3349";

describe("visibilidad del hover", () => {
  it("en el tema claro el hover se distingue del panel (1,4:1 o más)", () => {
    expect(
      contrastRatio(
        token(rootCss, "color-hover"),
        token(rootCss, "color-panel"),
      ),
    ).toBeGreaterThanOrEqual(HOVER_OVER_PANEL_MIN);
  });

  it("en el tema claro el hover se distingue del fondo (1,25:1 o más)", () => {
    expect(
      contrastRatio(
        token(rootCss, "color-hover"),
        token(rootCss, "color-background"),
      ),
    ).toBeGreaterThanOrEqual(HOVER_OVER_BACKGROUND_MIN);
  });

  it("design-system.md documenta el contraste del hover claro con el panel y el fondo", () => {
    const hoverRow = designSystem
      .split("\n")
      .find((line) => line.startsWith("| Hover "));
    const hover = token(rootCss, "color-hover");
    const panelRatio = contrastRatio(hover, token(rootCss, "color-panel"));
    const backgroundRatio = contrastRatio(
      hover,
      token(rootCss, "color-background"),
    );
    expect(hoverRow).toContain(`${panelRatio.toFixed(2)}:1 on Panel`);
    expect(hoverRow).toContain(`${backgroundRatio.toFixed(2)}:1 on Background`);
  });

  it("el tema oscuro conserva su hover", () => {
    expect(token(darkCss, "color-hover").toUpperCase()).toBe(DARK_HOVER);
  });

  // Un hover más oscuro baja el contraste del texto encima: el acento de la
  // opción de orden activa y la pista gris de las acciones del "⋯" dejaban de
  // llegar a AA, así que al pasar el ratón cambian de color.
  const textColorUnderPointer: Record<string, string> = {
    ".directory-role:hover": "color-text",
    '.directory-sheet-option[aria-pressed="true"]:hover': "color-text",
    ".directory-sheet-action:hover:not(:disabled) .directory-sheet-action-hint":
      "color-text-soft",
  };

  it.each(Object.entries(textColorUnderPointer))(
    "%s pinta su texto con un token que cumple AA sobre el hover",
    (selector, cssVariable) => {
      const declared = /\scolor:\s*var\(--([\w-]+)\)/.exec(
        cssBlock(globalsCss, selector),
      )?.[1];
      expect(declared).toBe(cssVariable);
      for (const tokens of [rootCss, darkCss]) {
        expect(
          contrastRatio(
            token(tokens, cssVariable),
            token(tokens, "color-hover"),
          ),
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    },
  );
});

describe("tipografía", () => {
  it("la pila de texto declara una familia de respaldo genérica", () => {
    expect(token(rootCss, "font-family-body")).toMatch(/,\s*sans-serif\s*$/);
  });

  it("la pila de titulares declara una familia de respaldo genérica", () => {
    expect(token(rootCss, "font-family-heading")).toMatch(/,\s*sans-serif\s*$/);
  });

  it("la pila de datos y etiquetas declara una familia de respaldo genérica", () => {
    expect(token(rootCss, "font-family-mono")).toMatch(/,\s*monospace\s*$/);
  });

  it("cada familia de marca tiene su propia pila", () => {
    expect(token(rootCss, "font-family-body")).toMatch(/^Archivo/);
    expect(token(rootCss, "font-family-heading")).toMatch(/^"Space Grotesk"/);
    expect(token(rootCss, "font-family-mono")).toMatch(/^"Space Mono"/);
  });
});

describe("design-system.md no deja notas de provisionalidad", () => {
  it("no menciona 'provisional' en la sección de tokens", () => {
    const tokensStart = designSystem.indexOf("## Tokens");
    const tokensEnd = designSystem.indexOf("\n## ", tokensStart + 1);
    const tokensSection = designSystem.slice(
      tokensStart,
      tokensEnd === -1 ? undefined : tokensEnd,
    );
    expect(tokensSection.length).toBeGreaterThan(0);
    expect(tokensSection).not.toMatch(/provisional/i);
  });
});
