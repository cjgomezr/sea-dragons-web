import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github/workflows");

const CHECKS = "checks.yml";
const VISUAL = "visual-baselines.yml";
const MIGRATIONS = "migrations.yml";

/** El job que pedía turno en `seadragons-dev` antes de usarlo (#507). Desde
 * el #537 ningún workflow lo tiene: cada uno usa su propio Supabase local. */
const TURN_JOB = "turno-dev";

interface Job {
  if?: string;
  needs?: string | string[];
  strategy?: { matrix?: unknown };
}

interface Workflow {
  jobs: Record<string, Job>;
}

function readWorkflow(fileName: string): Workflow {
  return load(
    readFileSync(path.join(WORKFLOWS_DIR, fileName), "utf8"),
  ) as Workflow;
}

function needsOf(job: Job | undefined): string[] {
  const needs = job?.needs ?? [];
  return Array.isArray(needs) ? needs : [needs];
}

/** Los jobs que corren Playwright contra la base, uno por tanda. */
const DATABASE_JOBS: ReadonlyArray<[string, string]> = [
  [VISUAL, "compare"],
  [VISUAL, "regenerate"],
];

function allJobs(): Array<[string, string]> {
  return [CHECKS, VISUAL, MIGRATIONS].flatMap((file) =>
    Object.keys(readWorkflow(file).jobs).map((name): [string, string] => [
      file,
      name,
    ]),
  );
}

describe("sin cola entre corridas para seadragons-dev (#537)", () => {
  it.each([CHECKS, VISUAL, MIGRATIONS])(
    "%s, con su base propia, no tiene job de turno",
    (file) => {
      expect(readWorkflow(file).jobs[TURN_JOB]).toBeUndefined();
    },
  );

  it.each(allJobs())("%s: el job %s no hace cola", (file, name) => {
    expect(needsOf(readWorkflow(file).jobs[name])).not.toContain(TURN_JOB);
  });

  it("las tandas de compare y regenerate siguen siendo una matriz en paralelo", () => {
    const { compare, regenerate } = readWorkflow(VISUAL).jobs;

    expect(compare?.strategy?.matrix).toBeDefined();
    expect(regenerate?.strategy?.matrix).toBeDefined();
  });

  // Con `always()`, GitHub no corta un job que ya corre: un push nuevo al PR
  // dejaría las cuatro tandas viejas gastando runners junto a las nuevas
  // (#416). Sin función de estado o con `!cancelled()`, sí lo corta.
  it.each(DATABASE_JOBS)(
    "%s: %s se corta cuando se cancela su corrida",
    (file, name) => {
      const condition = readWorkflow(file).jobs[name]?.if ?? "";

      expect(condition).not.toMatch(/always\(\)/);
    },
  );
});
