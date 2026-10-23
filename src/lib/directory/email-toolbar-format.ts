import type { BodyEdit } from "@/lib/news/news-body-format";

/**
 * La barra de formato del correo del directorio (#859, RF-4 del PRD de E33),
 * sin componente: cada botón toma el texto y la selección del área y devuelve
 * los nuevos. Escribe sólo lo que `directory-email-markdown.ts` (#857) sabe
 * pintar, y nada más: negrita, cursiva, enlace y las dos listas.
 *
 * Se parece a la de Noticias (`news-body-format.ts`) pero no es la misma: sin
 * selección inserta un texto de ejemplo para escribir encima, la cursiva va
 * con `_`, el enlace deja seleccionada la dirección y las listas cambian la
 * marca que ya hubiera en vez de sumar otra.
 */

export const EMAIL_FORMATS = [
  "bold",
  "italic",
  "link",
  "bulletList",
  "numberedList",
] as const;

export type EmailFormat = (typeof EMAIL_FORMATS)[number];

/** Lo que se inserta cuando no hay nada seleccionado, en el idioma de la
 * pantalla. */
export type EmailFormatPlaceholders = {
  readonly bold: string;
  readonly italic: string;
  readonly link: string;
};

const EMPHASIS_MARKERS = { bold: "**", italic: "_" } as const;
const LINK_URL = "https://";
/** Una viñeta (`-`, `*`, `+`) o un número (`1.`, `2)`) al principio de la
 * línea, con el espacio que la sigue. */
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;

function emphasize(
  edit: BodyEdit,
  marker: string,
  placeholder: string,
): BodyEdit {
  const { text, selection } = edit;
  const inner = text.slice(selection.start, selection.end) || placeholder;
  const start = selection.start + marker.length;
  return {
    text: `${text.slice(0, selection.start)}${marker}${inner}${marker}${text.slice(selection.end)}`,
    selection: { start, end: start + inner.length },
  };
}

function linkify(edit: BodyEdit, placeholder: string): BodyEdit {
  const { text, selection } = edit;
  const label = text.slice(selection.start, selection.end) || placeholder;
  const urlStart = selection.start + `[${label}](`.length;
  return {
    text: `${text.slice(0, selection.start)}[${label}](${LINK_URL})${text.slice(selection.end)}`,
    selection: { start: urlStart, end: urlStart + LINK_URL.length },
  };
}

/** `lastIndexOf` con un índice negativo busca desde 0: sin la guarda, un
 * salto en la posición 0 se tomaría como el de la línea anterior. */
function lineStartBefore(text: string, index: number): number {
  return index === 0 ? 0 : text.lastIndexOf("\n", index - 1) + 1;
}

function lineEndAfter(text: string, index: number): number {
  const end = text.indexOf("\n", index);
  return end === -1 ? text.length : end;
}

/** Las líneas vacías de en medio se quedan como están y no cuentan: una
 * lista con un elemento vacío no es lo que nadie quería. */
function markLines(
  lines: readonly string[],
  format: "bulletList" | "numberedList",
): string[] {
  let number = 0;
  return lines.map((line) => {
    if (lines.length > 1 && line.trim() === "") {
      return line;
    }
    number += 1;
    const marker = format === "bulletList" ? "- " : `${number}. `;
    return marker + line.replace(LIST_MARKER, "");
  });
}

function listify(
  edit: BodyEdit,
  format: "bulletList" | "numberedList",
): BodyEdit {
  const { text, selection } = edit;
  const blockStart = lineStartBefore(text, selection.start);
  const blockEnd = lineEndAfter(text, selection.end);
  const lines = text.slice(blockStart, blockEnd).split("\n");
  const block = markLines(lines, format).join("\n");
  return {
    text: text.slice(0, blockStart) + block + text.slice(blockEnd),
    selection: { start: blockStart, end: blockStart + block.length },
  };
}

export function applyEmailFormat(
  edit: BodyEdit,
  format: EmailFormat,
  placeholders: EmailFormatPlaceholders,
): BodyEdit {
  switch (format) {
    case "bold":
    case "italic":
      return emphasize(edit, EMPHASIS_MARKERS[format], placeholders[format]);
    case "link":
      return linkify(edit, placeholders.link);
    case "bulletList":
    case "numberedList":
      return listify(edit, format);
  }
}
