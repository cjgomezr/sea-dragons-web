import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  readEnvironmentManifest,
  variablesFromSource,
} from "../../../scripts/lib/entornos-manifest";
import { RUN_INTEGRATION_TESTS_ENV } from "../../support/test-selection.mts";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github/workflows/checks.yml");

/** Los orígenes que el manifiesto pone en los secretos de CI. Desde el #536
 * el job `checks` solo toma de ahí la cuenta de Stripe en modo de prueba
 * (#454); Supabase lo levanta el propio runner. */
const STRIPE_TEST_SOURCE = "stripe-test";
const DEVELOPMENT_DATABASE_SOURCE = "seadragons-dev";

const LOCAL_SUPABASE_ACTION = "./.github/actions/supabase-local";

const TEXT_ONLY_STEP_ID = "texto";
const TEXT_ONLY_OUTPUT = `steps.${TEXT_ONLY_STEP_ID}.outputs.solo_texto`;
/** Actions no tiene operador ternario: `cond && '' || '1'` daría siempre `'1'`
 * porque la cadena vacía es falsa. Por eso la condición va negada y el valor
 * que se quiere va en medio. */
const NOT_TEXT_ONLY_CONDITION = `${TEXT_ONLY_OUTPUT} != 'true'`;

/** Las variables que el manifiesto pone en CI desde un origen. Sale de ahí y
 * no de una lista escrita a mano: declarar una más en el manifiesto y
 * olvidarla en el workflow tiene que dejar esto en rojo. */
function ciVariablesFrom(source: string): string[] {
  return variablesFromSource(readEnvironmentManifest(), "ci", source);
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
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  "continue-on-error"?: boolean;
  with?: {
    "node-version"?: number;
    "node-version-file"?: string;
    "fetch-depth"?: number;
  };
}

interface WorkflowJob {
  if?: string;
  needs?: string[];
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

function parseWorkflow(): WorkflowFile {
  return load(readFileSync(WORKFLOW_PATH, "utf8")) as WorkflowFile;
}

function allSteps(): WorkflowStep[] {
  return Object.values(parseWorkflow().jobs).flatMap((job) => job.steps);
}

function runLines(): string {
  return allSteps()
    .map((step) => step.run ?? "")
    .join("\n");
}

function stepNamed(name: string): WorkflowStep {
  const step = allSteps().find((candidate) => candidate.name === name);
  if (!step) {
    throw new Error(`el workflow no tiene ningún paso llamado "${name}"`);
  }
  return step;
}

function checksSteps(): WorkflowStep[] {
  const job = parseWorkflow().jobs.checks;
  if (!job) {
    throw new Error("el workflow no tiene el job checks");
  }
  return job.steps;
}

function indexOfStep(predicate: (step: WorkflowStep) => boolean): number {
  return checksSteps().findIndex(predicate);
}

function localSupabaseStep(): WorkflowStep {
  const step = checksSteps().find(
    (candidate) => candidate.uses === LOCAL_SUPABASE_ACTION,
  );
  if (!step) {
    throw new Error(`el job checks no usa ${LOCAL_SUPABASE_ACTION}`);
  }
  return step;
}

describe("workflow de checks", () => {
  it("parsea como YAML válido", () => {
    expect(() => parseWorkflow()).not.toThrow();
  });

  it("se dispara en pull_request y en push a main", () => {
    const { on } = parseWorkflow();

    expect(on.pull_request?.types).toEqual(
      expect.arrayContaining(["opened", "synchronize", "reopened"]),
    );
    expect(on.push?.branches).toContain("main");
  });

  it("ejecuta los cuatro comandos: test, lint, typecheck y build", () => {
    const runs = runLines();

    expect(runs).toMatch(/npm test/);
    expect(runs).toMatch(/npm run lint/);
    expect(runs).toMatch(/npm run typecheck/);
    expect(runs).toMatch(/npm run build/);
  });

  it("ningún paso lleva continue-on-error ni termina en || true", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8");

    for (const step of allSteps()) {
      expect(step["continue-on-error"]).not.toBe(true);
    }
    expect(source).not.toMatch(/\|\|\s*true/);
  });

  // Hasta el issue #149 este workflow no referenciaba ningún secreto, y el
  // precio era que las pruebas con sesión, las de integración y las de RLS se
  // saltaban enteras: el check salía verde sin haber probado nada. Desde el
  // #536 las de Supabase corren contra un Supabase local; Stripe sigue
  // llegando de los secretos.
  it("da a los tests las credenciales de Stripe en modo de prueba que el manifiesto declara en CI", () => {
    const credentials = Object.entries(stepNamed("Tests").env ?? {}).filter(
      ([name]) => name !== RUN_INTEGRATION_TESTS_ENV,
    );

    expect(credentials.map(([name]) => name).sort()).toEqual(
      ciVariablesFrom(STRIPE_TEST_SOURCE).sort(),
    );
    for (const [name, value] of credentials) {
      expect(value).toBe(
        `\${{ ${NOT_TEXT_ONLY_CONDITION} && secrets.${name} || '' }}`,
      );
    }
  });

  it("no pasa a ningún paso las credenciales de seadragons-dev", () => {
    // CI ya no lleva ninguna (#538): las de dev son las que el manifiesto
    // pone en la máquina de quien desarrolla.
    const devVariables = variablesFromSource(
      readEnvironmentManifest(),
      "local",
      DEVELOPMENT_DATABASE_SOURCE,
    );

    expect(devVariables.length).toBeGreaterThan(0);
    expect(
      referencedSecrets().filter((name) => devVariables.includes(name)),
    ).toEqual([]);
    const stepEnvNames = allSteps().flatMap((step) =>
      Object.keys(step.env ?? {}),
    );
    expect(stepEnvNames.filter((name) => devVariables.includes(name))).toEqual(
      [],
    );
  });

  // Fuera de CI, `npm test` se salta los tests que hablan con seadragons-dev
  // (#415). Aquí se exigen: sin la variable, el check saldría verde sin
  // haberlos corrido, que es el agujero que cerró el #149.
  it("corre los tests de integración y de RLS con RUN_INTEGRATION_TESTS=1 salvo en un PR de solo texto", () => {
    const env = stepNamed("Tests").env ?? {};

    expect(env[RUN_INTEGRATION_TESTS_ENV]).toBe(
      `\${{ ${NOT_TEXT_ONLY_CONDITION} && '1' || '' }}`,
    );
  });

  it("no referencia ningún secreto que no sea de Stripe en modo de prueba", () => {
    const permitted = new Set(ciVariablesFrom(STRIPE_TEST_SOURCE));

    expect(referencedSecrets().filter((name) => !permitted.has(name))).toEqual(
      [],
    );
  });

  it("declara concurrency con cancel-in-progress para no acumular corridas viejas", () => {
    const { concurrency } = parseWorkflow();

    expect(concurrency?.["cancel-in-progress"]).toBe(true);
    // El group debe depender de la rama/PR: uno constante cancelaría corridas
    // de ramas distintas entre sí en vez de sólo las de la misma rama.
    expect(concurrency?.group).toMatch(/pull_request\.number|github\.ref/);
  });

  it("declara permissions y sólo pide contents: read", () => {
    const { permissions } = parseWorkflow();

    expect(permissions).toEqual({ contents: "read" });
  });

  it("toma la versión de Node de .nvmrc, igual que visual-baselines.yml", () => {
    const step = allSteps().find((s) =>
      s.uses?.startsWith("actions/setup-node"),
    );

    expect(step?.with?.["node-version-file"]).toBe(".nvmrc");
    expect(step?.with?.["node-version"]).toBeUndefined();
  });

  it("instala chromium antes de correr los tests, que lo necesitan para las capturas de UI", () => {
    // Desde el issue #193 lo pone la acción local que cachea los navegadores,
    // en vez de un `npx playwright install` que los bajaba en cada corrida.
    const steps = allSteps();
    const installIndex = steps.findIndex((step) =>
      step.uses?.includes("playwright-browsers"),
    );
    const testIndex = steps.findIndex((step) => step.run === "npm test");

    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(testIndex).toBeGreaterThan(installIndex);
  });

  /**
   * Este workflow viaja a `fabrica-template`, donde `test`, `lint`,
   * `typecheck` y `build` llegan sin rellenar hasta que alguien corre el
   * bootstrap. Sin guardia, cada PR de la plantilla saldría rojo por comandos
   * que todavía no existen, que no es trabajo mal hecho sino un repositorio
   * que aún no es un proyecto. El centinela es el mismo que usa el Stop gate.
   */
  // El bundle sólo existe después de construirlo, y buscar un secreto en el
  // código fuente diría qué se pretendía, no qué se publicó. Ver
  // `scripts/check-client-bundle.ts`.
  it("revisa el bundle del navegador después del build, no antes", () => {
    const steps = allSteps();
    const buildIndex = steps.findIndex((step) => step.run === "npm run build");
    const bundleIndex = steps.findIndex((step) =>
      step.run?.includes("check:client-bundle"),
    );

    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(bundleIndex).toBeGreaterThan(buildIndex);
  });

  it("salta los comandos de la app mientras el repositorio no haya pasado por el bootstrap", () => {
    for (const name of [
      "Tests",
      "Lint",
      "Tipos",
      "Build",
      "Bundle del navegador sin secretos",
    ]) {
      expect(
        stepNamed(name).if,
        `el paso ${name} corre aunque el proyecto no esté bootstrapeado`,
      ).toMatch(/steps\.repo\.outputs\.bootstrapped == 'true'/);
    }
  });

  it("no salta los tests del kit, que no dependen del bootstrap", () => {
    // Vigilan las piezas de la fábrica, que son iguales en todos los
    // proyectos y funcionan desde el primer clon.
    const kit = stepNamed("Tests del kit");

    expect(kit.run).toMatch(/npm run test:kit/);
    expect(kit.if).toMatch(/has_kit == 'true'/);
    expect(kit.if).not.toMatch(/bootstrapped/);
  });

  it("averigua ambas cosas leyendo el package.json, no adivinando", () => {
    const probe = stepNamed("Averigua qué comandos están configurados");

    expect(probe.run).toMatch(/\{\{TEST_CMD\}\}/);
    expect(probe.run).toMatch(/test:kit/);
  });

  // Un PR que solo cambia texto no necesita los tests de red ni levantar
  // Supabase (#439, #536). Los unitarios, el lint, los tipos y el build
  // siguen corriendo: varios tests leen docs/.
  describe("en un PR de solo texto", () => {
    function textOnlyStep(): WorkflowStep {
      const step = checksSteps().find(
        (candidate) => candidate.id === TEXT_ONLY_STEP_ID,
      );
      if (!step) {
        throw new Error(
          `el job checks no tiene el paso "${TEXT_ONLY_STEP_ID}"`,
        );
      }
      return step;
    }

    it("lo decide el script que compara la rama con la lista de rutas de texto", () => {
      expect(textOnlyStep().run).toMatch(/scripts\/branch-is-text-only\.sh/);
    });

    it("lo decide solo en pull_request: un push a main corre completo", () => {
      expect(textOnlyStep().if).toMatch(/github\.event_name == 'pull_request'/);
    });

    it("lo decide antes de correr los tests", () => {
      const steps = checksSteps();
      const decisionIndex = steps.findIndex(
        (step) => step.id === TEXT_ONLY_STEP_ID,
      );
      const testIndex = steps.findIndex((step) => step.name === "Tests");

      expect(decisionIndex).toBeGreaterThanOrEqual(0);
      expect(testIndex).toBeGreaterThan(decisionIndex);
    });

    it("dice en el log que el PR es solo texto y por qué", () => {
      expect(textOnlyStep().run).toMatch(/solo texto.*text-only-paths\.txt/);
    });

    // El checkout por defecto trae un solo commit: sin historia no hay
    // merge-base con main, y el script respondería siempre que no.
    it("baja la historia completa para poder comparar con main", () => {
      const checkout = checksSteps().find((step) =>
        step.uses?.startsWith("actions/checkout"),
      );

      expect(checkout?.with?.["fetch-depth"]).toBe(0);
    });

    it("lint, tipos, build y bundle no dependen de esa decisión", () => {
      for (const name of [
        "Lint",
        "Tipos",
        "Build",
        "Bundle del navegador sin secretos",
      ]) {
        expect(JSON.stringify(stepNamed(name))).not.toMatch(/solo_texto/);
      }
    });
  });

  // Los tests de integración y de RLS corrían contra seadragons-dev, el que
  // más logs generaba allí y el que más se colgaba (#536, E20).
  describe("Supabase local", () => {
    it("lo levanta la acción del repositorio antes de los tests", () => {
      const supabaseIndex = indexOfStep(
        (step) => step.uses === LOCAL_SUPABASE_ACTION,
      );
      const testIndex = indexOfStep((step) => step.name === "Tests");

      expect(supabaseIndex).toBeGreaterThanOrEqual(0);
      expect(testIndex).toBeGreaterThan(supabaseIndex);
    });

    // La acción arranca el CLI de `devDependencies`.
    it("lo levanta después de instalar las dependencias", () => {
      const installIndex = indexOfStep((step) => step.run === "npm ci");
      const supabaseIndex = indexOfStep(
        (step) => step.uses === LOCAL_SUPABASE_ACTION,
      );

      expect(supabaseIndex).toBeGreaterThan(installIndex);
    });

    it("no lo levanta en un PR de solo texto, que no corre los tests de red", () => {
      const supabaseIndex = indexOfStep(
        (step) => step.uses === LOCAL_SUPABASE_ACTION,
      );
      const decisionIndex = indexOfStep(
        (step) => step.id === TEXT_ONLY_STEP_ID,
      );

      expect(localSupabaseStep().if).toContain(NOT_TEXT_ONLY_CONDITION);
      expect(supabaseIndex).toBeGreaterThan(decisionIndex);
    });

    it("no lo levanta mientras el repositorio no haya pasado por el bootstrap", () => {
      expect(localSupabaseStep().if).toMatch(
        /steps\.repo\.outputs\.bootstrapped == 'true'/,
      );
    });

    it("no espera a ninguna otra corrida: el job checks no depende de un turno", () => {
      const needs = parseWorkflow().jobs.checks?.needs ?? [];

      expect(needs).not.toContain("turno-dev");
      expect(parseWorkflow().jobs["turno-dev"]).toBeUndefined();
    });
  });
});
