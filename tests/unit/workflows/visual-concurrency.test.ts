import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = path.resolve(
  __dirname,
  "../../../.github/workflows/visual-baselines.yml",
);

interface ConcurrencyBlock {
  group: string;
  "cancel-in-progress": string | boolean;
}

/** Lo que GitHub pone en el contexto `github` para cada corrida simulada. */
interface RunContext {
  event_name: "pull_request" | "push" | "workflow_dispatch";
  ref: string;
  run_id: string;
  workflow: string;
  event: { pull_request?: { number: number } };
}

function readConcurrency(): ConcurrencyBlock {
  const workflow = load(readFileSync(WORKFLOW_PATH, "utf8")) as {
    concurrency?: ConcurrencyBlock;
  };
  if (workflow.concurrency === undefined) {
    throw new Error("visual-baselines.yml no declara `concurrency`");
  }
  return workflow.concurrency;
}

function resolvePath(context: RunContext, expression: string): unknown {
  const [root, ...keys] = expression.split(".");
  if (root !== "github") {
    throw new Error(`Contexto no simulado: ${expression}`);
  }
  return keys.reduce<unknown>(
    (value, key) =>
      value === undefined || value === null
        ? undefined
        : (value as Record<string, unknown>)[key],
    context,
  );
}

/** Evalúa el subconjunto de expresiones de Actions que usa el bloque:
 * rutas de `github`, `a || b` y `x == 'literal'`. Cualquier otra forma
 * lanza, para que un cambio de sintaxis no pase por verde sin probarse. */
function evaluateExpression(context: RunContext, expression: string): unknown {
  const trimmed = expression.trim();
  const equality = /^([\w.]+)\s*==\s*'([^']*)'$/.exec(trimmed);
  if (equality !== null) {
    return resolvePath(context, equality[1] ?? "") === equality[2];
  }
  if (!/^[\w.]+(\s*\|\|\s*[\w.]+)*$/.test(trimmed)) {
    throw new Error(`Expresión no simulada: ${trimmed}`);
  }
  return trimmed
    .split("||")
    .map((operand) => resolvePath(context, operand.trim()))
    .find(Boolean);
}

function interpolate(context: RunContext, template: string): string {
  return template.replace(/\$\{\{(.+?)\}\}/g, (_match, expression: string) =>
    String(evaluateExpression(context, expression)),
  );
}

function resolveConcurrency(context: RunContext): {
  group: string;
  cancelsInProgress: boolean;
} {
  const block = readConcurrency();
  const cancel = block["cancel-in-progress"];
  return {
    group: interpolate(context, block.group),
    cancelsInProgress:
      typeof cancel === "boolean"
        ? cancel
        : interpolate(context, cancel) === "true",
  };
}

let nextRunId = 1000;

function pullRequestRun(number: number): RunContext {
  nextRunId += 1;
  return {
    event_name: "pull_request",
    ref: `refs/pull/${number}/merge`,
    run_id: String(nextRunId),
    workflow: "Visual baselines (Linux)",
    event: { pull_request: { number } },
  };
}

function branchRun(
  eventName: "push" | "workflow_dispatch",
  branch: string,
): RunContext {
  nextRunId += 1;
  return {
    event_name: eventName,
    ref: `refs/heads/${branch}`,
    run_id: String(nextRunId),
    workflow: "Visual baselines (Linux)",
    event: {},
  };
}

describe("concurrencia de visual-baselines.yml", () => {
  it("cancela la visual anterior cuando llega otro push al mismo PR", () => {
    const previous = resolveConcurrency(pullRequestRun(407));
    const next = resolveConcurrency(pullRequestRun(407));

    expect(next.group).toBe(previous.group);
    expect(next.cancelsInProgress).toBe(true);
  });

  it("no mezcla las visuales de dos PRs distintos", () => {
    const first = resolveConcurrency(pullRequestRun(407));
    const second = resolveConcurrency(pullRequestRun(408));

    expect(second.group).not.toBe(first.group);
  });

  it("deja la aceptación de líneas base en su propio grupo, sin cancelarla", () => {
    const acceptance = resolveConcurrency(
      branchRun("workflow_dispatch", "impl-407"),
    );
    const pushToBranch = resolveConcurrency(branchRun("push", "impl-407"));
    const pullRequest = resolveConcurrency(pullRequestRun(407));

    expect(acceptance.cancelsInProgress).toBe(false);
    expect(acceptance.group).not.toBe(pushToBranch.group);
    expect(acceptance.group).not.toBe(pullRequest.group);
  });

  it("no cancela ni pone en espera la visual de un merge anterior a main", () => {
    const previousMerge = resolveConcurrency(branchRun("push", "main"));
    const nextMerge = resolveConcurrency(branchRun("push", "main"));

    expect(nextMerge.cancelsInProgress).toBe(false);
    expect(nextMerge.group).not.toBe(previousMerge.group);
  });

  it("sigue la forma del bloque de checks.yml", () => {
    const { group } = readConcurrency();

    expect(group).toMatch(/^visual-\$\{\{ github\.workflow \}\}-/);
  });
});
