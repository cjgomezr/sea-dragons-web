import { describe, expect, it } from "vitest";
import {
  INTEGRATION_FETCH_TIMEOUT_SETUP_FILE,
  INTEGRATION_PROJECT_NAME,
  SHARED_SETUP_FILE,
  selectTestProjects,
  UNIT_PROJECT_NAME,
} from "../../support/test-projects.mts";
import {
  INTEGRATION_TEST_PATTERNS,
  RUN_INTEGRATION_TESTS_ENV,
} from "../../support/test-selection.mts";

const ENABLED = { [RUN_INTEGRATION_TESTS_ENV]: "1" };

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
