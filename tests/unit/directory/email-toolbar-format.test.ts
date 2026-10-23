import { describe, expect, it } from "vitest";
import {
  type EmailFormatPlaceholders,
  applyEmailFormat,
} from "@/lib/directory/email-toolbar-format";
import type { BodyEdit } from "@/lib/news/news-body-format";

/**
 * La barra de formato del correo (#859, RF-4 del PRD de E33): cada botón toma
 * el texto y la selección del área y devuelve los nuevos. Sin componente, así
 * que se prueba con cadenas.
 */

const PLACEHOLDERS: EmailFormatPlaceholders = {
  bold: "texto en negrita",
  italic: "texto en cursiva",
  link: "texto del enlace",
};

/** Lo que queda seleccionado después del formato. */
function selectedText(edit: BodyEdit): string {
  return edit.text.slice(edit.selection.start, edit.selection.end);
}

function select(text: string, selected: string): BodyEdit {
  const start = text.indexOf(selected);
  if (start === -1) {
    throw new Error(`"${selected}" no está en "${text}"`);
  }
  return { text, selection: { start, end: start + selected.length } };
}

function caretAt(text: string, index: number): BodyEdit {
  return { text, selection: { start: index, end: index } };
}

describe("negrita y cursiva", () => {
  it("envuelve la selección en ** y la deja seleccionada", () => {
    const edit = applyEmailFormat(
      select("El sábado a las 8", "sábado"),
      "bold",
      PLACEHOLDERS,
    );

    expect(edit.text).toBe("El **sábado** a las 8");
    expect(selectedText(edit)).toBe("sábado");
  });

  it("envuelve la selección en _ para la cursiva", () => {
    const edit = applyEmailFormat(
      select("Trae tus aletas", "tus"),
      "italic",
      PLACEHOLDERS,
    );

    expect(edit.text).toBe("Trae _tus_ aletas");
    expect(selectedText(edit)).toBe("tus");
  });

  it("sin selección inserta el texto de ejemplo de la negrita, seleccionado", () => {
    const edit = applyEmailFormat(caretAt("Hola ", 5), "bold", PLACEHOLDERS);

    expect(edit.text).toBe("Hola **texto en negrita**");
    expect(selectedText(edit)).toBe("texto en negrita");
  });

  it("sin selección inserta el texto de ejemplo de la cursiva, seleccionado", () => {
    const edit = applyEmailFormat(caretAt("", 0), "italic", PLACEHOLDERS);

    expect(edit.text).toBe("_texto en cursiva_");
    expect(selectedText(edit)).toBe("texto en cursiva");
  });
});

describe("el enlace", () => {
  it("convierte la selección en [selección](https://) con https:// seleccionado", () => {
    const edit = applyEmailFormat(
      select("Mira la hoja de coches", "la hoja"),
      "link",
      PLACEHOLDERS,
    );

    expect(edit.text).toBe("Mira [la hoja](https://) de coches");
    expect(selectedText(edit)).toBe("https://");
  });

  it("sin selección pone el texto de ejemplo y selecciona https://", () => {
    const edit = applyEmailFormat(caretAt("", 0), "link", PLACEHOLDERS);

    expect(edit.text).toBe("[texto del enlace](https://)");
    expect(selectedText(edit)).toBe("https://");
  });
});

describe("las listas", () => {
  const THREE_LINES = "Aletas\nGorro\nTubo";

  it("numera las tres líneas seleccionadas y deja el bloque seleccionado", () => {
    const edit = applyEmailFormat(
      { text: THREE_LINES, selection: { start: 0, end: THREE_LINES.length } },
      "numberedList",
      PLACEHOLDERS,
    );

    expect(edit.text).toBe("1. Aletas\n2. Gorro\n3. Tubo");
    expect(selectedText(edit)).toBe(edit.text);
  });

  it("pone una viñeta a cada línea", () => {
    const edit = applyEmailFormat(
      { text: THREE_LINES, selection: { start: 0, end: THREE_LINES.length } },
      "bulletList",
      PLACEHOLDERS,
    );

    expect(edit.text).toBe("- Aletas\n- Gorro\n- Tubo");
  });

  it("reemplaza la viñeta por el número en vez de sumar dos marcas", () => {
    const bulleted = "- Aletas\n- Gorro\n- Tubo";

    const edit = applyEmailFormat(
      { text: bulleted, selection: { start: 0, end: bulleted.length } },
      "numberedList",
      PLACEHOLDERS,
    );

    expect(edit.text).toBe("1. Aletas\n2. Gorro\n3. Tubo");
  });

  it("reemplaza el número por la viñeta", () => {
    const numbered = "1. Aletas\n2) Gorro";

    const edit = applyEmailFormat(
      { text: numbered, selection: { start: 0, end: numbered.length } },
      "bulletList",
      PLACEHOLDERS,
    );

    expect(edit.text).toBe("- Aletas\n- Gorro");
  });

  it("toma las líneas enteras aunque la selección empiece y acabe a medias", () => {
    const text = "Hola:\nAletas\nGorro\nAdiós";

    const edit = applyEmailFormat(
      {
        text,
        selection: { start: text.indexOf("tas"), end: text.indexOf("rro") },
      },
      "bulletList",
      PLACEHOLDERS,
    );

    expect(edit.text).toBe("Hola:\n- Aletas\n- Gorro\nAdiós");
    expect(selectedText(edit)).toBe("- Aletas\n- Gorro");
  });

  it("sin selección marca la línea del cursor", () => {
    const text = "Hola\nAletas";

    const edit = applyEmailFormat(
      caretAt(text, 7),
      "numberedList",
      PLACEHOLDERS,
    );

    expect(edit.text).toBe("Hola\n1. Aletas");
  });

  it("salta las líneas vacías de en medio y sigue la cuenta", () => {
    const text = "Aletas\n\nGorro";

    const edit = applyEmailFormat(
      { text, selection: { start: 0, end: text.length } },
      "numberedList",
      PLACEHOLDERS,
    );

    expect(edit.text).toBe("1. Aletas\n\n2. Gorro");
  });
});
