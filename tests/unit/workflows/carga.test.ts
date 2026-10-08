import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

/**
 * El workflow de la prueba de carga (#525, RF-7 del PRD de E16b). Aquí se
 * comprueba la forma: que nunca corre en un PR, que no ve ninguna credencial
 * de dev ni de producción y que el informe sale aunque k6 caiga. Que la
 * aplicación aguanta lo dice el propio workflow cuando corre.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW_FILE = ".github/workflows/carga.yml";
const MAX_JOB_MINUTES = 30;
const PINNED_BY_SHA = /@[0-9a-f]{40}$/;

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface Job {
  "runs-on": string;
  "timeout-minutes"?: number;
  steps: Step[];
}

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

function readSource(): string {
  return readFileSync(path.join(REPO_ROOT, WORKFLOW_FILE), "utf8");
}

function readWorkflow(): Workflow {
  return load(readSource()) as Workflow;
}

function onlyJob(): Job {
  const jobs = Object.values(readWorkflow().jobs);
  expect(jobs).toHaveLength(1);
  return jobs[0]!;
}

function stepRunning(fragment: string): Step {
  const step = onlyJob().steps.find((candidate) =>
    candidate.run?.includes(fragment),
  );
  if (!step) throw new Error(`ningún paso corre ${fragment}`);
  return step;
}

describe("workflow carga", () => {
  it("solo se lanza a mano y una vez por semana", () => {
    expect(Object.keys(readWorkflow().on).sort()).toEqual([
      "schedule",
      "workflow_dispatch",
    ]);
  });

  it("programa una sola corrida semanal", () => {
    const schedule = readWorkflow().on.schedule as { cron: string }[];

    expect(schedule).toHaveLength(1);
    expect(schedule[0]?.cron).toMatch(/^\S+ \S+ \* \* \d$/);
  });

  it("no recibe ningún secreto", () => {
    expect(readSource()).not.toMatch(/secrets\./);
  });

  it("no pasa por la cola de turnos de seadragons-dev", () => {
    expect(readSource()).not.toContain("wait-for-dev-turn.sh");
  });

  it("solo puede leer el repositorio", () => {
    expect(readWorkflow().permissions).toEqual({ contents: "read" });
  });

  it("levanta su propio Supabase local", () => {
    const uses = onlyJob().steps.map((step) => step.uses);

    expect(uses).toContain("./.github/actions/supabase-local");
  });

  it("siembra el club de NFR-008 y compila en modo producción", () => {
    expect(stepRunning("npm run db:seed-load-test")).toBeDefined();
    expect(stepRunning("npm run build")).toBeDefined();
    expect(stepRunning("npm run start")).toBeDefined();
  });

  it("termina, sembrado incluido, en menos de media hora", () => {
    const minutes = onlyJob()["timeout-minutes"];

    expect(minutes).toBeDefined();
    expect(minutes).toBeLessThanOrEqual(MAX_JOB_MINUTES);
  });

  it("instala k6 con una acción fijada por SHA", () => {
    const setup = onlyJob().steps.find((step) =>
      step.uses?.startsWith("grafana/setup-k6-action@"),
    );

    expect(setup?.uses).toMatch(PINNED_BY_SHA);
    expect(setup?.with?.["k6-version"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("corre el recorrido del club guardando cada petición", () => {
    const run = stepRunning("k6 run").run;

    expect(run).toContain("scripts/load-test/club-journey.ts");
    expect(run).toContain("--out json=");
  });

  it("escribe el informe aunque k6 haya fallado o se haya quedado sin memoria", () => {
    const report = stepRunning("scripts/load-test/report.ts");

    expect(report.if).toBe("always()");
  });

  it("guarda el informe completo como artefacto", () => {
    const upload = onlyJob().steps.find((step) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    );

    expect(upload?.if).toBe("always()");
  });
});
