import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SPANISH_STATES_WITH_OWN_CAPTURE,
  isStatePhotographed,
} from "../../support/spanish-captures";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SNAPSHOTS_DIR = "tests/ui.spec.ts-snapshots";

/** Tres tamaños por dos temas: lo que toma cada estado de pantalla. */
const CAPTURES_PER_STATE = 6;

/** `<estado>-<tamaño>-<tema>-chromium-linux.png`, el nombre de la captura de
 * una pantalla entera. Las del sidebar y la barra de pestañas llevan el
 * idioma en medio (`-es-light`) y no encajan aquí a propósito. */
const PAGE_CAPTURE =
  /^(?<state>.+)-(?:mobile|tablet|desktop)-(?:light|dark)-chromium-linux\.png$/;

function trackedSnapshots(): string[] {
  return execFileSync("git", ["ls-files", SNAPSHOTS_DIR], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .map((file) => path.posix.basename(file));
}

function trackedPageCaptureStates(): string[] {
  return trackedSnapshots()
    .map((file) => PAGE_CAPTURE.exec(file)?.groups?.state)
    .filter((state): state is string => state !== undefined);
}

describe("capturas en español (#255)", () => {
  it("fotografía los estados en inglés", () => {
    expect(isStatePhotographed("directorio-con-miembros")).toBe(true);
  });

  it("no fotografía un estado en español cuyo diseño no cambia con el idioma", () => {
    expect(isStatePhotographed("directorio-con-miembros-es")).toBe(false);
  });

  it("fotografía los estados en español cuyo aviso largo aprieta el diseño", () => {
    for (const state of SPANISH_STATES_WITH_OWN_CAPTURE) {
      expect(isStatePhotographed(state), state).toBe(true);
    }
  });

  it("no versiona capturas de un estado en español que ya no se toma", () => {
    const orphans = trackedPageCaptureStates().filter(
      (state) => !isStatePhotographed(state),
    );

    expect([...new Set(orphans)]).toEqual([]);
  });

  it("versiona las seis capturas de cada estado en español que se conserva", () => {
    const states = trackedPageCaptureStates();

    for (const kept of SPANISH_STATES_WITH_OWN_CAPTURE) {
      const captures = states.filter((state) => state === kept);
      expect(captures, kept).toHaveLength(CAPTURES_PER_STATE);
    }
  });

  it("conserva la barra de pestañas a 360 y 375 en los dos idiomas", () => {
    const tracked = trackedSnapshots();

    for (const width of [360, 375]) {
      for (const locale of ["en", "es"]) {
        const prefix = `tabbar-player-mas-${width}-${locale}-`;
        expect(
          tracked.filter((file) => file.startsWith(prefix)),
          prefix,
        ).toHaveLength(2);
      }
    }
  });
});
