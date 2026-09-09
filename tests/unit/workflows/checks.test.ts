import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github/workflows/checks.yml");

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  "continue-on-error"?: boolean;
  with?: { "node-version"?: number };
}

interface WorkflowJob {
  if?: string;
  permissions?: Record<string, string>;
  steps: WorkflowStep[];
}

interface WorkflowFile {
  on: {
    pull_request?: { types?: string[] };
    push?: { branches?: string[] };
  };
  permissions: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress"?: boolean };
  jobs: Record<string, WorkflowJob>;
}

function parseWorkflow(): WorkflowFile {
  return load(readFileSync(WORKFLOW_PATH, "utf8")) as WorkflowFile;
}

function allSteps(): WorkflowStep[] {
  return Object.values(parseWorkflow().jobs).flatMap((job) => job.steps);
}

function runLines(): string {
  return allSteps()
    .map((step) => step.run ?? "")
    .join("\n");
}

function stepNamed(name: string): WorkflowStep {
  const step = allSteps().find((candidate) => candidate.name === name);
  if (!step) {
    throw new Error(`el workflow no tiene ningún paso llamado "${name}"`);
  }
  return step;
}

describe("workflow de checks", () => {
  it("parsea como YAML válido", () => {
    expect(() => parseWorkflow()).not.toThrow();
  });

  it("se dispara en pull_request y en push a main", () => {
    const { on } = parseWorkflow();

    expect(on.pull_request?.types).toEqual(
      expect.arrayContaining(["opened", "synchronize", "reopened"]),
    );
    expect(on.push?.branches).toContain("main");
  });

  it("ejecuta los cuatro comandos: test, lint, typecheck y build", () => {
    const runs = runLines();

    expect(runs).toMatch(/npm test/);
    expect(runs).toMatch(/npm run lint/);
    expect(runs).toMatch(/npm run typecheck/);
    expect(runs).toMatch(/npm run build/);
  });

  it("ningún paso lleva continue-on-error ni termina en || true", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8");

    for (const step of allSteps()) {
      expect(step["continue-on-error"]).not.toBe(true);
    }
    expect(source).not.toMatch(/\|\|\s*true/);
  });

  it("no referencia ningún secreto", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8");

    expect(source).not.toMatch(/secrets\./);
  });

  it("declara concurrency con cancel-in-progress para no acumular corridas viejas", () => {
    const { concurrency } = parseWorkflow();

    expect(concurrency?.["cancel-in-progress"]).toBe(true);
    // El group debe depender de la rama/PR: uno constante cancelaría corridas
    // de ramas distintas entre sí en vez de sólo las de la misma rama.
    expect(concurrency?.group).toMatch(/pull_request\.number|github\.ref/);
  });

  it("declara permissions y sólo pide contents: read", () => {
    const { permissions } = parseWorkflow();

    expect(permissions).toEqual({ contents: "read" });
  });

  it("usa setup-node con la misma versión que visual-baselines.yml", () => {
    const step = allSteps().find((s) =>
      s.uses?.startsWith("actions/setup-node"),
    );

    expect(step?.with?.["node-version"]).toBe(20);
  });

  it("instala chromium antes de correr los tests, que lo necesitan para las capturas de UI", () => {
    const steps = allSteps();
    const installIndex = steps.findIndex((step) =>
      step.run?.includes("playwright install"),
    );
    const testIndex = steps.findIndex((step) => step.run === "npm test");

    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(testIndex).toBeGreaterThan(installIndex);
  });

  /**
   * Este workflow viaja a `fabrica-template`, donde `test`, `lint`,
   * `typecheck` y `build` llegan sin rellenar hasta que alguien corre el
   * bootstrap. Sin guardia, cada PR de la plantilla saldría rojo por comandos
   * que todavía no existen, que no es trabajo mal hecho sino un repositorio
   * que aún no es un proyecto. El centinela es el mismo que usa el Stop gate.
   */
  it("salta los comandos de la app mientras el repositorio no haya pasado por el bootstrap", () => {
    for (const name of ["Tests", "Lint", "Tipos", "Build"]) {
      expect(
        stepNamed(name).if,
        `el paso ${name} corre aunque el proyecto no esté bootstrapeado`,
      ).toMatch(/steps\.repo\.outputs\.bootstrapped == 'true'/);
    }
  });

  it("no salta los tests del kit, que no dependen del bootstrap", () => {
    // Vigilan las piezas de la fábrica, que son iguales en todos los
    // proyectos y funcionan desde el primer clon.
    const kit = stepNamed("Tests del kit");

    expect(kit.run).toMatch(/npm run test:kit/);
    expect(kit.if).toMatch(/has_kit == 'true'/);
    expect(kit.if).not.toMatch(/bootstrapped/);
  });

  it("averigua ambas cosas leyendo el package.json, no adivinando", () => {
    const probe = stepNamed("Averigua qué comandos están configurados");

    expect(probe.run).toMatch(/\{\{TEST_CMD\}\}/);
    expect(probe.run).toMatch(/test:kit/);
  });
});
