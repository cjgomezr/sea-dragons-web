import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionLoading } from "@/components/SectionLoading";

/**
 * El estado de carga de las secciones (#435). Next lo precarga y lo pinta al
 * instante sólo si es estático, así que no puede leer la cookie del idioma:
 * lo toma del `lang` que el servidor ya puso en el documento.
 */

const SOURCE_ROOT = path.resolve(__dirname, "../../../src");
const ENTRY_FILES = [
  path.join(SOURCE_ROOT, "components/SectionLoading.tsx"),
  path.join(SOURCE_ROOT, "app/(app)/loading.tsx"),
];
const IMPORT_PATTERN = /(?:from|import)\s+["']([^"']+)["']/g;
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const FORBIDDEN_IMPORT = /supabase|next\/headers|request-locale/;

function localImportBase(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) {
    return path.join(SOURCE_ROOT, specifier.slice(2));
  }
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(fromFile), specifier);
  }
  return null;
}

function resolveLocalImport(
  fromFile: string,
  specifier: string,
): string | null {
  const base = localImportBase(fromFile, specifier);
  if (base === null) return null;
  const candidates = SOURCE_EXTENSIONS.flatMap((extension) => [
    `${base}${extension}`,
    path.join(base, `index${extension}`),
  ]);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`No encuentro ${specifier}, importado desde ${fromFile}`);
  }
  return found;
}

/** Todas las importaciones que alcanza el estado de carga, siguiendo las del
 * propio proyecto: una lectura de cookies escondida dos módulos más abajo lo
 * haría dinámico igual que una directa. */
function collectReachableImports(entries: readonly string[]): string[] {
  // Un Set recorre también lo que se le añade durante el recorrido.
  const files = new Set<string>(entries);
  const specifiers: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const [, specifier = ""] of source.matchAll(IMPORT_PATTERN)) {
      specifiers.push(specifier);
      const local = resolveLocalImport(file, specifier);
      if (local !== null) files.add(local);
    }
  }
  return specifiers;
}

afterEach(() => {
  document.documentElement.lang = "";
});

describe("el estado de carga de una sección", () => {
  it("pinta el esqueleto de una pantalla: un título y tres bloques", () => {
    const { container } = render(<SectionLoading />);

    expect(container.querySelectorAll(".section-loading-title")).toHaveLength(
      1,
    );
    expect(container.querySelectorAll(".section-loading-block")).toHaveLength(
      3,
    );
  });

  it("anuncia Loading cuando el documento está en inglés", () => {
    document.documentElement.lang = "en";

    render(<SectionLoading />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });

  it("anuncia Cargando cuando el documento está en español", () => {
    document.documentElement.lang = "es";

    render(<SectionLoading />);

    expect(screen.getByRole("status")).toHaveTextContent("Cargando");
  });

  it("anuncia en inglés si el documento no dice un idioma conocido", () => {
    document.documentElement.lang = "fr";

    render(<SectionLoading />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });

  it("no enseña texto a la vista: el anuncio es sólo para el lector", () => {
    document.documentElement.lang = "es";

    render(<SectionLoading />);

    expect(screen.getByText("Cargando")).toHaveClass("visually-hidden");
  });

  it("no alcanza Supabase, ni cookies ni cabeceras: es estático", () => {
    const specifiers = collectReachableImports(ENTRY_FILES);

    expect(specifiers.filter((s) => FORBIDDEN_IMPORT.test(s))).toEqual([]);
  });
});
