import { configDefaults } from "vitest/config";
import {
  INTEGRATION_TEST_PATTERNS,
  selectExcludedTests,
} from "./test-selection.mts";

/**
 * Los dos proyectos de Vitest (#431).
 *
 * Los tests de red hablan con `seadragons-dev`. Lanzados en paralelo, como los
 * unitarios, CI llegó a más de 20.000 peticiones cada cinco minutos: la base
 * contestaba cada vez más despacio y los tests agotaban su plazo sin estar
 * rotos. Por eso corren de uno en uno en su propio proyecto, y los unitarios
 * siguen en paralelo.
 */

export const UNIT_PROJECT_NAME = "unit";
export const INTEGRATION_PROJECT_NAME = "integration";

/** Un solo worker: los archivos de red nunca se solapan. Vitest los manda a
 * su grupo secuencial, tras los unitarios, sólo con `isolate: true` (el valor
 * por defecto); con `isolate: false` se negaría a arrancar. */
const SEQUENTIAL_WORKERS = 1;

export const SHARED_SETUP_FILE = "./vitest.setup.ts";
/** Pone tiempo máximo a las peticiones a dev y reintenta las lecturas
 * colgadas (#506). Es sólo del arnés de red: los unitarios no hablan con dev,
 * y la aplicación no reintenta (#165). */
export const INTEGRATION_FETCH_TIMEOUT_SETUP_FILE =
  "./tests/support/integration-fetch-timeout.setup.ts";

// *.test.ts(x) is Vitest; *.spec.ts is Playwright. Keeping the split on the
// extension stops each runner from collecting the other one's suite.
const TEST_FILES = [
  "tests/unit/**/*.test.ts",
  "tests/unit/**/*.test.tsx",
  "tests/rls/**/*.test.ts",
] as const;

type Environment = Readonly<Record<string, string | undefined>>;

type ProjectFiles = {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly setupFiles: readonly string[];
};

export type TestProjectSelection =
  | (ProjectFiles & {
      readonly name: typeof UNIT_PROJECT_NAME;
      readonly fileParallelism?: undefined;
      readonly maxWorkers?: undefined;
    })
  | (ProjectFiles & {
      readonly name: typeof INTEGRATION_PROJECT_NAME;
      readonly fileParallelism: false;
      readonly maxWorkers: typeof SEQUENTIAL_WORKERS;
    });

export function selectTestProjects(
  env: Environment,
): readonly TestProjectSelection[] {
  return [
    {
      name: UNIT_PROJECT_NAME,
      include: TEST_FILES,
      exclude: [...configDefaults.exclude, ...INTEGRATION_TEST_PATTERNS],
      setupFiles: [SHARED_SETUP_FILE],
    },
    {
      name: INTEGRATION_PROJECT_NAME,
      include: INTEGRATION_TEST_PATTERNS,
      exclude: selectExcludedTests(env),
      setupFiles: [SHARED_SETUP_FILE, INTEGRATION_FETCH_TIMEOUT_SETUP_FILE],
      fileParallelism: false,
      maxWorkers: SEQUENTIAL_WORKERS,
    },
  ];
}
