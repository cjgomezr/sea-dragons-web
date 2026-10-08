import { describe, expect, it } from "vitest";
import {
  INTEGRATION_FETCH_TIMEOUT_SETUP_FILE,
  INTEGRATION_PROJECT_NAME,
  LOCAL_CI_INTEGRATION_WORKERS,
  SHARED_SETUP_FILE,
  selectTestProjects,
  UNIT_PROJECT_NAME,
} from "../../support/test-projects.mts";
import { SUPABASE_URL_ENV } from "../../../src/lib/supabase/config";
import { DEVELOPMENT_SUPABASE_PROJECT_REF } from "../../../src/lib/supabase/environment-guard";
import { SUPABASE_FETCH_WORST_CASE_MS } from "../../support/supabase-fetch-timeout";
import {
  INTEGRATION_TEST_PATTERNS,
  RUN_INTEGRATION_TESTS_ENV,
} from "../../support/test-selection.mts";

const ENABLED = { [RUN_INTEGRATION_TESTS_ENV]: "1" };
// GitHub Actions pone `CI=true` en cada paso.
const IN_CI = { CI: "true" };
const LOCAL_SUPABASE = { [SUPABASE_URL_ENV]: "http://127.0.0.1:54321" };
const DEV_SUPABASE = {
  [SUPABASE_URL_ENV]: `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`,
};

function findProject(env: Record<string, string>, name: string) {
  const project = selectTestProjects(env).find(
    (candidate) => candidate.name === name,
  );
  if (project === undefined) {
    throw new Error(`No hay proyecto "${name}"`);
  }
  return project;
}

describe("los proyectos de Vitest", () => {
  it("son dos: el unitario y el de red", () => {
    const names = selectTestProjects(ENABLED).map((project) => project.name);

    expect(names).toEqual([UNIT_PROJECT_NAME, INTEGRATION_PROJECT_NAME]);
  });

  it("corren los de red de uno en uno, en un solo worker", () => {
    const integration = findProject(ENABLED, INTEGRATION_PROJECT_NAME);

    expect(integration.fileParallelism).toBe(false);
    expect(integration.maxWorkers).toBe(1);
  });

  it("corren los de red en varios workers en CI contra el Supabase local", () => {
    const integration = findProject(
      { ...ENABLED, ...IN_CI, ...LOCAL_SUPABASE },
      INTEGRATION_PROJECT_NAME,
    );

    expect(integration.fileParallelism).toBe(true);
    expect(integration.maxWorkers).toBe(LOCAL_CI_INTEGRATION_WORKERS);
    expect(LOCAL_CI_INTEGRATION_WORKERS).toBeGreaterThan(1);
  });

  it("ponen a los de red en paralelo en su propio grupo, tras el unitario", () => {
    const env = { ...ENABLED, ...IN_CI, ...LOCAL_SUPABASE };
    const unit = findProject(env, UNIT_PROJECT_NAME);
    const integration = findProject(env, INTEGRATION_PROJECT_NAME);

    // Vitest se niega a arrancar si dos proyectos con distinto `maxWorkers`
    // comparten grupo; el unitario va en el 0, el de por defecto.
    expect(unit.sequence).toBeUndefined();
    expect(integration.sequence?.groupOrder).toBeGreaterThan(0);
  });

  it("siguen en serie en CI si apunta a dev", () => {
    const integration = findProject(
      { ...ENABLED, ...IN_CI, ...DEV_SUPABASE },
      INTEGRATION_PROJECT_NAME,
    );

    expect(integration.fileParallelism).toBe(false);
    expect(integration.maxWorkers).toBe(1);
  });

  it("siguen en serie fuera de CI aunque apunte al Supabase local", () => {
    const integration = findProject(
      { ...ENABLED, ...LOCAL_SUPABASE },
      INTEGRATION_PROJECT_NAME,
    );

    expect(integration.fileParallelism).toBe(false);
    expect(integration.maxWorkers).toBe(1);
  });

  it("siguen en serie en una máquina que apunta a dev", () => {
    const integration = findProject(
      { ...ENABLED, ...DEV_SUPABASE },
      INTEGRATION_PROJECT_NAME,
    );

    expect(integration.fileParallelism).toBe(false);
    expect(integration.maxWorkers).toBe(1);
  });

  it("dejan al unitario con el paralelismo de siempre", () => {
    const unit = findProject(ENABLED, UNIT_PROJECT_NAME);

    expect(unit.fileParallelism).toBeUndefined();
    expect(unit.maxWorkers).toBeUndefined();
  });

  it("ponen tiempo máximo a las peticiones a Supabase sólo en el de red", () => {
    const unit = findProject(ENABLED, UNIT_PROJECT_NAME);
    const integration = findProject(ENABLED, INTEGRATION_PROJECT_NAME);

    expect(integration.setupFiles).toEqual([
      SHARED_SETUP_FILE,
      INTEGRATION_FETCH_TIMEOUT_SETUP_FILE,
    ]);
    expect(unit.setupFiles).toEqual([SHARED_SETUP_FILE]);
  });

  it("dan a los tests y hooks del de red un plazo que cubre una lectura colgada", () => {
    const integration = findProject(ENABLED, INTEGRATION_PROJECT_NAME);

    expect(integration.testTimeout).toBeGreaterThan(
      SUPABASE_FETCH_WORST_CASE_MS,
    );
    expect(integration.hookTimeout).toBeGreaterThan(
      SUPABASE_FETCH_WORST_CASE_MS,
    );
  });

  it("dan al de red exactamente los patrones de integración", () => {
    const integration = findProject(ENABLED, INTEGRATION_PROJECT_NAME);

    expect(integration.include).toEqual([...INTEGRATION_TEST_PATTERNS]);
  });

  it("sacan del unitario los de red aunque la variable esté puesta", () => {
    const unit = findProject(ENABLED, UNIT_PROJECT_NAME);

    expect(unit.exclude).toEqual(
      expect.arrayContaining([...INTEGRATION_TEST_PATTERNS]),
    );
  });

  it("no dejan entrar nada al de red sin la variable", () => {
    const integration = findProject({}, INTEGRATION_PROJECT_NAME);

    expect(integration.exclude).toEqual(
      expect.arrayContaining([...INTEGRATION_TEST_PATTERNS]),
    );
  });

  it("dejan entrar los de red con la variable", () => {
    const integration = findProject(ENABLED, INTEGRATION_PROJECT_NAME);

    for (const pattern of INTEGRATION_TEST_PATTERNS) {
      expect(integration.exclude).not.toContain(pattern);
    }
  });
});
