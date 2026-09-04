import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const AGENT_DEFINITION = ".claude/agents/ui-reviewer.md";

// La definición del revisor es el contrato de este ticket: si alguien devuelve
// la receta de tres llamadas, el servidor vuelve a morirse entre ellas y nadie
// se entera hasta la siguiente revisión de UI.
describe("definición del ui-reviewer", () => {
  it("manda el comando único de captura", async () => {
    const definition = await readFile(AGENT_DEFINITION, "utf8");

    expect(definition).toContain("npm run ui:screenshots");
  });

  it("ya no propone la receta que no sabe cambiar de tema", async () => {
    const definition = await readFile(AGENT_DEFINITION, "utf8");

    expect(definition).not.toContain("npx playwright screenshot");
  });

  it("nombra los archivos que el revisor va a encontrar", async () => {
    const definition = await readFile(AGENT_DEFINITION, "utf8");

    expect(definition).toContain("ui-<viewport>-<light|dark>.png");
  });
});
