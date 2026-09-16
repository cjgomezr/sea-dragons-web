import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cssBlock,
  cssCustomProperties,
  readGlobalsCss,
} from "./helpers/css-tokens";
import { contrastRatio } from "./helpers/wcag-contrast";

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
  Background: "color-background",
  Panel: "color-panel",
  Text: "color-text",
  "Text secondary": "color-text-secondary",
  Border: "color-border",
  Success: "color-success",
  Warning: "color-warning",
  "Text on accent": "color-on-accent",
  Danger: "color-danger",
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
        contrastRatio(token(tokens, "color-danger"), token(tokens, "color-background")),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(token(tokens, "color-danger"), token(tokens, "color-panel")),
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
