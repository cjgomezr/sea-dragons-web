import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github/workflows/visual-baselines.yml",
);

interface WorkflowStep {
  name?: string;
  run?: string;
  if?: string;
  "continue-on-error"?: boolean;
}

interface WorkflowFile {
  on: {
    pull_request?: { types?: string[] };
    workflow_dispatch?: null;
  };
  permissions: { contents: string };
  jobs: {
    baselines: {
      if?: string;
      steps: WorkflowStep[];
    };
  };
}

function parseWorkflow(): WorkflowFile {
  return load(readFileSync(WORKFLOW_PATH, "utf8")) as WorkflowFile;
}

describe("visual-baselines.yml", () => {
  it("parsea como YAML válido", () => {
    expect(() => parseWorkflow()).not.toThrow();
  });

  it("ya no depende sólo de workflow_dispatch: corre también por pull_request", () => {
    const workflow = parseWorkflow();

    expect(workflow.on.pull_request?.types).toContain("synchronize");
    expect(workflow.on.pull_request?.types).toContain("opened");
    expect(workflow.on.workflow_dispatch).toBeDefined();
  });

  it("puede escribir de vuelta en la rama del PR", () => {
    const workflow = parseWorkflow();

    expect(workflow.permissions.contents).toBe("write");
  });

  it("no se dispara a partir de sus propios commits, para no entrar en bucle", () => {
    const workflow = parseWorkflow();

    expect(workflow.jobs.baselines.if).toMatch(/github-actions\[bot\]/);
  });

  it("delega la comparación y regeneración en el script del kit", () => {
    const workflow = parseWorkflow();
    const steps = workflow.jobs.baselines.steps;

    const updateStep = steps.find((step) =>
      step.run?.includes("scripts/update-visual-baselines.sh"),
    );
    expect(updateStep).toBeDefined();
    expect(updateStep!["continue-on-error"]).toBe(true);
  });

  it("sólo commitea y empuja cuando el script dejó algo regenerado", () => {
    const workflow = parseWorkflow();
    const steps = workflow.jobs.baselines.steps;

    const commitStep = steps.find((step) => step.run?.includes("git push"));
    expect(commitStep).toBeDefined();
    expect(commitStep!.if).toMatch(/outcome == 'failure'/);
    expect(commitStep!.run).toMatch(/git diff --cached --quiet/);
  });

  it("deja el job en rojo cuando hubo una diferencia que revisar", () => {
    const workflow = parseWorkflow();
    const steps = workflow.jobs.baselines.steps;

    const failStep = steps.find((step) => step.run?.trim() === "exit 1");
    expect(failStep).toBeDefined();
    expect(failStep!.if).toMatch(/outcome == 'failure'/);
  });
});
