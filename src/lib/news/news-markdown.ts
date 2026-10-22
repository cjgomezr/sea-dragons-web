import type { Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { type PluggableList, type Processor, unified } from "unified";
import { readNewsInlineImageId } from "./news-inline-image-urls";

/**
 * El cuerpo de una noticia se guarda como texto y se lee como Markdown (#593,
 * D9 del PRD de E22). Aquí vive lo que comparten la publicación y el feed:
 * cómo se lee el Markdown, qué enlaces se permiten y qué texto queda al
 * quitarle el formato.
 */

/** Construcciones de micromark que cambiarían el aspecto de una noticia
 * antigua de texto plano (#609): una línea de `---` o `===` debajo de otra la
 * volvería encabezado, una sangría de cuatro espacios la volvería código y
 * `&amp;` se vería como `&`. El `---` entre líneas en blanco sigue siendo
 * separador y las comillas invertidas siguen siendo código. */
const PLAIN_TEXT_BREAKING_CONSTRUCTS = [
  "setextUnderline",
  "codeIndented",
  "characterReference",
];

export function remarkKeepPlainTextLook(this: Processor): void {
  const data = this.data();
  data.micromarkExtensions = [
    ...(data.micromarkExtensions ?? []),
    { disable: { null: PLAIN_TEXT_BREAKING_CONSTRUCTS } },
  ];
}

/** La misma lectura para la publicación y para el extracto del feed, para que
 * los dos vean el mismo texto. Con una sola tilde no se tacha: `~texto~` es
 * más fácil escribirlo sin querer que `~~texto~~`. */
export const NEWS_REMARK_PLUGINS: PluggableList = [
  [remarkGfm, { singleTilde: false }],
  remarkKeepPlainTextLook,
];

const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const EXTERNAL_LINK_SCHEMES = new Set(["http:", "https:"]);
const FRAGMENT_PREFIX = "#";

/** Cualquier href que no sea un ancla lleva esquema: los relativos no tienen
 * sentido en un cuerpo que también se lee desde la app del móvil (CON-002). */
function schemeOf(url: string): string | null {
  try {
    return new URL(url).protocol.toLowerCase();
  } catch {
    return null;
  }
}

/** Lista blanca y no negra: `javascript:`, `data:`, `vbscript:` y cualquier
 * esquema que aparezca mañana quedan fuera sin nombrarlos. */
export function isSafeNewsLinkUrl(url: string): boolean {
  if (url.startsWith(FRAGMENT_PREFIX)) {
    return true;
  }
  const scheme = schemeOf(url.trim());
  return scheme !== null && SAFE_LINK_SCHEMES.has(scheme);
}

export function isExternalNewsLinkUrl(url: string): boolean {
  const scheme = schemeOf(url.trim());
  return scheme !== null && EXTERNAL_LINK_SCHEMES.has(scheme);
}

// Sus hijos se leen como frases distintas: entre uno y otro va un espacio.
const BLOCK_CONTAINERS = new Set<Nodes["type"]>([
  "root",
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
  "footnoteDefinition",
]);

function plainTextOf(node: Nodes): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "code":
    case "html":
      // El HTML crudo se ve como texto en la publicación, y así se resume.
      return node.value;
    case "break":
      return " ";
    case "image":
    case "imageReference":
    case "definition":
      return "";
    default:
      break;
  }
  if (!("children" in node)) {
    return "";
  }
  const separator = BLOCK_CONTAINERS.has(node.type) ? " " : "";
  return node.children.map((child) => plainTextOf(child)).join(separator);
}

function parseNewsBody(body: string): Nodes {
  return unified().use(remarkParse).use(NEWS_REMARK_PLUGINS).parse(body);
}

/** El texto que se lee del cuerpo, sin marcas: los enlaces quedan en su texto
 * y las imágenes desaparecen. Los bloques quedan separados por espacios. */
export function newsBodyToPlainText(body: string): string {
  return plainTextOf(parseNewsBody(body));
}

/** Las direcciones de imagen del cuerpo: las de `![](...)` y las de una
 * definición, que es a donde apunta `![pie][ref]`. */
function imageUrlsOf(node: Nodes): readonly string[] {
  if (node.type === "image" || node.type === "definition") {
    return [node.url];
  }
  return "children" in node ? node.children.flatMap(imageUrlsOf) : [];
}

/** Los ids de las imágenes del club (#603) que el cuerpo enseña, en orden y
 * sin repetir. Lo que esté escrito dentro de un código no cuenta: se ve como
 * texto, no como imagen. */
export function findNewsInlineImageIds(body: string): readonly string[] {
  const ids = imageUrlsOf(parseNewsBody(body)).flatMap((url) => {
    const imageId = readNewsInlineImageId(url);
    return imageId === null ? [] : [imageId];
  });
  return [...new Set(ids)];
}
