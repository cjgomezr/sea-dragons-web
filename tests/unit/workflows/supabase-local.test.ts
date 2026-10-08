import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

/**
 * La acción que levanta un Supabase local dentro del runner (#535) y el
 * workflow pequeño que la prueba contra un Supabase de verdad. Aquí se
 * comprueba la forma; que arranca, cuánto tarda y qué tiene dentro lo dice el
 * workflow `supabase-local.yml` cuando corre.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");
const ACTION_DIR = ".github/actions/supabase-local";
const ACTION_PATH = path.join(REPO_ROOT, ACTION_DIR, "action.yml");
const START_SCRIPT = "scripts/start-local-supabase.sh";
const WORKFLOW_FILE = ".github/workflows/supabase-local.yml";
const WORKFLOW_PATH = path.join(REPO_ROOT, WORKFLOW_FILE);

/** Lo que tiene el Supabase recién levantado según las migraciones: el club
 * de la 0001, sus posiciones de la 0025, los buckets de la 0018, la 0024 y la
 * 0030, y `pg_cron` de la 0062. */
const EXPECTED_CONTENTS = [
  "victoria-seadragons",
  "club_positions",
  "member-photos",
  "club-logos",
  "news-attachments",
  "pg_cron",
];

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface Action {
  runs: { using: string; steps: Step[] };
}

interface Workflow {
  on: {
    workflow_dispatch?: unknown;
    pull_request?: { paths?: string[] };
    push?: unknown;
  };
  permissions?: Record<string, string>;
  jobs: Record<string, { "runs-on": string; steps: Step[] }>;
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readAction(): Action {
  return load(readFileSync(ACTION_PATH, "utf8")) as Action;
}

function readWorkflow(): Workflow {
  return load(readFileSync(WORKFLOW_PATH, "utf8")) as Workflow;
}

function workflowSteps(): Step[] {
  return Object.values(readWorkflow().jobs).flatMap((job) => job.steps);
}

/** El código que la acción ejecuta: sus pasos y el script al que llaman. */
function actionCode(): string {
  return [readFileSync(ACTION_PATH, "utf8"), readRepoFile(START_SCRIPT)].join(
    "\n",
  );
}

describe("acción supabase-local", () => {
  it("es una acción compuesta", () => {
    expect(readAction().runs.using).toBe("composite");
  });

  it("arranca Supabase con el script que reintenta y exporta las llaves", () => {
    const runs = readAction()
      .runs.steps.map((step) => step.run ?? "")
      .join("\n");

    expect(runs).toContain(START_SCRIPT);
  });

  it("no le cambia el CLI al script: usa el de devDependencies", () => {
    const steps = readAction().runs.steps;

    expect(steps.every((step) => step.env?.SUPABASE_CLI === undefined)).toBe(
      true,
    );
    expect(readRepoFile(START_SCRIPT)).toContain("node_modules/.bin/supabase");
  });

  it("no instala otro CLI de Supabase", () => {
    const code = actionCode();

    expect(code).not.toMatch(/supabase\/setup-cli/);
    expect(code).not.toMatch(/npx\s+(-y\s+)?supabase@/);
    expect(code).not.toMatch(/npm\s+(i|install)\b.*supabase/);
  });

  it("no lee ningún secreto ni apunta a dev", () => {
    const code = actionCode();

    expect(code).not.toMatch(/secrets\./);
    expect(code).not.toMatch(/SUPABASE_DEV/);
    expect(code).not.toMatch(/supabase\.co/);
  });
});

describe("workflow de prueba de supabase-local", () => {
  it("se puede lanzar a mano", () => {
    expect(readWorkflow().on).toHaveProperty("workflow_dispatch");
  });

  it.each([
    `${ACTION_DIR}/action.yml`,
    START_SCRIPT,
    WORKFLOW_FILE,
    "supabase/config.toml",
  ])("corre en los PR que tocan %s", (watched) => {
    const paths = readWorkflow().on.pull_request?.paths ?? [];

    expect(
      paths.some((pattern) => watched.startsWith(pattern.replace("**", ""))),
    ).toBe(true);
  });

  it("no corre en cada empujón a main", () => {
    expect(readWorkflow().on.push).toBeUndefined();
  });

  it("solo pide permiso de lectura", () => {
    expect(readWorkflow().permissions).toEqual({ contents: "read" });
  });

  it("corre en ubuntu-latest", () => {
    const runners = Object.values(readWorkflow().jobs).map(
      (job) => job["runs-on"],
    );

    expect(runners).toEqual(["ubuntu-latest"]);
  });

  it("usa la acción del repo", () => {
    const uses = workflowSteps().map((step) => step.uses);

    expect(uses).toContain(`./${ACTION_DIR}`);
  });

  it("instala las dependencias antes de la acción, que trae el CLI", () => {
    const steps = workflowSteps();
    const install = steps.findIndex((step) => step.run?.includes("npm ci"));
    const action = steps.findIndex((step) => step.uses === `./${ACTION_DIR}`);

    expect(install).toBeGreaterThanOrEqual(0);
    expect(install).toBeLessThan(action);
  });

  it.each(EXPECTED_CONTENTS)(
    "comprueba con una consulta real que existe %s",
    (expected) => {
      const steps = workflowSteps();
      const action = steps.findIndex((step) => step.uses === `./${ACTION_DIR}`);
      const checks = steps
        .slice(action + 1)
        .map((step) => step.run ?? "")
        .join("\n");

      expect(checks).toContain(expected);
    },
  );

  it("no lee ningún secreto", () => {
    expect(readFileSync(WORKFLOW_PATH, "utf8")).not.toMatch(/secrets\./);
  });
});
