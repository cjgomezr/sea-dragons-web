import { describe, expect, it } from "vitest";
import { type BodyEdit, applyBodyFormat } from "@/lib/news/news-body-format";

/**
 * La barra de formato del editor de noticias (#598, RF-9 del PRD de E22):
 * cada botón cambia el texto y deja una selección nueva. Aquí se prueba sin
 * componente, con el texto marcado así: `[` y `]` son el principio y el fin
 * de la selección, y `|` es el cursor cuando no hay nada seleccionado.
 */

function parse(marked: string): BodyEdit {
  const cursor = marked.indexOf("|");
  if (cursor !== -1) {
    return {
      text: marked.replace("|", ""),
      selection: { start: cursor, end: cursor },
    };
  }
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return {
    text: marked.replace("[", "").replace("]", ""),
    selection: { start, end },
  };
}

function mark(edit: BodyEdit): string {
  const { text, selection } = edit;
  if (selection.start === selection.end) {
    return `${text.slice(0, selection.start)}|${text.slice(selection.start)}`;
  }
  return `${text.slice(0, selection.start)}[${text.slice(
    selection.start,
    selection.end,
  )}]${text.slice(selection.end)}`;
}

describe("envolver la selección", () => {
  it.each([
    ["bold", "Traed [gorro] y aletas", "Traed **[gorro]** y aletas"],
    ["italic", "Traed [gorro] y aletas", "Traed *[gorro]* y aletas"],
    ["link", "Ver [la web] hoy", "Ver [[la web]](https://) hoy"],
  ] as const)(
    "%s envuelve lo seleccionado y lo deja seleccionado",
    (format, before, after) => {
      expect(mark(applyBodyFormat(parse(before), format))).toBe(after);
    },
  );

  it("envuelve una selección al principio del texto", () => {
    expect(mark(applyBodyFormat(parse("[Hoy] no hay agua"), "bold"))).toBe(
      "**[Hoy]** no hay agua",
    );
  });

  it("envuelve una selección al final del texto", () => {
    expect(mark(applyBodyFormat(parse("No hay [agua]"), "italic"))).toBe(
      "No hay *[agua]*",
    );
  });

  it("sin selección, negrita inserta cuatro asteriscos con el cursor en medio", () => {
    expect(mark(applyBodyFormat(parse("Traed |gorro"), "bold"))).toBe(
      "Traed **|**gorro",
    );
  });

  it("sin selección y con el texto vacío, cursiva deja el cursor entre los dos asteriscos", () => {
    expect(mark(applyBodyFormat(parse("|"), "italic"))).toBe("*|*");
  });

  it("sin selección, enlace deja el cursor donde va el texto", () => {
    expect(mark(applyBodyFormat(parse("Ver |"), "link"))).toBe(
      "Ver [|](https://)",
    );
  });
});

describe("prefijar las líneas", () => {
  it.each([
    ["heading", "## "],
    ["bulletList", "- "],
    ["numberedList", "1. "],
    ["quote", "> "],
  ] as const)(
    "%s pone el prefijo a cada línea seleccionada",
    (format, prefix) => {
      const result = applyBodyFormat(
        parse("Antes\n[gorro\naletas]\nDespués"),
        format,
      );

      expect(mark(result)).toBe(
        `Antes\n${prefix}[gorro\n${prefix}aletas]\nDespués`,
      );
    },
  );

  it("prefija la línea entera aunque la selección empiece a mitad", () => {
    expect(mark(applyBodyFormat(parse("Tra[ed gorro]"), "bulletList"))).toBe(
      "- Tra[ed gorro]",
    );
  });

  it("sin selección prefija la línea del cursor y el cursor sigue en su sitio", () => {
    expect(mark(applyBodyFormat(parse("Uno\nDo|s\nTres"), "heading"))).toBe(
      "Uno\n## Do|s\nTres",
    );
  });

  it("prefija la primera línea del texto", () => {
    expect(mark(applyBodyFormat(parse("|Material"), "quote"))).toBe(
      "> |Material",
    );
  });

  it("prefija la última línea del texto", () => {
    expect(mark(applyBodyFormat(parse("Uno\n[Dos]"), "numberedList"))).toBe(
      "Uno\n1. [Dos]",
    );
  });

  it("salta las líneas vacías de una selección de varias líneas", () => {
    expect(
      mark(applyBodyFormat(parse("[gorro\n\naletas]"), "bulletList")),
    ).toBe("- [gorro\n\n- aletas]");
  });

  it("prefija una línea vacía cuando el cursor está en ella", () => {
    expect(mark(applyBodyFormat(parse("Uno\n|"), "heading"))).toBe("Uno\n## |");
  });

  it("con el cursor al principio de un texto que empieza en blanco, prefija esa línea vacía", () => {
    expect(mark(applyBodyFormat(parse("|\nabc"), "heading"))).toBe("## |\nabc");
  });

  it("una selección desde el principio de un texto que empieza en blanco conserva su inicio", () => {
    expect(mark(applyBodyFormat(parse("[\nabc]"), "bulletList"))).toBe(
      "[\n- abc]",
    );
  });
});
