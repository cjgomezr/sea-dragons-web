import { describe, expect, it } from "vitest";
import { shouldCreateMissingSnapshot } from "../../support/missing-snapshot-policy";

const AUSENTE = false;
const YA_EXISTE = true;

describe("política de capturas ausentes", () => {
  it("en Linux una captura ausente sigue siendo un fallo", () => {
    // Ahí la línea base está versionada y la acepta una persona: que falte
    // significa que alguien no la commiteó, no que sea la primera corrida.
    expect(shouldCreateMissingSnapshot("linux", AUSENTE)).toBe(false);
  });

  it("en Windows una captura ausente se crea", () => {
    expect(shouldCreateMissingSnapshot("win32", AUSENTE)).toBe(true);
  });

  it("en macOS también, porque tampoco versiona línea base", () => {
    expect(shouldCreateMissingSnapshot("darwin", AUSENTE)).toBe(true);
  });

  it("en Windows una captura que ya existe no se toca", () => {
    // Es lo que mantiene viva la comparación local: si la página cambió,
    // toHaveScreenshot compara contra la de antes y falla.
    expect(shouldCreateMissingSnapshot("win32", YA_EXISTE)).toBe(false);
  });

  it("en Linux una captura que ya existe tampoco se toca", () => {
    expect(shouldCreateMissingSnapshot("linux", YA_EXISTE)).toBe(false);
  });
});
