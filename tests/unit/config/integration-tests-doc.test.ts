import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/** El texto sin saltos de línea: CLAUDE.md se envuelve a 80 columnas y una
 * frase partida no se encontraría buscándola entera. */
function readClaudeMd(): string {
  return readFileSync(path.join(REPO_ROOT, "CLAUDE.md"), "utf8").replace(
    /\s+/g,
    " ",
  );
}

function sectionStartingWith(document: string, heading: string): string {
  const start = document.indexOf(heading);
  if (start === -1) {
    throw new Error(`CLAUDE.md no tiene la sección "${heading}".`);
  }
  return document.slice(start);
}

// Un worker lee CLAUDE.md para saber qué tiene que pasar antes de terminar.
// Desde el #415 su Stop gate ya no corre los tests de integración ni, casi
// nunca, Playwright: si el documento no lo dice, el worker cree que su rama
// ya los pasó.
describe("CLAUDE.md sobre los tests de integración y Playwright", () => {
  it("dice en la Definition of Done que CI exige los de integración y cómo correrlos a mano", () => {
    const definitionOfDone = sectionStartingWith(
      readClaudeMd(),
      "## Definition of Done",
    );

    expect(definitionOfDone).toContain("RUN_INTEGRATION_TESTS=1 npm test");
    expect(definitionOfDone).toContain("checks.yml");
  });

  // Desde el #538 CI no usa seadragons-dev: cada corrida levanta su propio
  // Supabase local. Las máquinas siguen contra dev, y ahí la reserva de socios
  // de prueba (#415) sigue haciendo falta.
  it("dice en la Definition of Done que CI corre los de integración contra un Supabase local y las máquinas contra dev", () => {
    const definitionOfDone = sectionStartingWith(
      readClaudeMd(),
      "## Definition of Done",
    );

    expect(definitionOfDone).toContain("CI never touches `seadragons-dev`");
    expect(definitionOfDone).toContain("against a local Supabase");
    expect(definitionOfDone).toContain("seadragons-dev");
    expect(definitionOfDone).toContain("tests/support/test-member-pool.ts");
  });

  it("dice en la Definition of Done cuándo corre Playwright el Stop gate y cómo correrlo a mano", () => {
    const definitionOfDone = sectionStartingWith(
      readClaudeMd(),
      "## Definition of Done",
    );

    expect(definitionOfDone).toContain(".github/visual-paths.txt");
    expect(definitionOfDone).toContain("npx playwright test");
  });

  it("dice en la sección de tests sin credenciales que se exigen en CI", () => {
    const section = sectionStartingWith(
      readClaudeMd(),
      "**Integration tests without credentials in the cloud:**",
    );

    expect(section).toMatch(/required in CI/);
    expect(section).toContain("RUN_INTEGRATION_TESTS=1 npm test");
  });

  it("dice en la sección de tests sin credenciales que CI no necesita los secretos de dev", () => {
    const section = sectionStartingWith(
      readClaudeMd(),
      "**Integration tests without credentials in the cloud:**",
    );

    expect(section).toMatch(/local Supabase/);
    expect(section).toMatch(
      /seadragons-dev[^.]*by hand|by hand[^.]*seadragons-dev/,
    );
  });
});
