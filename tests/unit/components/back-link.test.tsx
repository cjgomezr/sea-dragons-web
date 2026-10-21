import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BackLink } from "@/components/BackLink";
import { englishMessages } from "@/lib/i18n/messages/en";
import { spanishMessages } from "@/lib/i18n/messages/es";

/**
 * El enlace de volver del escritorio: un botón discreto con la flecha, el
 * mismo en todas las pantallas que vuelven a su sección (la ficha, el alta,
 * las categorías de evaluación y las noticias).
 */

const GLOBALS_CSS = readFileSync("src/app/globals.css", "utf8");

/** El cuerpo de la primera regla cuyo selector es exactamente `selector`. */
function ruleBody(selector: string): string {
  const start = GLOBALS_CSS.indexOf(`\n${selector} {`);
  if (start === -1) {
    throw new Error(`Falta la regla ${selector}`);
  }
  const open = GLOBALS_CSS.indexOf("{", start);
  return GLOBALS_CSS.slice(open + 1, GLOBALS_CSS.indexOf("}", open));
}

describe("el enlace de volver del escritorio", () => {
  it("es un enlace a su sección con el texto como nombre", () => {
    render(<BackLink href="/directorio">Directory</BackLink>);

    expect(screen.getByRole("link", { name: "Directory" })).toHaveAttribute(
      "href",
      "/directorio",
    );
  });

  it("lleva la flecha como icono, no como texto", () => {
    render(<BackLink href="/noticias">Back to News</BackLink>);

    const link = screen.getByRole("link", { name: "Back to News" });
    expect(link.textContent).toBe("Back to News");
    expect(link.querySelector("svg")).not.toBeNull();
  });

  it("se pinta como un botón discreto, sin subrayado y de 44 px de alto", () => {
    const body = ruleBody(".back-link");

    expect(body).toContain("text-decoration: none");
    expect(body).toContain("min-height: var(--touch-target-min)");
    expect(body).toContain("color: var(--color-text-soft)");
    expect(ruleBody(".back-link:hover")).toContain(
      "background: var(--color-hover)",
    );
  });

  it("los textos de volver ya no llevan la flecha escrita", () => {
    const keys = [
      "news.post.back",
      "news.publish.back",
      "news.edit.back",
    ] as const;

    for (const key of keys) {
      expect(englishMessages[key]).not.toContain("←");
      expect(spanishMessages[key]).not.toContain("←");
    }
  });
});
