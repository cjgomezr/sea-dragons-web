import { describe, expect, it } from "vitest";
import {
  parseDirectoryEmailMessage,
  renderDirectoryEmailMessageHtml,
  renderDirectoryEmailMessageText,
} from "@/lib/directory/directory-email-markdown";

/**
 * El formato del correo del directorio (#857, RF-1 y D3 a D7 del PRD de E33).
 * Lo que no está en la lista cerrada de D5 sale como el texto que se
 * escribió, escapado en el HTML.
 */

const TEXT_STYLE = "margin: 0 0 16px; color: #1C3245;";
const LINK_COLOR = "#0B5F86";
const STYLES = { textStyle: TEXT_STYLE, linkColor: LINK_COLOR };

function htmlOf(message: string): string {
  return renderDirectoryEmailMessageHtml(
    parseDirectoryEmailMessage(message),
    STYLES,
  );
}

function textOf(message: string): string {
  return renderDirectoryEmailMessageText(parseDirectoryEmailMessage(message));
}

const AUTHOR_TAG_PATTERN = /<(?!\/?(p|br|strong|em|a|ul|ol|li)[\s>])/;

describe("árbol restringido", () => {
  it("deja solo párrafos con negrita y cursiva", () => {
    expect(parseDirectoryEmailMessage("**Hola** _equipo_")).toEqual({
      children: [
        {
          type: "paragraph",
          children: [
            { type: "strong", children: [{ type: "text", value: "Hola" }] },
            { type: "text", value: " " },
            { type: "emphasis", children: [{ type: "text", value: "equipo" }] },
          ],
        },
      ],
    });
  });

  it("convierte una imagen en el texto que se escribió", () => {
    expect(parseDirectoryEmailMessage("![foto](https://a/b.png)")).toEqual({
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "![foto](https://a/b.png)" }],
        },
      ],
    });
  });
});

describe("negrita y cursiva", () => {
  it("las lleva al HTML como strong y em", () => {
    const html = htmlOf("**Hola** _equipo_");

    expect(html).toContain("<strong>Hola</strong>");
    expect(html).toContain("<em>equipo</em>");
  });

  it("las quita del texto plano", () => {
    expect(textOf("**Hola** _equipo_")).toBe("Hola equipo");
  });
});

describe("listas", () => {
  it("pinta una lista con viñetas como ul con un li por línea", () => {
    const html = htmlOf("- uno\n- dos");

    expect(html).toMatch(/<ul[\s>]/);
    expect(html.match(/<li[\s>]/g)).toHaveLength(2);
  });

  it("pinta una lista numerada como ol con un li por línea", () => {
    const html = htmlOf("1. uno\n2. dos");

    expect(html).toMatch(/<ol[\s>]/);
    expect(html.match(/<li[\s>]/g)).toHaveLength(2);
  });

  it("conserva en el texto plano cada línea con su viñeta", () => {
    expect(textOf("- uno\n- dos")).toBe("- uno\n- dos");
  });

  it("conserva en el texto plano cada línea con su número", () => {
    expect(textOf("1. uno\n2. dos")).toBe("1. uno\n2. dos");
  });

  it("numera desde donde empieza la lista", () => {
    expect(htmlOf("3. tres\n4. cuatro")).toContain('<ol start="3"');
    expect(textOf("3. tres\n4. cuatro")).toBe("3. tres\n4. cuatro");
  });

  it("pone la sangría de la lista en línea", () => {
    expect(htmlOf("- uno")).toMatch(/<ul style="[^"]*padding-left: \d+px/);
  });

  it("separa la lista del párrafo en el texto plano", () => {
    expect(textOf("Traed:\n\n- aletas\n- gorro")).toBe(
      "Traed:\n\n- aletas\n- gorro",
    );
  });

  it("pinta una lista dentro de otra sin salto de línea antes", () => {
    expect(htmlOf("- uno\n  - dentro")).toMatch(/<li>uno\n<ul /);
  });

  it("sangra en el texto plano una lista dentro de otra", () => {
    expect(textOf("- uno\n  - dentro")).toBe("- uno\n  - dentro");
  });
});

describe("enlaces", () => {
  it.each([
    ["[web](https://club.org)", "https://club.org", "web"],
    ["[escríbeme](mailto:a@b.org)", "mailto:a@b.org", "escríbeme"],
    ["[web](http://club.org)", "http://club.org", "web"],
  ])("lleva %s al HTML como enlace", (message, url, label) => {
    expect(htmlOf(message)).toMatch(
      new RegExp(`<a href="${url}"[^>]*>${label}</a>`),
    );
  });

  it("pone en el texto plano la dirección entre paréntesis", () => {
    expect(textOf("[web](https://club.org)")).toBe("web (https://club.org)");
  });

  it("no repite la dirección si el texto ya es la dirección", () => {
    expect(textOf("<https://club.org>")).toBe("https://club.org");
  });

  it("lleva el color de acento del club en línea", () => {
    expect(htmlOf("[web](https://club.org)")).toMatch(
      new RegExp(`<a href="https://club.org" style="[^"]*color: ${LINK_COLOR}`),
    );
  });

  it("escapa la dirección del enlace", () => {
    expect(htmlOf('[web](https://club.org/?a=1&b="2")')).toContain(
      'href="https://club.org/?a=1&amp;b=&quot;2&quot;"',
    );
  });

  it.each(["[x](javascript:alert(1))", "[x](ftp://a)", "[x](/relativa)"])(
    "deja %s como el texto que se escribió",
    (message) => {
      const html = htmlOf(message);

      expect(html).not.toContain("<a");
      expect(html).toContain(message);
      expect(textOf(message)).toBe(message);
    },
  );
});

describe("lo que no está en la lista", () => {
  it.each([
    ["<b>hola</b>", "&lt;b&gt;hola&lt;/b&gt;"],
    ["<div>\nhola\n</div>", "&lt;div&gt;"],
    ["# Título", "# Título"],
    ["![foto](https://a/b.png)", "![foto](https://a/b.png)"],
    ["| a | b |\n| - | - |\n| 1 | 2 |", "| a | b |"],
    ["```\ncódigo\n```", "```"],
    ["`código`", "`código`"],
    ["> cita", "&gt; cita"],
    ["***", "***"],
  ])("deja %s como texto escapado", (message, escaped) => {
    const html = htmlOf(message);

    expect(html).not.toMatch(AUTHOR_TAG_PATTERN);
    expect(html).toContain(escaped);
  });

  it("deja el bloque de código con sus saltos de línea", () => {
    expect(textOf("```\ncódigo\n```")).toBe("```\ncódigo\n```");
  });
});

describe("Markdown roto", () => {
  it("deja una negrita sin cerrar como texto", () => {
    expect(htmlOf("**sin cerrar")).toBe(
      `<p style="${TEXT_STYLE}">**sin cerrar</p>`,
    );
    expect(textOf("**sin cerrar")).toBe("**sin cerrar");
  });

  it("deja un enlace sin cerrar como texto", () => {
    expect(htmlOf("[web](https://club.org")).toBe(
      `<p style="${TEXT_STYLE}">[web](https://club.org</p>`,
    );
  });
});

describe("texto plano antiguo", () => {
  it("da los mismos párrafos y saltos de línea que antes del formato", () => {
    const message =
      "Hola:\n\nEl sábado entrenamos a las 8.\n<b>Traed aletas</b> & gorro";

    expect(htmlOf(message)).toBe(
      [
        `<p style="${TEXT_STYLE}">Hola:</p>`,
        `<p style="${TEXT_STYLE}">El sábado entrenamos a las 8.<br>\n&lt;b&gt;Traed aletas&lt;/b&gt; &amp; gorro</p>`,
      ].join("\n"),
    );
  });

  it("no convierte en entidad un &amp; escrito", () => {
    expect(htmlOf("Tom &amp; Ana")).toContain("Tom &amp;amp; Ana");
  });

  it("no convierte en título una línea subrayada", () => {
    expect(htmlOf("Aviso\n---")).not.toContain("<h2");
  });

  it("no convierte en código una línea con sangría", () => {
    expect(htmlOf("Hola\n\n    sangrado")).toContain("sangrado</p>");
  });

  it("no da párrafos para un mensaje vacío", () => {
    expect(htmlOf("")).toBe("");
  });
});
