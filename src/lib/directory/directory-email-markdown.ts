import type { Nodes, PhrasingContent, RootContent } from "mdast";
import remarkBreaks from "remark-breaks";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { remarkKeepPlainTextLook } from "@/lib/news/news-markdown";

/**
 * El formato del correo del directorio (#857, D3 a D7 del PRD de E33). Este
 * módulo es el único que decide qué formato existe: el mensaje se lee como
 * Markdown y se queda en un árbol con una lista cerrada de nodos. El servidor
 * lo pinta como HTML de correo y como texto plano, y la vista previa del
 * redactor (#859) lo pinta en el navegador. Por eso no importa nada de
 * servidor.
 *
 * Lo que no está en la lista (HTML, títulos, imágenes, código, citas, enlaces
 * con un esquema no permitido) no se quita: sale como el texto que se
 * escribió. Así nada se pierde y nada que no sea de la lista llega al HTML.
 */

export type DirectoryEmailInline =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "break" }
  | {
      readonly type: "strong" | "emphasis";
      readonly children: readonly DirectoryEmailInline[];
    }
  | {
      readonly type: "link";
      readonly url: string;
      readonly children: readonly DirectoryEmailInline[];
    };

export type DirectoryEmailBlock =
  | {
      readonly type: "paragraph";
      readonly children: readonly DirectoryEmailInline[];
    }
  | {
      readonly type: "list";
      readonly ordered: boolean;
      readonly start: number;
      readonly children: readonly DirectoryEmailListItem[];
    };

export type DirectoryEmailListItem = {
  readonly type: "listItem";
  readonly children: readonly DirectoryEmailBlock[];
};

export type DirectoryEmailMessage = {
  readonly children: readonly DirectoryEmailBlock[];
};

/** Lo que el HTML toma de la plantilla del correo: el estilo del texto y el
 * acento del club para los enlaces (D7). */
export type DirectoryEmailHtmlStyles = {
  readonly textStyle: string;
  readonly linkColor: string;
};

const ALLOWED_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const FIRST_LIST_NUMBER = 1;
const LIST_INDENT_PX = 24;
const LINE_SEPARATOR = /\r?\n|\r/;

/** Lista blanca: una dirección relativa, `javascript:` o `ftp:` no es un
 * enlace en un correo. */
function isAllowedLinkUrl(url: string): boolean {
  try {
    return ALLOWED_LINK_SCHEMES.has(new URL(url).protocol.toLowerCase());
  } catch {
    return false;
  }
}

/** El texto que el autor escribió para ese nodo, con sus saltos de línea. */
function writtenInlines(node: Nodes, source: string): DirectoryEmailInline[] {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error(`El nodo ${node.type} no trae su posición en el mensaje`);
  }
  return source
    .slice(start, end)
    .split(LINE_SEPARATOR)
    .flatMap((line, index): DirectoryEmailInline[] => [
      ...(index === 0 ? [] : [{ type: "break" } as const]),
      ...(line === "" ? [] : [{ type: "text", value: line } as const]),
    ]);
}

function toInlines(
  nodes: readonly PhrasingContent[],
  source: string,
): DirectoryEmailInline[] {
  return nodes.flatMap((node) => toInline(node, source));
}

function toInline(
  node: PhrasingContent,
  source: string,
): DirectoryEmailInline[] {
  switch (node.type) {
    case "text":
      return [{ type: "text", value: node.value }];
    case "break":
      return [{ type: "break" }];
    case "strong":
    case "emphasis":
      return [{ type: node.type, children: toInlines(node.children, source) }];
    case "link":
      return isAllowedLinkUrl(node.url)
        ? [
            {
              type: "link",
              url: node.url,
              children: toInlines(node.children, source),
            },
          ]
        : writtenInlines(node, source);
    default:
      return writtenInlines(node, source);
  }
}

function toListItem(
  node: Extract<RootContent, { type: "listItem" }>,
  source: string,
): DirectoryEmailListItem {
  return {
    type: "listItem",
    children: node.children.map((child) => toBlock(child, source)),
  };
}

function toBlock(node: RootContent, source: string): DirectoryEmailBlock {
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", children: toInlines(node.children, source) };
    case "list":
      return {
        type: "list",
        ordered: node.ordered === true,
        start: node.start ?? FIRST_LIST_NUMBER,
        children: node.children.map((item) => toListItem(item, source)),
      };
    default:
      return { type: "paragraph", children: writtenInlines(node, source) };
  }
}

/** Sin `remark-gfm`: las tablas, los tachados y los enlaces sueltos de GFM no
 * existen aquí, y se quedan en texto. `remark-breaks` respeta cada salto de
 * línea simple, como el correo de texto plano de siempre (#501). */
export function parseDirectoryEmailMessage(
  message: string,
): DirectoryEmailMessage {
  const root = unified()
    .use(remarkParse)
    .use(remarkKeepPlainTextLook)
    .parse(message);
  // Se llama a la transformación a mano: pasada por `runSync`, el tipo del
  // árbol se pierde, porque `remark-breaks` cambia el árbol en su sitio.
  remarkBreaks()(root);
  return {
    children: root.children.map((child) => toBlock(child, message)),
  };
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => HTML_ESCAPES[character] ?? character,
  );
}

function inlinesHtml(
  inlines: readonly DirectoryEmailInline[],
  styles: DirectoryEmailHtmlStyles,
): string {
  return inlines.map((inline) => inlineHtml(inline, styles)).join("");
}

function inlineHtml(
  inline: DirectoryEmailInline,
  styles: DirectoryEmailHtmlStyles,
): string {
  switch (inline.type) {
    case "text":
      return escapeHtml(inline.value);
    case "break":
      return "<br>\n";
    case "strong":
      return `<strong>${inlinesHtml(inline.children, styles)}</strong>`;
    case "emphasis":
      return `<em>${inlinesHtml(inline.children, styles)}</em>`;
    case "link":
      return `<a href="${escapeHtml(inline.url)}" style="color: ${styles.linkColor}; text-decoration: underline;">${inlinesHtml(inline.children, styles)}</a>`;
  }
}

/** En un elemento de lista el párrafo no lleva `<p>`: su margen separaría
 * cada línea de la siguiente. Una lista dentro ya es un bloque, y no
 * necesita salto antes. */
function listItemHtml(
  item: DirectoryEmailListItem,
  styles: DirectoryEmailHtmlStyles,
): string {
  const content = item.children.map((block, index) => {
    if (block.type === "list") {
      return `\n${blockHtml(block, styles)}`;
    }
    const separator = index === 0 ? "" : "<br>\n";
    return `${separator}${inlinesHtml(block.children, styles)}`;
  });
  return `<li>${content.join("")}</li>`;
}

function blockHtml(
  block: DirectoryEmailBlock,
  styles: DirectoryEmailHtmlStyles,
): string {
  if (block.type === "paragraph") {
    return `<p style="${styles.textStyle}">${inlinesHtml(block.children, styles)}</p>`;
  }
  const tag = block.ordered ? "ol" : "ul";
  const start =
    block.ordered && block.start !== FIRST_LIST_NUMBER
      ? ` start="${block.start}"`
      : "";
  const items = block.children.map((item) => listItemHtml(item, styles));
  return [
    `<${tag}${start} style="${styles.textStyle} padding-left: ${LIST_INDENT_PX}px;">`,
    ...items,
    `</${tag}>`,
  ].join("\n");
}

/** Estilos en línea y nada de `<style>`: Gmail y Outlook ignoran las hojas de
 * estilo (D7). */
export function renderDirectoryEmailMessageHtml(
  message: DirectoryEmailMessage,
  styles: DirectoryEmailHtmlStyles,
): string {
  return message.children.map((block) => blockHtml(block, styles)).join("\n");
}

function inlinesText(inlines: readonly DirectoryEmailInline[]): string {
  return inlines.map(inlineText).join("");
}

/** Un enlace deja su dirección entre paréntesis, salvo que el texto ya sea
 * la dirección (`<https://club.org>`). */
function inlineText(inline: DirectoryEmailInline): string {
  switch (inline.type) {
    case "text":
      return inline.value;
    case "break":
      return "\n";
    case "strong":
    case "emphasis":
      return inlinesText(inline.children);
    case "link": {
      const label = inlinesText(inline.children);
      const address = inline.url.replace(/^mailto:/i, "");
      return label === inline.url || label === address
        ? label
        : `${label} (${inline.url})`;
    }
  }
}

/** Las líneas de un elemento después de la primera se sangran hasta el texto
 * de su marca, como se escribe una lista dentro de otra. */
function listItemText(item: DirectoryEmailListItem, marker: string): string {
  const indent = " ".repeat(marker.length);
  const lines = item.children.map(blockText).join("\n").split("\n");
  return lines
    .map((line, index) => (index === 0 ? marker : indent) + line)
    .join("\n");
}

function blockText(block: DirectoryEmailBlock): string {
  if (block.type === "paragraph") {
    return inlinesText(block.children);
  }
  return block.children
    .map((item, index) =>
      listItemText(item, block.ordered ? `${block.start + index}. ` : "- "),
    )
    .join("\n");
}

/** El texto plano conserva lo que se lee: las listas con su marca, los
 * párrafos separados por una línea en blanco. */
export function renderDirectoryEmailMessageText(
  message: DirectoryEmailMessage,
): string {
  return message.children.map(blockText).join("\n\n");
}
