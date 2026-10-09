import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github/workflows");

const VISUAL = "visual-baselines.yml";

/** El job que pedía turno en `seadragons-dev` antes de usarlo (#507), y el
 * script con el que lo pedía. Desde el #538 no existen: cada corrida de CI usa
 * su propio Supabase local y no hay base compartida que ordenar. */
const TURN_JOB = "turno-dev";
const TURN_SCRIPT = "scripts/wait-for-dev-turn.sh";

/** Los secretos del repositorio que apuntan a `seadragons-dev`. Se quedan en
 * GitHub (D5 del PRD de E20), pero ningún workflow los lee: si uno volviera a
 * pasarlos, sus tests escribirían otra vez en la base compartida. */
const DEV_SUPABASE_SECRETS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DEV_DB_URL",
] as const;

interface Job {
  if?: string;
  needs?: string | string[];
  strategy?: { matrix?: unknown };
}

interface Workflow {
  jobs: Record<string, Job>;
}

const WORKFLOW_FILES = readdirSync(WORKFLOWS_DIR).filter((file) =>
  file.endsWith(".yml"),
);

function readSource(fileName: string): string {
  return readFileSync(path.join(WORKFLOWS_DIR, fileName), "utf8");
}

function readWorkflow(fileName: string): Workflow {
  return load(readSource(fileName)) as Workflow;
}

function needsOf(job: Job | undefined): string[] {
  const needs = job?.needs ?? [];
  return Array.isArray(needs) ? needs : [needs];
}

/** Los jobs que corren Playwright contra la base, uno por tanda. */
const DATABASE_JOBS = ["compare", "regenerate"] as const;

function allJobs(): Array<[string, string]> {
  return WORKFLOW_FILES.flatMap((file) =>
    Object.keys(readWorkflow(file).jobs).map((name): [string, string] => [
      file,
      name,
    ]),
  );
}

function secretsReadBy(fileName: string): string[] {
  const matches = readSource(fileName).matchAll(/secrets\.([A-Z0-9_]+)/g);
  return [...matches].map((match) => match[1] ?? "");
}

describe("CI no usa seadragons-dev ni hace cola para usarlo (#538)", () => {
  it("el script de la cola de turnos ya no existe", () => {
    expect(existsSync(path.join(REPO_ROOT, TURN_SCRIPT))).toBe(false);
  });

  it.each(WORKFLOW_FILES)("%s no tiene job de turno", (file) => {
    expect(readWorkflow(file).jobs[TURN_JOB]).toBeUndefined();
  });

  it.each(allJobs())("%s: el job %s no hace cola", (file, name) => {
    expect(needsOf(readWorkflow(file).jobs[name])).not.toContain(TURN_JOB);
  });

  it.each(WORKFLOW_FILES)("%s no pide turno en dev", (file) => {
    expect(readSource(file)).not.toContain(path.basename(TURN_SCRIPT));
  });

  it.each(WORKFLOW_FILES)(
    "%s no pasa a CI ningún secreto de Supabase de dev",
    (file) => {
      const devSecrets: readonly string[] = DEV_SUPABASE_SECRETS;

      expect(
        secretsReadBy(file).filter((name) => devSecrets.includes(name)),
      ).toEqual([]);
    },
  );

  it("las tandas de compare y regenerate siguen siendo una matriz en paralelo", () => {
    const { compare, regenerate } = readWorkflow(VISUAL).jobs;

    expect(compare?.strategy?.matrix).toBeDefined();
    expect(regenerate?.strategy?.matrix).toBeDefined();
  });

  // Con `always()`, GitHub no corta un job que ya corre: un push nuevo al PR
  // dejaría las cuatro tandas viejas gastando runners junto a las nuevas
  // (#416). Sin función de estado o con `!cancelled()`, sí lo corta.
  it.each(DATABASE_JOBS)("%s se corta cuando se cancela su corrida", (name) => {
    const condition = readWorkflow(VISUAL).jobs[name]?.if ?? "";

    expect(condition).not.toMatch(/always\(\)/);
  });
});
