/**
 * La barra de formato del editor de noticias (#598, RF-9 del PRD de E22),
 * sin componente: cada formato toma el texto y la selección del área y
 * devuelve los nuevos. Así el editor sólo tiene que pintar el resultado y
 * devolver la selección al área.
 *
 * Negrita, cursiva y enlace envuelven lo seleccionado y lo dejan
 * seleccionado, para poder seguir escribiendo encima. Los demás prefijan cada
 * línea que toca la selección; las líneas vacías de en medio se saltan, que
 * una lista con un elemento vacío no es lo que nadie quería.
 */

export type BodySelection = { readonly start: number; readonly end: number };

export type BodyEdit = {
  readonly text: string;
  readonly selection: BodySelection;
};

export const BODY_FORMATS = [
  "bold",
  "italic",
  "heading",
  "bulletList",
  "numberedList",
  "quote",
  "link",
] as const;

export type BodyFormat = (typeof BODY_FORMATS)[number];

type Wrapper = { readonly before: string; readonly after: string };

type FormatRule =
  | ({ readonly kind: "wrap" } & Wrapper)
  | { readonly kind: "prefixLines"; readonly prefix: string };

const FORMAT_RULES: Readonly<Record<BodyFormat, FormatRule>> = {
  bold: { kind: "wrap", before: "**", after: "**" },
  italic: { kind: "wrap", before: "*", after: "*" },
  link: { kind: "wrap", before: "[", after: "](https://)" },
  heading: { kind: "prefixLines", prefix: "## " },
  bulletList: { kind: "prefixLines", prefix: "- " },
  numberedList: { kind: "prefixLines", prefix: "1. " },
  quote: { kind: "prefixLines", prefix: "> " },
};

function wrapSelection(edit: BodyEdit, wrapper: Wrapper): BodyEdit {
  const { text, selection } = edit;
  const selected = text.slice(selection.start, selection.end);
  const start = selection.start + wrapper.before.length;
  return {
    text:
      text.slice(0, selection.start) +
      wrapper.before +
      selected +
      wrapper.after +
      text.slice(selection.end),
    selection: { start, end: start + selected.length },
  };
}

/** `lastIndexOf` lleva un índice negativo a 0: sin la guarda, un salto en la
 * posición 0 se tomaría como el de la línea anterior. */
function lineStartBefore(text: string, index: number): number {
  if (index === 0) {
    return 0;
  }
  return text.lastIndexOf("\n", index - 1) + 1;
}

function lineEndAfter(text: string, index: number): number {
  const end = text.indexOf("\n", index);
  return end === -1 ? text.length : end;
}

function prefixLines(edit: BodyEdit, prefix: string): BodyEdit {
  const { text, selection } = edit;
  const blockStart = lineStartBefore(text, selection.start);
  const blockEnd = lineEndAfter(text, selection.end);
  const lines = text.slice(blockStart, blockEnd).split("\n");
  const isSingleLine = lines.length === 1;
  const prefixed = lines.map((line) =>
    isSingleLine || line.trim() !== "" ? `${prefix}${line}` : line,
  );
  const block = prefixed.join("\n");
  const isFirstLinePrefixed = prefixed[0] !== lines[0];
  return {
    text: text.slice(0, blockStart) + block + text.slice(blockEnd),
    selection: {
      start: selection.start + (isFirstLinePrefixed ? prefix.length : 0),
      end: selection.end + block.length - (blockEnd - blockStart),
    },
  };
}

export function applyBodyFormat(edit: BodyEdit, format: BodyFormat): BodyEdit {
  const rule = FORMAT_RULES[format];
  return rule.kind === "wrap"
    ? wrapSelection(edit, rule)
    : prefixLines(edit, rule.prefix);
}

/** Una imagen del club (#603) donde está el cursor: `![pie](dirección)`. Lo
 * seleccionado pasa a ser el pie y queda seleccionado; sin selección, el
 * cursor queda entre los corchetes para escribirlo. */
export function insertBodyImage(edit: BodyEdit, url: string): BodyEdit {
  return wrapSelection(edit, { before: "![", after: `](${url})` });
}
