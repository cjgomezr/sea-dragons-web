import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github/workflows/labels-cleanup.yml",
);

interface WorkflowFile {
  jobs: {
    cleanup: {
      permissions: Record<string, string>;
      steps: Array<{ uses?: string; run?: string }>;
    };
  };
}

function parseWorkflow(): WorkflowFile {
  return load(readFileSync(WORKFLOW_PATH, "utf8")) as WorkflowFile;
}

describe("workflow labels-cleanup", () => {
  it("concede contents de lectura, sin lo cual el checkout no clona un repo privado", () => {
    const { permissions } = parseWorkflow().jobs.cleanup;

    expect(permissions.contents).toBe("read");
  });

  it("mantiene el permiso de escritura sobre issues que necesitan las etiquetas", () => {
    const { permissions } = parseWorkflow().jobs.cleanup;

    expect(permissions.issues).toBe("write");
  });

  it("hace checkout antes de invocar el script de bloqueadores", () => {
    const { steps } = parseWorkflow().jobs.cleanup;

    const checkoutIndex = steps.findIndex((step) =>
      step.uses?.startsWith("actions/checkout"),
    );
    const scriptIndex = steps.findIndex((step) =>
      step.run?.includes("clear-blockers.sh"),
    );

    expect(checkoutIndex).toBeGreaterThanOrEqual(0);
    expect(scriptIndex).toBeGreaterThan(checkoutIndex);
  });
});
