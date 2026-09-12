import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github/workflows/migrations.yml");

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  "continue-on-error"?: boolean;
  with?: { "node-version"?: number; "node-version-file"?: string };
}

interface WorkflowService {
  image?: string;
  env?: Record<string, string>;
  ports?: string[];
  options?: string;
}

interface WorkflowJob {
  "runs-on": string;
  env?: Record<string, string>;
  services?: Record<string, WorkflowService>;
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

function readWorkflowSource(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

function parseWorkflow(): WorkflowFile {
  return load(readWorkflowSource()) as WorkflowFile;
}

function theJob(): WorkflowJob {
  const jobs = Object.values(parseWorkflow().jobs);
  const [job] = jobs;
  if (!job || jobs.length !== 1) {
    throw new Error(`se esperaba un único job, hay ${jobs.length}`);
  }
  return job;
}

function describesStep(step: WorkflowStep, pattern: RegExp): boolean {
  return pattern.test(`${step.name ?? ""}\n${step.run ?? ""}`);
}

function stepMatching(pattern: RegExp): WorkflowStep {
  const step = theJob().steps.find((candidate) =>
    describesStep(candidate, pattern),
  );
  if (!step) {
    throw new Error(`ningún paso del workflow encaja con ${pattern}`);
  }
  return step;
}

function stepIndexMatching(pattern: RegExp): number {
  const index = theJob().steps.findIndex((step) =>
    describesStep(step, pattern),
  );
  if (index < 0) {
    throw new Error(`ningún paso del workflow encaja con ${pattern}`);
  }
  return index;
}

describe("workflow de migraciones en PR", () => {
  it("parsea como YAML con un job y sus pasos", () => {
    expect(theJob().steps.length).toBeGreaterThan(0);
  });

  it("se dispara en pull_request y en push a main", () => {
    const { on } = parseWorkflow();

    expect(on.pull_request?.types).toEqual(
      expect.arrayContaining(["opened", "synchronize", "reopened"]),
    );
    expect(on.push?.branches).toContain("main");
  });

  it("no filtra por rutas: corre aunque el PR no traiga migraciones nuevas", () => {
    // Lo que se verifica es que el histórico completo sigue aplicando, no sólo
    // lo que cambió. Un `paths:` sobre supabase/migrations dejaría pasar sin
    // comprobar el PR que rompe el histórico desde otro sitio.
    const source = readWorkflowSource();

    expect(source).not.toMatch(/^\s*paths(-ignore)?:/m);
  });

  it("aplica las migraciones con el script del repositorio", () => {
    const apply = stepMatching(/apply-migrations\.sh/);

    expect(apply.run).toMatch(/bash scripts\/apply-migrations\.sh/);
  });

  it("ningún paso lleva continue-on-error ni termina en || true", () => {
    // Una migración que no aplica limpia tiene que dejar el PR en rojo. Estas
    // dos son las únicas formas de que el paso falle y el job siga verde.
    for (const step of theJob().steps) {
      expect(step["continue-on-error"]).not.toBe(true);
    }
    expect(readWorkflowSource()).not.toMatch(/\|\|\s*true/);
  });

  it("no referencia ningún secreto", () => {
    expect(readWorkflowSource()).not.toMatch(/secrets\./);
  });

  it("sólo habla con el Postgres efímero del propio runner", () => {
    const urls = Object.values(theJob().env ?? {}).filter((value) =>
      value.startsWith("postgres"),
    );

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(/@(127\.0\.0\.1|localhost):/);
    }
    // Ninguna base real: ni Supabase, ni una variable que apunte fuera.
    expect(readWorkflowSource()).not.toMatch(/supabase\.co/);
  });

  it("levanta un Postgres de servicio con healthcheck, para no correr antes de que acepte conexiones", () => {
    const services = theJob().services ?? {};
    const postgres = Object.values(services).find((service) =>
      service.image?.startsWith("postgres:"),
    );

    expect(postgres).toBeDefined();
    expect(postgres?.options).toMatch(/--health-cmd/);
  });

  it("declara permissions y sólo pide contents: read", () => {
    expect(parseWorkflow().permissions).toEqual({ contents: "read" });
  });

  it("crea los roles de Supabase antes de aplicar las migraciones", () => {
    // Las migraciones hacen GRANT a anon/authenticated/service_role, que un
    // Postgres recién creado no tiene: sin este paso fallan por el motivo
    // equivocado.
    expect(stepIndexMatching(/roles\.sql/)).toBeLessThan(
      stepIndexMatching(/apply-migrations\.sh/),
    );
  });

  it("compara el esquema resultante contra el declarado, después de aplicarlas", () => {
    expect(stepIndexMatching(/check-schema-snapshot\.sh/)).toBeGreaterThan(
      stepIndexMatching(/apply-migrations\.sh/),
    );
  });

  it("corre los tests del aplicador contra ese Postgres, después de aplicarlas", () => {
    expect(stepIndexMatching(/apply-migrations\.test\.ts/)).toBeGreaterThan(
      stepIndexMatching(/apply-migrations\.sh/),
    );
  });

  it("le pasa a esos tests la base que esperan y les prohíbe saltarse", () => {
    // Si la variable se renombra o desaparece, el bloque que necesita Postgres
    // se salta solo y el job queda verde habiendo perdido la prueba de fuego.
    // La bandera convierte ese salto en un fallo.
    const environment = theJob().env ?? {};

    expect(environment.MIGRATIONS_TEST_DATABASE_URL).toMatch(
      /@(127\.0\.0\.1|localhost):/,
    );
    expect(environment.REQUIRE_MIGRATIONS_POSTGRES).toBe("1");
  });

  it("toma la versión de Node de .nvmrc, igual que el resto de los workflows", () => {
    const step = theJob().steps.find((candidate) =>
      candidate.uses?.startsWith("actions/setup-node"),
    );

    expect(step?.with?.["node-version-file"]).toBe(".nvmrc");
    expect(step?.with?.["node-version"]).toBeUndefined();
  });

  it("declara concurrency con cancel-in-progress para no acumular corridas viejas", () => {
    const { concurrency } = parseWorkflow();

    expect(concurrency?.["cancel-in-progress"]).toBe(true);
    expect(concurrency?.group).toMatch(/pull_request\.number|github\.ref/);
  });
});
