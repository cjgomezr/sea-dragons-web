import { describe, expect, it } from "vitest";
import {
  snapshotCreatedNotice,
  visualBaselineNotice,
} from "../../support/visual-baseline-notice";

describe("visualBaselineNotice", () => {
  it("no dice nada en Linux: ahí la comparación es la vinculante", () => {
    expect(visualBaselineNotice("linux")).toBeNull();
  });

  it("avisa en Windows que el resultado es informativo, no vinculante", () => {
    const notice = visualBaselineNotice("win32");

    expect(notice).not.toBeNull();
    expect(notice).toMatch(/informativ/i);
    expect(notice).toMatch(/CI/);
  });

  it("avisa en cualquier plataforma que no sea Linux (p. ej. macOS)", () => {
    expect(visualBaselineNotice("darwin")).not.toBeNull();
  });

  it("cuenta qué pasa la primera vez en un checkout limpio", () => {
    // Es la mitad que faltaba: sin esto, 16 capturas recién creadas parecen
    // 16 regresiones (issue #96).
    expect(visualBaselineNotice("win32")).toMatch(/primera/i);
  });
});

describe("snapshotCreatedNotice", () => {
  it("nombra la captura que acaba de crear", () => {
    expect(snapshotCreatedNotice("home-mobile-light.png")).toContain(
      "home-mobile-light.png",
    );
  });

  it("dice que no es una regresión, que es lo que se confunde", () => {
    const notice = snapshotCreatedNotice("home-mobile-light.png");

    expect(notice).toMatch(/creada por primera vez/i);
    expect(notice).toMatch(/no es una regresión/i);
  });
});
