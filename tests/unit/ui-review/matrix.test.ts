import { describe, expect, it } from "vitest";
import {
  CAPTURE_MATRIX,
  THEMES,
  VIEWPORTS,
  buildCaptureName,
} from "../../../scripts/ui-review/matrix.ts";

describe("matriz de capturas", () => {
  it("cubre cada viewport en cada tema", () => {
    expect(CAPTURE_MATRIX).toHaveLength(VIEWPORTS.length * THEMES.length);
  });

  it("usa los tres viewports de la casa", () => {
    expect(VIEWPORTS.map((viewport) => viewport.width)).toEqual([
      375, 768, 1440,
    ]);
  });

  it("no repite ningún nombre de archivo", () => {
    const fileNames = CAPTURE_MATRIX.map((capture) => capture.fileName);

    expect(new Set(fileNames).size).toBe(fileNames.length);
  });

  it("declara el viewport y el tema en el nombre del archivo", () => {
    const name = buildCaptureName({ name: "mobile" }, "dark");

    expect(name).toBe("ui-mobile-dark.png");
  });

  it("empareja cada nombre con el viewport y el tema que lo generaron", () => {
    for (const capture of CAPTURE_MATRIX) {
      expect(capture.fileName).toContain(capture.viewport.name);
      expect(capture.fileName).toContain(capture.theme);
    }
  });
});
