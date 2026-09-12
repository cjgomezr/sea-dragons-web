import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github/workflows");
const NODE_VERSION_FILE = ".nvmrc";

/** El cliente de Supabase abre su canal de tiempo real al crearse, y fuera de
 * un navegador eso exige el WebSocket nativo que Node trae desde la 22. Con
 * Node 20 el arranque de Playwright revienta antes de correr un solo test
 * (PR #150). Vitest no lo nota porque corre en jsdom, que trae su propio
 * WebSocket: por eso esto no lo puede cazar ningún otro test. */
const MINIMUM_NODE_MAJOR = 22;

interface WorkflowStep {
  uses?: string;
  with?: Record<string, unknown>;
}

interface WorkflowFile {
  jobs: Record<string, { steps?: WorkflowStep[] }>;
}

interface NodeSetupStep {
  workflow: string;
  job: string;
  step: WorkflowStep;
}

function readWorkflow(fileName: string): WorkflowFile {
  const source = readFileSync(path.join(WORKFLOWS_DIR, fileName), "utf8");
  return load(source) as WorkflowFile;
}

function listNodeSetupSteps(): NodeSetupStep[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((fileName) => fileName.endsWith(".yml"))
    .flatMap((workflow) =>
      Object.entries(readWorkflow(workflow).jobs).flatMap(([job, { steps }]) =>
        (steps ?? [])
          .filter((step) => step.uses?.startsWith("actions/setup-node"))
          .map((step) => ({ workflow, job, step })),
      ),
    );
}

const DEVCONTAINER_PATH = path.join(
  REPO_ROOT,
  ".devcontainer/devcontainer.json",
);

function readDeclaredNodeMajor(): number {
  const declared = readFileSync(
    path.join(REPO_ROOT, NODE_VERSION_FILE),
    "utf8",
  );
  return Number.parseInt(declared.trim(), 10);
}

describe("versión de Node", () => {
  it(`${NODE_VERSION_FILE} declara Node ${MINIMUM_NODE_MAJOR} o superior`, () => {
    expect(readDeclaredNodeMajor()).toBeGreaterThanOrEqual(MINIMUM_NODE_MAJOR);
  });

  // La fábrica recomienda correr dentro de este contenedor. Si su Node no es
  // el de CI, un worker ahí se comporta distinto que CI, que es justo lo que
  // costó una corrida entera en el PR #150.
  it("el devcontainer usa la misma versión mayor de Node que .nvmrc", () => {
    const source = readFileSync(DEVCONTAINER_PATH, "utf8");
    const imageMajor = /typescript-node:(\d+)/.exec(source)?.[1];

    expect(imageMajor).toBeDefined();
    expect(Number(imageMajor)).toBe(readDeclaredNodeMajor());
  });

  // Sin esto, un cambio en cómo se leen los workflows que no encontrara
  // ningún paso dejaría el test siguiente en verde sin haber mirado nada.
  it("encuentra los pasos que instalan Node en los workflows", () => {
    expect(listNodeSetupSteps().length).toBeGreaterThan(0);
  });

  it.each(listNodeSetupSteps())(
    "$workflow, job $job, toma la versión del archivo en vez de escribirla a mano",
    ({ step }) => {
      expect(step.with?.["node-version-file"]).toBe(NODE_VERSION_FILE);
      expect(step.with?.["node-version"]).toBeUndefined();
    },
  );
});
