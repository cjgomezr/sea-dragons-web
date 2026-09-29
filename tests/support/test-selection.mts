import { configDefaults } from "vitest/config";

/**
 * Qué tests corre `npm test` (#415).
 *
 * Los de integración y los de RLS hablan con `seadragons-dev`, y cada corrida
 * abre sesiones en Auth. El Stop gate corre `npm test` tras cada turno de cada
 * worker, así que lo que debería pasar unas veces al día pasaba decenas, y la
 * organización de Supabase llegó cerca del límite de usuarios activos. Fuera
 * de CI se saltan; CI los corre y los exige poniendo la variable.
 */

export const RUN_INTEGRATION_TESTS_ENV = "RUN_INTEGRATION_TESTS";

/** El único valor que los enciende: cualquier otro se lee como apagado, para
 * que un `RUN_INTEGRATION_TESTS=0` no los encienda por existir. */
const ENABLED_VALUE = "1";

export const INTEGRATION_TEST_PATTERNS = [
  "tests/**/*.integration.test.ts",
  "tests/rls/**",
] as const;

type Environment = Readonly<Record<string, string | undefined>>;

function areIntegrationTestsEnabled(env: Environment): boolean {
  return env[RUN_INTEGRATION_TESTS_ENV] === ENABLED_VALUE;
}

/** El `exclude` de Vitest. Parte del de por defecto porque dar uno propio lo
 * reemplaza entero. */
export function selectExcludedTests(env: Environment): readonly string[] {
  if (areIntegrationTestsEnabled(env)) {
    return configDefaults.exclude;
  }
  return [...configDefaults.exclude, ...INTEGRATION_TEST_PATTERNS];
}

/** La línea que avisa del salto, o `null` si no hubo salto. */
export function describeSkippedIntegrationTests(
  env: Environment,
): string | null {
  if (areIntegrationTestsEnabled(env)) {
    return null;
  }
  return `Tests de integración y de RLS saltados (${INTEGRATION_TEST_PATTERNS.join(", ")}): corren en CI; para correrlos aquí, ${RUN_INTEGRATION_TESTS_ENV}=${ENABLED_VALUE} npm test.`;
}
