import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github/workflows/claude-backlog.yml",
);

const GITHUB_JOB_HARD_CAP_MINUTES = 360;

const LABEL_TRIGGER_MAX_TURNS = 200;
const LABEL_TRIGGER_TIMEOUT_MINUTES = 120;
const SCHEDULE_MAX_TURNS = 1000;
const SCHEDULE_TIMEOUT_MINUTES = 350;

interface WorkflowFile {
  jobs: {
    implement: {
      "timeout-minutes": number | string;
      steps: Array<{
        name?: string;
        with?: { claude_args?: string };
      }>;
    };
  };
}

function readWorkflowSource(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

function parseWorkflow(): WorkflowFile {
  return load(readWorkflowSource()) as WorkflowFile;
}

function findClaudeArgs(workflow: WorkflowFile): string {
  const step = workflow.jobs.implement.steps.find(
    (candidate) => candidate.with?.claude_args !== undefined,
  );
  if (!step?.with?.claude_args) {
    throw new Error("no se encontró el paso con claude_args");
  }
  return step.with.claude_args;
}

function extractMaxTurnsExpression(claudeArgs: string): string {
  const match = claudeArgs.match(/--max-turns\s+(\$\{\{[^}]*\}\})/);
  const expression = match?.[1];
  if (!expression) {
    throw new Error(`no se encontró --max-turns en: ${claudeArgs}`);
  }
  return expression;
}

/**
 * Las expresiones de GitHub Actions (`${{ cond && a || b }}`) no las evalúa
 * js-yaml: para el parser son un escalar de texto más. Extraemos las dos
 * ramas numéricas a mano para confirmar que ninguna quedó vacía, que es el
 * modo de fallo real de un ternario mal armado (criterio "se resuelven a
 * números, no a cadenas vacías").
 */
function extractTernaryBranches(expression: string): {
  whenTrue: string;
  whenFalse: string;
} {
  const match = expression.match(/&&\s*(\S+)\s*\|\|\s*(\S+)\s*}}/);
  const whenTrue = match?.[1];
  const whenFalse = match?.[2];
  if (!whenTrue || !whenFalse) {
    throw new Error(`no se encontró un ternario en: ${expression}`);
  }
  return { whenTrue, whenFalse };
}

describe("claude-backlog.yml", () => {
  it("parsea como YAML válido", () => {
    expect(() => parseWorkflow()).not.toThrow();
  });

  it("usa 200 turnos y 120 minutos en el disparo por etiqueta", () => {
    const workflow = parseWorkflow();
    const claudeArgs = findClaudeArgs(workflow);

    const { whenFalse: maxTurnsOnLabel } = extractTernaryBranches(
      extractMaxTurnsExpression(claudeArgs),
    );
    expect(Number(maxTurnsOnLabel)).toBe(LABEL_TRIGGER_MAX_TURNS);

    const timeoutExpression = String(
      workflow.jobs.implement["timeout-minutes"],
    );
    const { whenFalse: timeoutOnLabel } =
      extractTernaryBranches(timeoutExpression);
    expect(Number(timeoutOnLabel)).toBe(LABEL_TRIGGER_TIMEOUT_MINUTES);
  });

  it("usa 1000 turnos y 350 minutos en el disparo por schedule", () => {
    const workflow = parseWorkflow();
    const claudeArgs = findClaudeArgs(workflow);

    const { whenTrue: maxTurnsOnSchedule } = extractTernaryBranches(
      extractMaxTurnsExpression(claudeArgs),
    );
    expect(Number(maxTurnsOnSchedule)).toBe(SCHEDULE_MAX_TURNS);

    const timeoutExpression = String(
      workflow.jobs.implement["timeout-minutes"],
    );
    const { whenTrue: timeoutOnSchedule } =
      extractTernaryBranches(timeoutExpression);
    expect(Number(timeoutOnSchedule)).toBe(SCHEDULE_TIMEOUT_MINUTES);
  });

  it("mantiene el timeout del cron por debajo del tope de 6 horas de GitHub", () => {
    expect(SCHEDULE_TIMEOUT_MINUTES).toBeLessThan(GITHUB_JOB_HARD_CAP_MINUTES);
  });
});
