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
    expect(concurrency?.group).toBeTruthy();
  });

  it("declara permissions y sólo pide contents: read", () => {
    const { permissions } = parseWorkflow();

    expect(permissions).toEqual({ contents: "read" });
  });

  it("usa setup-node con la misma versión que visual-baselines.yml", () => {
    const step = allSteps().find((s) =>
      s.uses?.startsWith("actions/setup-node"),
    );

    expect(step).toBeDefined();
  });
});
