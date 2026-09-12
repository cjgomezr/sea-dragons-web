import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  readEnvironmentManifest,
  variablesFromSource,
} from "../../../scripts/lib/entornos-manifest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github/workflows/visual-baselines.yml",
);

const DEVELOPMENT_SOURCE = "seadragons-dev";

/** Las credenciales que el manifiesto pone en los secretos del repositorio.
 * Sale de ahí y no de una lista escrita a mano: declarar una cuarta en el
 * manifiesto y olvidarla en el workflow tiene que dejar esto en rojo. */
function developmentCredentials(): string[] {
  return variablesFromSource(
    readEnvironmentManifest(),
    "ci",
    DEVELOPMENT_SOURCE,
  );
}

function referencedSecrets(): string[] {
  const source = readFileSync(WORKFLOW_PATH, "utf8");
  return [
    ...new Set(
      [...source.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]),
    ),
  ].filter((name): name is string => name !== undefined);
}

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  "continue-on-error"?: boolean;
}

interface WorkflowJob {
  if?: string;
  needs?: string | string[];
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  steps: WorkflowStep[];
}

interface WorkflowFile {
  on: {
    push?: { branches?: string[] };
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

function stepNamed(jobName: string, stepName: string): WorkflowStep {
  const step = stepsOf(jobName).find(
    (candidate) => candidate.name === stepName,
  );
  if (!step) {
    throw new Error(`El job "${jobName}" no tiene el paso "${stepName}".`);
  }
  return step;
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

  // Desde el #135 casi toda pantalla vive detrás de la frontera de sesión, y
  // el arranque de Playwright abre esa sesión creando un socio en
  // `seadragons-dev`. Sin estas variables, el job no falla: se salta las
  // pruebas y sale verde sobre capturas que nadie comparó (issue #149).
  it.each([
    ["compare", "Compara contra la línea base vinculante"],
    ["accept", "Regenera la línea base"],
  ])(
    "da al paso de %s que corre Playwright las credenciales que el manifiesto declara en CI",
    (jobName, stepName) => {
      const env = stepNamed(jobName, stepName).env ?? {};

      expect(Object.keys(env).sort()).toEqual(developmentCredentials().sort());
      for (const [name, value] of Object.entries(env)) {
        expect(value).toBe(`\${{ secrets.${name} }}`);
      }
    },
  );

  // Una llave de escritura en el entorno del job la heredarían `npm ci` y
  // cualquier postinstall de una dependencia, que no tienen nada que hacer
  // con ella. Playwright arranca el dev server como hijo del paso, así que
  // acotarla al paso no le quita nada.
  it("no deja ninguna credencial de Supabase en el entorno de un job entero", () => {
    const credentials = new Set(developmentCredentials());

    for (const [name, job] of Object.entries(parseWorkflow().jobs)) {
      const leaked = Object.keys(job.env ?? {}).filter((key) =>
        credentials.has(key),
      );

      expect(leaked, `el job ${name} las declara a nivel de job`).toEqual([]);
    }
  });

  it("no referencia ningún secreto que el manifiesto no ponga en CI como de desarrollo", () => {
    const permitted = new Set(developmentCredentials());

    expect(referencedSecrets().filter((name) => !permitted.has(name))).toEqual(
      [],
    );
  });

  it("no necesita ignorar sus propios commits, porque no los hace en un PR", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8");

    expect(source).not.toMatch(/github\.actor\s*!=/);
  });
});

describe("gate visual en main", () => {
  it("compara también en cada push a main, no sólo en pull requests", () => {
    const { on } = parseWorkflow();

    expect(on.push?.branches).toContain("main");
  });

  it("la comparación corre tanto en pull_request como en push", () => {
    const condition = parseWorkflow().jobs.compare?.if ?? "";

    expect(condition).toMatch(/pull_request/);
    expect(condition).toMatch(/push/);
  });

  it("el job que abre el incidente sólo corre en push y sólo cuando la comparación falló", () => {
    const job = parseWorkflow().jobs["report-incident"];

    expect(job).toBeDefined();
    expect(job?.needs).toContain("compare");
    expect(job?.if).toMatch(/push/);
    expect(job?.if).toMatch(/needs\.compare\.result\s*==\s*'failure'/);
    expect(job?.if).not.toMatch(/pull_request/);
  });

  it("el paso que abre el incidente invoca scripts/file-incident.sh, no gh issue create a pelo", () => {
    const runs = runLines("report-incident");

    expect(runs).toMatch(/report-visual-incident\.sh/);
    expect(runs).not.toMatch(/gh issue create/);
  });

  it("el job del incidente puede crear issues y leer el repo para el checkout", () => {
    const job = parseWorkflow().jobs["report-incident"];

    expect(job?.permissions?.issues).toBe("write");
    expect(job?.permissions?.contents).toBe("read");
  });

  it("el job del incidente corre aunque compare haya fallado, no sólo cuando compare tiene éxito", () => {
    const condition = parseWorkflow().jobs["report-incident"]?.if ?? "";

    expect(condition).toMatch(/always\(\)/);
  });

  it("avisa en el PR cuando accept empuja su commit", () => {
    const runs = runLines("accept");

    expect(runs).toMatch(/gh pr comment/);
  });

  it("el job accept puede comentar en el PR", () => {
    const accept = parseWorkflow().jobs.accept;

    expect(accept?.permissions?.["pull-requests"]).toBe("write");
  });
});
