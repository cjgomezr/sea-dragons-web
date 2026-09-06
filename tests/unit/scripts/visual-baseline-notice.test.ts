import { describe, expect, it } from "vitest";
import { visualBaselineNotice } from "../../support/visual-baseline-notice";

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
});
