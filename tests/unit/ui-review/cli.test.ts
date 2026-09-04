import { describe, expect, it } from "vitest";
import { parseCapturePath } from "../../../scripts/ui-review/cli.ts";

describe("parseCapturePath", () => {
  it("captura la portada cuando no se pide ninguna ruta", () => {
    expect(parseCapturePath([])).toBe("/");
  });

  it("devuelve la ruta pedida con --path", () => {
    expect(parseCapturePath(["--path", "/settings"])).toBe("/settings");
  });

  it("añade la barra inicial que falte", () => {
    expect(parseCapturePath(["--path", "settings"])).toBe("/settings");
  });

  it("falla nombrando la opción cuando --path viene sin valor", () => {
    expect(() => parseCapturePath(["--path"])).toThrow(/--path/);
  });

  it("rechaza una opción que no conoce en vez de ignorarla", () => {
    expect(() => parseCapturePath(["--pat", "/settings"])).toThrow(/--pat/);
  });
});
