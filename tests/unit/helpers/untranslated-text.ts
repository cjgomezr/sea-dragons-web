import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

type LooseCatalog = Readonly<Record<string, unknown>>;

export type MissingKey = { readonly key: string; readonly locale: string };

/** Cada clave que algún idioma tiene y otro no, con el idioma al que le falta.
 * Compara contra la unión de todas las claves y no contra el inglés: una clave
 * nueva escrita solo en español también es un olvido. */
export function findMissingKeys(
  catalogs: Readonly<Record<string, LooseCatalog>>,
): MissingKey[] {
  const allKeys = [...new Set(Object.values(catalogs).flatMap(Object.keys))];
  return Object.entries(catalogs).flatMap(([locale, catalog]) =>
    allKeys
      .filter((key) => !Object.hasOwn(catalog, key))
      .map((key) => ({ key, locale })),
  );
}

export type UntranslatedText = { readonly file: string; readonly text: string };

type ComponentSource = { readonly file: string; readonly source: string };

/** Los atributos que alguien lee en pantalla o escucha en un lector. El resto
 * (`className`, `id`, `href`, `role`...) no se ve, y marcarlo sería el falso
 * positivo que acaba con el test silenciado. */
const VISIBLE_ATTRIBUTES: ReadonlySet<string> = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "label",
  "placeholder",
  "title",
]);

/** Nombres propios que se escriben igual en todos los idiomas. El largo va
 * primero para que no lo parta el corto. */
const UNTRANSLATABLE_NAMES = [
  "Victoria Seadragons UWR Club",
  "Victoria Seadragons",
  "Seadragons",
];

// Una palabra son al menos dos letras seguidas: así no cuentan los signos
// sueltos, los números ni una "x" de cerrar.
const WORD = /\p{L}{2,}/u;
const HTML_ENTITY = /&#?\w+;/g;
const EMAIL = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;
const URL_WITH_SCHEME = /^[a-z][\w+.-]*:\/\/\S+$/i;
const ABSOLUTE_PATH = /^\/\S*$/;
// "GET", "UWR": las siglas se leen igual en los dos idiomas.
const ACRONYM = /^\p{Lu}{2,}$/u;

// La puntuación pegada a una dirección ("hola@seadragons.club.") no la hace
// traducible.
const SURROUNDING_PUNCTUATION = /^[("'¿¡]+|[)"'.,;:!?]+$/g;

function isUntranslatableToken(token: string): boolean {
  const bare = token.replace(SURROUNDING_PUNCTUATION, "");
  return [EMAIL, URL_WITH_SCHEME, ABSOLUTE_PATH, ACRONYM].some((pattern) =>
    pattern.test(bare),
  );
}

function isTranslatableText(raw: string): boolean {
  const withoutNames = UNTRANSLATABLE_NAMES.reduce(
    (remaining, name) => remaining.replaceAll(name, " "),
    raw.replace(HTML_ENTITY, " "),
  );
  return withoutNames
    .split(/\s+/)
    .filter((token) => !isUntranslatableToken(token))
    .some((token) => WORD.test(token));
}

/** Los literales de una expresión que acaban pintados. En `a ? "Sí" : "No"`
 * se pintan las dos ramas; en `a === "primary" && <Icon />`, ninguno.
 *
 * Una plantilla con datos (`Hola ${name}`) se deja pasar a propósito: separar
 * su texto de sus datos es donde empiezan los falsos positivos. */
function renderedLiterals(expression: ts.Expression): string[] {
  if (ts.isStringLiteralLike(expression)) {
    return [expression.text];
  }
  if (ts.isParenthesizedExpression(expression)) {
    return renderedLiterals(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...renderedLiterals(expression.whenTrue),
      ...renderedLiterals(expression.whenFalse),
    ];
  }
  if (ts.isBinaryExpression(expression)) {
    return renderedOperands(expression);
  }
  return [];
}

function renderedOperands(expression: ts.BinaryExpression): string[] {
  switch (expression.operatorToken.kind) {
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return renderedLiterals(expression.right);
    case ts.SyntaxKind.BarBarToken:
    case ts.SyntaxKind.QuestionQuestionToken:
      return [
        ...renderedLiterals(expression.left),
        ...renderedLiterals(expression.right),
      ];
    default:
      return [];
  }
}

function visibleAttributeTexts(
  attribute: ts.JsxAttribute,
  sourceFile: ts.SourceFile,
): string[] {
  const { initializer } = attribute;
  if (!VISIBLE_ATTRIBUTES.has(attribute.name.getText(sourceFile))) {
    return [];
  }
  if (initializer === undefined) {
    return [];
  }
  if (ts.isStringLiteral(initializer)) {
    return [initializer.text];
  }
  return ts.isJsxExpression(initializer) && initializer.expression
    ? renderedLiterals(initializer.expression)
    : [];
}

/** Lo que enseñan la pestaña, los buscadores y las vistas previas de un
 * enlace. Solo cuenta dentro de los metadatos de Next: fuera de ellos, un
 * `title` puede ser cualquier dato. */
const VISIBLE_METADATA_PROPERTIES: ReadonlySet<string> = new Set([
  "title",
  "description",
]);

const METADATA_DECLARATIONS: ReadonlySet<string> = new Set([
  "metadata",
  "generateMetadata",
]);

function isMetadataDeclaration(node: ts.Node): boolean {
  const isNamedDeclaration =
    ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node);
  return (
    isNamedDeclaration &&
    node.name !== undefined &&
    ts.isIdentifier(node.name) &&
    METADATA_DECLARATIONS.has(node.name.text)
  );
}

function metadataPropertyTexts(property: ts.PropertyAssignment): string[] {
  const { name } = property;
  const isVisibleProperty =
    ts.isIdentifier(name) && VISIBLE_METADATA_PROPERTIES.has(name.text);
  if (!isVisibleProperty) {
    return [];
  }
  return ts.findAncestor(property, isMetadataDeclaration) === undefined
    ? []
    : renderedLiterals(property.initializer);
}

function isJsxChild(node: ts.JsxExpression): boolean {
  return ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent);
}

// Los comentarios no son nodos del árbol: `{/* ... */}` es una expresión vacía
// y `// <p>...</p>` ni siquiera llega a él. Por eso no hace falta filtrarlos.
function textsAt(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  if (ts.isJsxText(node)) {
    return [node.text];
  }
  if (ts.isJsxExpression(node) && node.expression && isJsxChild(node)) {
    return renderedLiterals(node.expression);
  }
  if (ts.isJsxAttribute(node)) {
    return visibleAttributeTexts(node, sourceFile);
  }
  if (ts.isPropertyAssignment(node)) {
    return metadataPropertyTexts(node);
  }
  return [];
}

/** Los textos visibles escritos a mano dentro del JSX de un componente o de
 * sus metadatos. La heurística es conservadora a propósito (PRD E17, RF-8):
 * prefiere dejar pasar un texto antes que marcar uno que no hay que traducir. */
export function findUntranslatedTexts({
  file,
  source,
}: ComponentSource): UntranslatedText[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    texts.push(...textsAt(node, sourceFile));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return texts
    .filter(isTranslatableText)
    .map((text) => ({ file, text: text.replace(/\s+/g, " ").trim() }));
}

/** Recorre todos los componentes `.tsx` bajo `directory`. Los `.ts` quedan
 * fuera: ahí viven las claves y los correos, no el JSX de la interfaz. */
export function findUntranslatedTextsInDirectory(
  directory: string,
): UntranslatedText[] {
  return readdirSync(directory, { recursive: true, encoding: "utf-8" })
    .filter((path) => path.endsWith(".tsx"))
    .map((path) => join(directory, path).replaceAll("\\", "/"))
    .sort()
    .flatMap((file) =>
      findUntranslatedTexts({ file, source: readFileSync(file, "utf-8") }),
    );
}
