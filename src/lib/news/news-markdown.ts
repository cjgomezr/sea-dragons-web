import type { Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * El cuerpo de una noticia se guarda como texto y se lee como Markdown (#593,
 * D9 del PRD de E22). Aquí vive lo que comparten la publicación y el feed:
 * qué enlaces se permiten y qué texto queda al quitarle el formato.
 */

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

/** El texto que se lee del cuerpo, sin marcas: los enlaces quedan en su texto
 * y las imágenes desaparecen. Los bloques quedan separados por espacios. */
export function newsBodyToPlainText(body: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(body);
  return plainTextOf(tree);
}
