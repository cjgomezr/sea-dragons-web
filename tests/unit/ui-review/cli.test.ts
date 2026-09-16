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

describe("parseCapturePath: ruta reescrita por Git Bash", () => {
  it("falla cuando MSYS convirtió la ruta en una de Windows con barras normales", () => {
    expect(() =>
      parseCapturePath(["--path", "C:/Program Files/Git/entrar"]),
    ).toThrow(/MSYS_NO_PATHCONV=1/);
  });

  it("falla cuando MSYS convirtió la ruta en una de Windows con barras invertidas", () => {
    expect(() =>
      parseCapturePath(["--path", "C:\\Program Files\\Git\\entrar"]),
    ).toThrow(/MSYS_NO_PATHCONV=1/);
  });

  it("nombra la otra salida, escribir la ruta con doble barra", () => {
    expect(() =>
      parseCapturePath(["--path", "C:/Program Files/Git/entrar"]),
    ).toThrow(/--path \/\/settings/);
  });

  it("explica la reescritura aunque la ruta convertida llegue partida en varios argumentos", () => {
    expect(() =>
      parseCapturePath(["--path", "C:/Program", "Files/Git/entrar"]),
    ).toThrow(/MSYS_NO_PATHCONV=1/);
  });

  it("muestra la ruta convertida para que se reconozca el síntoma", () => {
    expect(() =>
      parseCapturePath(["--path", "D:/msys64/completar-registro"]),
    ).toThrow(/D:\/msys64\/completar-registro/);
  });

  it("no confunde con una unidad de Windows una ruta que lleva dos puntos", () => {
    expect(parseCapturePath(["--path", "/buscar?q=a:b"])).toBe("/buscar?q=a:b");
  });
});

describe("parseCapturePath: doble barra", () => {
  it("devuelve la ruta con una sola barra", () => {
    expect(parseCapturePath(["--path", "//entrar"])).toBe("/entrar");
  });

  it("también con una ruta compuesta", () => {
    expect(parseCapturePath(["--path", "//completar-registro"])).toBe(
      "/completar-registro",
    );
  });
});

describe("parseCapturePath: valor vacío", () => {
  it("falla en vez de capturar la portada cuando --path viene con una cadena vacía", () => {
    expect(() => parseCapturePath(["--path", ""])).toThrow(/necesita una ruta/);
  });
});
