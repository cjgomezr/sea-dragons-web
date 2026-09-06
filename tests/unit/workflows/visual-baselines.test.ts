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
    workflow_dispatch?: {
      inputs?: Record<string, { required?: boolean }>;
    } | null;
  };
  permissions: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

function parseWorkflow(): WorkflowFile {
  return load(readFileSync(WORKFLOW_PATH, "utf8")) as WorkflowFile;
}

function stepsOf(jobName: string): WorkflowStep[] {
  const job = parseWorkflow().jobs[jobName];
  if (!job) {
    throw new Error(`El workflow no declara el job "${jobName}".`);
  }
  return job.steps;
}

function runLines(jobName: string): string {
  return stepsOf(jobName)
    .map((step) => step.run ?? "")
    .join("\n");
}

describe("visual-baselines.yml", () => {
  it("parsea como YAML válido", () => {
    expect(() => parseWorkflow()).not.toThrow();
  });

  it("corre en cada pull request, no sólo cuando alguien se acuerda", () => {
    const { on } = parseWorkflow();

    expect(on.pull_request?.types).toContain("opened");
    expect(on.pull_request?.types).toContain("synchronize");
  });

  it("compara la línea base en los pull requests", () => {
    expect(parseWorkflow().jobs.compare?.if).toContain("pull_request");
    expect(runLines("compare")).toMatch(/npx playwright test/);
  });

  it("no regenera ni reescribe la línea base durante un pull request", () => {
    const runs = runLines("compare");

    expect(runs).not.toMatch(/--update-snapshots/);
    expect(runs).not.toMatch(/git commit/);
    expect(runs).not.toMatch(/git push/);
  });

  it("no pide permiso de escritura para comparar, que es lo que un fork no puede dar", () => {
    const workflow = parseWorkflow();

    expect(workflow.permissions.contents).toBe("read");
    expect(workflow.jobs.compare?.permissions).toBeUndefined();
  });

  it("guarda el diff cuando la comparación falla, para que quede algo que mirar", () => {
    const artifact = stepsOf("compare").find((step) =>
      step.uses?.startsWith("actions/upload-artifact"),
    );

    expect(artifact).toBeDefined();
    expect(artifact?.if).toBe("failure()");
  });

  it("acepta una línea base nueva sólo cuando un humano lanza el workflow", () => {
    const accept = parseWorkflow().jobs.accept;

    expect(accept).toBeDefined();
    expect(accept?.if).toContain("workflow_dispatch");
    expect(accept?.permissions?.contents).toBe("write");
    expect(runLines("accept")).toMatch(/update-visual-baselines\.sh/);
    expect(runLines("accept")).toMatch(/git push/);
  });

  it("pide la corrida revisada antes de aceptar, para que no sea un botón a ciegas", () => {
    const dispatch = parseWorkflow().on.workflow_dispatch;

    expect(dispatch?.inputs?.reviewed_run_url?.required).toBe(true);
    expect(runLines("accept")).toMatch(/reviewed_run_url/);
  });

  it("no necesita ignorar sus propios commits, porque no los hace en un PR", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8");

    expect(source).not.toMatch(/github\.actor\s*!=/);
  });
});
