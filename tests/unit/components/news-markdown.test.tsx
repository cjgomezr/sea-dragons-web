import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NewsMarkdown } from "@/components/news/NewsMarkdown";

/**
 * El cuerpo de una noticia pintado como Markdown seguro (#593, RF-6 del PRD
 * de E22). El cuerpo se guarda como texto (D9): las publicaciones de texto
 * plano tienen que verse igual que antes, y nada de lo que alguien escriba
 * puede colar HTML, scripts ni enlaces peligrosos.
 */

function renderBody(body: string): HTMLElement {
  const { container } = render(<NewsMarkdown body={body} />);
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error("NewsMarkdown rendered nothing");
  }
  return root;
}

describe("cada elemento de Markdown pinta su etiqueta", () => {
  it.each([
    ["# Título", 1],
    ["## Sección", 2],
    ["### Apartado", 3],
  ])("%s es un encabezado de nivel %i", (body, level) => {
    renderBody(body);

    expect(screen.getByRole("heading", { level })).toBeInTheDocument();
  });

  it("pinta la negrita y la cursiva", () => {
    const root = renderBody("Traed **gorro** y *aletas*.");

    expect(root.querySelector("strong")?.textContent).toBe("gorro");
    expect(root.querySelector("em")?.textContent).toBe("aletas");
  });

  it("pinta una lista con guiones", () => {
    renderBody("- gorro\n- aletas");

    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["gorro", "aletas"]);
  });

  it("pinta una lista numerada", () => {
    renderBody("1. calentar\n2. jugar");

    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("pinta una cita", () => {
    const root = renderBody("> Nadie juega solo.");

    expect(root.querySelector("blockquote")?.textContent?.trim()).toBe(
      "Nadie juega solo.",
    );
  });

  it("pinta un enlace con su texto", () => {
    renderBody("Mirad [el horario](https://example.com/horario).");

    expect(screen.getByRole("link", { name: "el horario" })).toHaveAttribute(
      "href",
      "https://example.com/horario",
    );
  });

  it("pinta el código en línea", () => {
    const root = renderBody("La clave es `MSAC-2026`.");

    expect(root.querySelector("code")?.textContent).toBe("MSAC-2026");
  });

  it("lleva la clase de la hoja de estilos del cuerpo", () => {
    const root = renderBody("Hola.");

    expect(root).toHaveClass("news-markdown");
  });
});

describe("el HTML crudo sale como texto", () => {
  it.each([
    ["<script>alert(1)</script>", "script"],
    ["<img src=x onerror=alert(1)>", "img"],
  ])("%s no crea ningún elemento %s", (body, tag) => {
    const root = renderBody(body);

    expect(root.querySelector(tag)).toBeNull();
    expect(root.textContent).toContain(body);
  });

  it("tampoco cuela HTML en medio de un párrafo", () => {
    const root = renderBody('Hola <b onclick="x()">equipo</b>.');

    expect(root.querySelector("b")).toBeNull();
    expect(root.textContent).toContain('<b onclick="x()">');
  });
});

describe("los enlaces sólo llevan esquemas seguros", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "JavaScript:alert(1)",
  ])("[x](%s) no es un enlace", (url) => {
    const root = renderBody(`[x](${url})`);

    expect(screen.queryByRole("link")).toBeNull();
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toContain("x");
  });

  it("un enlace externo abre aparte sin dar acceso a la página", () => {
    renderBody("[x](https://a.com)");

    const link = screen.getByRole("link", { name: "x" });
    expect(link).toHaveAttribute("href", "https://a.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("conserva el título del enlace", () => {
    renderBody('[x](https://a.com "Horario")');

    expect(screen.getByRole("link", { name: "x" })).toHaveAttribute(
      "title",
      "Horario",
    );
  });

  it("un correo es un enlace mailto", () => {
    renderBody("[x](mailto:a@b.com)");

    expect(screen.getByRole("link", { name: "x" })).toHaveAttribute(
      "href",
      "mailto:a@b.com",
    );
  });

  it("un ancla de la misma página es un enlace que no abre aparte", () => {
    renderBody("[x](#sec)");

    const link = screen.getByRole("link", { name: "x" });
    expect(link).toHaveAttribute("href", "#sec");
    expect(link).not.toHaveAttribute("target");
  });
});

describe("las publicaciones de texto plano se ven igual", () => {
  it("separa los párrafos por la línea en blanco y respeta cada salto simple", () => {
    const root = renderBody(
      "Please review the revised buddy-check policy.\nSignature required.\n\nThanks, the committee.",
    );

    const paragraphs = root.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.querySelectorAll("br")).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe(
      "Please review the revised buddy-check policy.\nSignature required.",
    );
    expect(paragraphs[1]?.textContent).toBe("Thanks, the committee.");
  });

  it.each([
    "El martes entrenamos en MSAC.",
    "El martes entrenamos en MSAC.\nTraed gorro.",
    "Entrenamiento extra el jueves.",
  ])("«%s» da el mismo texto visible", (body) => {
    const root = renderBody(body);

    expect(root.textContent).toBe(body);
  });
});

describe("lo que no se pinta", () => {
  it.each(["Hola **mundo", "- uno\n-", "1. uno\n2.", "[enlace roto](", "> "])(
    "el Markdown roto %j sale como texto sin lanzar",
    (body) => {
      expect(() => renderBody(body)).not.toThrow();
    },
  );

  it("un ** sin cerrar se ve tal cual", () => {
    const root = renderBody("Hola **mundo");

    expect(root.textContent).toBe("Hola **mundo");
    expect(root.querySelector("strong")).toBeNull();
  });

  it("una imagen no se carga", () => {
    const root = renderBody(
      "Antes ![pie](https://example.com/foto.jpg) después",
    );

    expect(root.querySelector("img")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
