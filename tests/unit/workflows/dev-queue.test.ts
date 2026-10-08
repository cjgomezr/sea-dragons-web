import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github/workflows");
const TURN_SCRIPT = path.join(REPO_ROOT, "scripts/wait-for-dev-turn.sh");

const CHECKS = "checks.yml";
const VISUAL = "visual-baselines.yml";
const MIGRATIONS = "migrations.yml";

/** El job que pide turno en `seadragons-dev` antes de usarlo (#507). El
 * script lo busca por este nombre en las demás corridas. */
const TURN_JOB = "turno-dev";
const TREE_JOB = "arbol-ya-verificado";
/** Lo que el turno aguanta, por encima de la espera del script, para las
 * consultas a la API que esa espera no cuenta. */
const API_MARGIN_MINUTES = 15;

interface Step {
  run?: string;
  env?: Record<string, string>;
}

interface Job {
  if?: string;
  "timeout-minutes"?: number;
  needs?: string | string[];
  permissions?: Record<string, string>;
  strategy?: { matrix?: Record<string, unknown> };
  steps?: Step[];
}

interface Workflow {
  jobs: Record<string, Job>;
}

function readWorkflow(fileName: string): Workflow {
  return load(
    readFileSync(path.join(WORKFLOWS_DIR, fileName), "utf8"),
  ) as Workflow;
}

/** El máximo de espera que el script usa sin `DEV_TURN_MAX_WAIT_MINUTES`. */
function readDefaultMaxWaitMinutes(): number {
  const script = readFileSync(TURN_SCRIPT, "utf8");
  const match = /DEV_TURN_MAX_WAIT_MINUTES:-(\d+)\}/.exec(script);
  if (!match) {
    throw new Error(`No encuentro el máximo por defecto en ${TURN_SCRIPT}`);
  }
  return Number(match[1]);
}

function needsOf(job: Job | undefined): string[] {
  const needs = job?.needs ?? [];
  return Array.isArray(needs) ? needs : [needs];
}

/** Los jobs que todavía usan dev. `checks` salió de la cola en el #536: usa
 * su propio Supabase local. */
const DEV_JOBS: ReadonlyArray<[string, string]> = [
  [VISUAL, "compare"],
  [VISUAL, "regenerate"],
];

const JOBS_WITHOUT_DEV: ReadonlyArray<[string, string]> = [
  [CHECKS, TREE_JOB],
  [CHECKS, "checks"],
  [VISUAL, TREE_JOB],
  [VISUAL, "reparto"],
  [VISUAL, "visual-diff"],
  [VISUAL, "report-incident"],
];

describe("cola entre corridas para seadragons-dev (#507)", () => {
  it.each(DEV_JOBS)("%s: el job %s espera su turno en dev", (file, name) => {
    expect(needsOf(readWorkflow(file).jobs[name])).toContain(TURN_JOB);
  });

  it.each(JOBS_WITHOUT_DEV)("%s: el job %s no hace cola", (file, name) => {
    expect(needsOf(readWorkflow(file).jobs[name])).not.toContain(TURN_JOB);
  });

  // Si Actions corta antes que el script, la corrida se pierde sin decir
  // detrás de quién esperaba (#517). El margen cubre las consultas a la API,
  // que el máximo del script no cuenta.
  it.each([VISUAL])(
    "%s: el turno dura más que la espera máxima del script, con margen",
    (file) => {
      const timeout = readWorkflow(file).jobs[TURN_JOB]?.["timeout-minutes"];

      expect(timeout).toBeGreaterThanOrEqual(
        readDefaultMaxWaitMinutes() + API_MARGIN_MINUTES,
      );
    },
  );

  it.each([MIGRATIONS, CHECKS])(
    "%s, con su base propia, no tiene job de turno",
    (file) => {
      expect(readWorkflow(file).jobs[TURN_JOB]).toBeUndefined();
    },
  );

  it.each([VISUAL])(
    "%s: el turno es un solo job, así que las tandas no se esperan entre sí",
    (file) => {
      expect(readWorkflow(file).jobs[TURN_JOB]?.strategy).toBeUndefined();
    },
  );

  it("las tandas de compare y regenerate siguen siendo una matriz en paralelo", () => {
    const { compare, regenerate } = readWorkflow(VISUAL).jobs;

    expect(compare?.strategy?.matrix).toBeDefined();
    expect(regenerate?.strategy?.matrix).toBeDefined();
  });

  it.each([VISUAL])(
    "%s: el turno lo pide el script del repositorio con la API de Actions",
    (file) => {
      const turn = readWorkflow(file).jobs[TURN_JOB];
      const step = (turn?.steps ?? []).find((candidate) =>
        candidate.run?.includes("wait-for-dev-turn.sh"),
      );

      expect(step?.env?.GH_TOKEN).toBe("${{ github.token }}");
      expect(turn?.permissions?.actions).toBe("read");
      expect(Object.values(turn?.permissions ?? {})).not.toContain("write");
    },
  );

  // Un push a main cuyo árbol ya pasó en el PR no toca dev: no debe ocupar
  // un sitio en la cola.
  it.each([VISUAL])(
    "%s: el turno se salta cuando el árbol ya estaba verificado",
    (file) => {
      const turn = readWorkflow(file).jobs[TURN_JOB];

      expect(needsOf(turn)).toContain(TREE_JOB);
      expect(turn?.if).toContain(
        `needs.${TREE_JOB}.outputs.ya_verificado != 'true'`,
      );
    },
  );

  // Un push nuevo al PR cancela la corrida vieja; con `always()` su job de
  // turno seguiría esperando, y luego usando dev, igual (#416).
  it.each([VISUAL])(
    "%s: una corrida cancelada deja de esperar turno",
    (file) => {
      const condition = readWorkflow(file).jobs[TURN_JOB]?.if ?? "";

      expect(condition).toMatch(/!cancelled\(\)/);
      expect(condition).not.toMatch(/always\(\)/);
    },
  );

  // El turno no mira el evento: un push a main y una aceptación a mano
  // entran en la misma cola que un PR.
  it.each([VISUAL])(
    "%s: el turno no distingue PR, push a main ni aceptación",
    (file) => {
      expect(readWorkflow(file).jobs[TURN_JOB]?.if ?? "").not.toMatch(
        /event_name/,
      );
    },
  );

  // El script da por libre el sitio de una corrida cancelada. Con `always()`,
  // GitHub no corta un job que ya corre y los checks viejos seguirían contra
  // dev a la vez que los nuevos (#416).
  it.each(DEV_JOBS)(
    "%s: %s se corta cuando se cancela su corrida",
    (file, name) => {
      const condition = readWorkflow(file).jobs[name]?.if ?? "";

      expect(condition).toMatch(/!cancelled\(\)/);
      expect(condition).not.toMatch(/always\(\)/);
    },
  );

  // Con una función de estado en el `if`, sin exigir el resultado del turno
  // estos jobs correrían igual contra dev tras agotarse la espera.
  it.each(DEV_JOBS)(
    "%s: %s no arranca si el turno no salió bien",
    (file, name) => {
      expect(readWorkflow(file).jobs[name]?.if).toContain(
        `needs.${TURN_JOB}.result == 'success'`,
      );
    },
  );

  // En una aceptación `arbol-ya-verificado` queda `skipped`, y sin una
  // función de estado Actions salta todo job con un antepasado saltado:
  // `regenerate` y `accept` no llegarían a correr nunca.
  it.each(["regenerate", "accept"])(
    "la aceptación sigue corriendo aunque la pregunta del árbol se salte: %s",
    (name) => {
      expect(readWorkflow(VISUAL).jobs[name]?.if).toMatch(/!cancelled\(\)/);
    },
  );

  it("accept sólo junta capturas si todas las tandas salieron bien", () => {
    expect(readWorkflow(VISUAL).jobs.accept?.if).toContain(
      "needs.regenerate.result == 'success'",
    );
  });
});
