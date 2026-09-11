import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  environmentsFor,
  readEnvironmentManifest,
} from "../../../scripts/lib/entornos-manifest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github/workflows/migraciones-produccion.yml",
);

/** El secreto con la conexión a `seadragons-prod`. El workflow lo referencia
 * por nombre; el valor lo pone una persona en el entorno de Actions. */
const CREDENTIAL_SECRET = "SUPABASE_PRODUCTION_DB_URL";
/** Entorno de GitHub Actions en el que vive ese secreto. Declararlo es lo que
 * hace que el job lo reciba, y que ningún otro workflow lo reciba. */
const PROTECTED_ENVIRONMENT = "Production";

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  "continue-on-error"?: boolean;
}

interface WorkflowJob {
  "runs-on": string;
  environment?: string;
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  "continue-on-error"?: boolean;
  "timeout-minutes"?: number;
  steps: WorkflowStep[];
}

interface WorkflowFile {
  on: {
    pull_request?: unknown;
    workflow_dispatch?: unknown;
    schedule?: unknown;
    push?: { branches?: string[]; paths?: string[] };
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

function stepIndexMatching(pattern: RegExp): number {
  const index = theJob().steps.findIndex((step) =>
    pattern.test(`${step.name ?? ""}\n${step.run ?? ""}`),
  );
  if (index < 0) {
    throw new Error(`ningún paso del workflow encaja con ${pattern}`);
  }
  return index;
}

function stepsWithDatabaseUrl(): WorkflowStep[] {
  return theJob().steps.filter((step) => step.env?.DATABASE_URL !== undefined);
}

describe("workflow de migraciones en main", () => {
  it("parsea como YAML con un job y sus pasos", () => {
    expect(theJob().steps.length).toBeGreaterThan(0);
  });

  it("se dispara sólo en push a main", () => {
    const { on } = parseWorkflow();

    expect(on.push?.branches).toEqual(["main"]);
    // Ni PRs, ni cron, ni botón: cualquier otro disparador sería una vía para
    // escribir en la base con datos reales desde una rama sin mergear.
    expect(on.pull_request).toBeUndefined();
    expect(on.schedule).toBeUndefined();
    expect(on.workflow_dispatch).toBeUndefined();
  });

  it("un merge que no trae migraciones no toca producción", () => {
    expect(parseWorkflow().on.push?.paths).toEqual(["supabase/migrations/**"]);
  });

  it("serializa las corridas en vez de cancelar la que está aplicando", () => {
    // Dos merges seguidos no se pisan: el segundo espera. Cancelar al primero
    // lo dejaría a medio aplicar, y en qué estado quedaría producción
    // dependería de en qué migración lo pillara el corte.
    const { concurrency } = parseWorkflow();

    expect(concurrency?.["cancel-in-progress"]).toBe(false);
    expect(concurrency?.group).toBeTruthy();
    // Un grupo que cambie por corrida no serializa nada: todas caerían en
    // grupos distintos y correrían a la vez.
    expect(concurrency?.group).not.toMatch(/run_id|run_number|run_attempt|sha/);
  });

  it("nada perdona un fallo: ni el job, ni un paso, ni un || al final de un comando", () => {
    // Una migración que revienta en producción tiene que dejar el workflow en
    // rojo. `continue-on-error` en el job es la forma más efectiva de que un
    // job rojo no lo ponga, y por eso se mira además de en cada paso.
    expect(theJob()["continue-on-error"]).not.toBe(true);
    for (const step of theJob().steps) {
      expect(step["continue-on-error"]).not.toBe(true);
    }
    expect(readWorkflowSource()).not.toMatch(/\|\|\s*(true|:)/);
    expect(readWorkflowSource()).not.toMatch(/set \+e/);
  });

  it("no puede quedarse colgado reteniendo la cola", () => {
    // El grupo de concurrency serializa a propósito, así que un job colgado no
    // se queda solo: bloquea toda migración posterior hasta que GitHub lo mate.
    // El techo son las seis horas por defecto, así que un timeout cerca de ese
    // número no evitaría nada: aplicar el histórico tarda segundos.
    const timeout = theJob()["timeout-minutes"];

    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(60);
  });

  it("referencia la credencial por nombre desde secrets", () => {
    expect(readWorkflowSource()).toContain(`secrets.${CREDENTIAL_SECRET}`);

    for (const step of stepsWithDatabaseUrl()) {
      expect(step.env?.DATABASE_URL).toBe(
        `\${{ secrets.${CREDENTIAL_SECRET} }}`,
      );
    }
  });

  it("no lleva el valor de ninguna credencial, ni una conexión escrita a mano", () => {
    const source = readWorkflowSource();

    // Los dos formatos en los que Supabase entrega una clave.
    expect(source).not.toMatch(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    );
    expect(source).not.toMatch(/sb_[a-z]+_/);
    // Una cadena de conexión literal llevaría el usuario y la contraseña
    // dentro, y un host escrito a mano es una base elegida en el YAML en vez
    // de en el secreto.
    expect(source).not.toMatch(/postgres(ql)?:\/\//);
    expect(source).not.toMatch(/supabase\.co/);
  });

  it("toma la credencial del entorno protegido de Actions, no de los secretos generales", () => {
    expect(theJob().environment).toBe(PROTECTED_ENVIRONMENT);
  });

  it("sólo se la entrega a los pasos que hablan con la base", () => {
    // En el job entero, la conexión estaría también en cualquier paso que se
    // añada después sin pensarlo.
    expect(theJob().env).toBeUndefined();
    expect(stepsWithDatabaseUrl().length).toBeGreaterThan(0);
  });

  it("declara permissions y sólo pide contents: read", () => {
    expect(parseWorkflow().permissions).toEqual({ contents: "read" });
  });

  it("aplica las migraciones con el script del repositorio", () => {
    expect(stepIndexMatching(/apply-migrations\.sh/)).toBeGreaterThanOrEqual(0);
  });

  it("comprueba el esquema de producción después de aplicarlas", () => {
    // Aplicar sin error no garantiza haber dejado el esquema que el
    // repositorio declara: esa es la comprobación de divergencia.
    expect(stepIndexMatching(/check-schema-snapshot\.sh/)).toBeGreaterThan(
      stepIndexMatching(/apply-migrations\.sh/),
    );
  });

  it("dice qué secreto falta antes de intentar conectarse sin él", () => {
    // Sin este paso, el primer merge después de mergear el workflow falla con
    // "falta DATABASE_URL", que no dice dónde se arregla.
    const guardIndex = stepIndexMatching(
      new RegExp(`secreto[\\s\\S]*${CREDENTIAL_SECRET}`),
    );

    expect(guardIndex).toBeLessThan(stepIndexMatching(/apply-migrations\.sh/));
  });

  it("usa la credencial que el manifiesto de entornos declara para esto", () => {
    // Un secreto que sólo existe en el YAML no aparece en la tabla de
    // rotación, y quien rote la contraseña de producción dejaría el workflow
    // roto sin nada que se lo dijera.
    expect(
      environmentsFor(readEnvironmentManifest(), CREDENTIAL_SECRET),
    ).toEqual(["ci-produccion"]);
  });
});
