import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TESTS_ROOT = path.join(REPO_ROOT, "tests");

/**
 * Quién puede crear una identidad en Auth desde los tests (#415). Cada
 * identidad nueva cuenta como usuario del mes en Supabase aunque se borre
 * después, así que los tests usan la reserva de socios de prueba. Sólo quedan
 * fuera los que prueban precisamente el alta o la recuperación de una cuenta,
 * y la propia reserva, que crea una plaza cuando todas están ocupadas.
 *
 * `registration` y `member-invitation` crean su identidad a través del código
 * de la aplicación (src/), no desde el test, así que aquí no aparecen: lo que
 * se vigila es que ningún test vuelva a llamar a Auth por su cuenta.
 */
const ALLOWED_IDENTITY_CREATORS = [
  "tests/support/supabase-retry.ts",
  "tests/support/supabase-test-member-pool.ts",
  "tests/unit/auth/password-recovery.integration.test.ts",
  "tests/unit/auth/registration.integration.test.ts",
  // Prueban el reintento de `createConfirmedUser` con un Auth de mentira.
  "tests/unit/supabase-retry.test.ts",
  "tests/unit/supabase-retry-failure.test.ts",
];

const IDENTITY_CREATION_PATTERN = /admin\.createUser\(|createConfirmedUser\(/;

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(fullPath);
    }
    return /\.tsx?$/.test(entry.name) ? [fullPath] : [];
  });
}

function toRepoPath(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

describe("las identidades que crean los tests", () => {
  it("sólo las crean la reserva y los tests de alta y recuperación de cuenta", () => {
    const creators = listTypeScriptFiles(TESTS_ROOT)
      .filter((file) =>
        IDENTITY_CREATION_PATTERN.test(readFileSync(file, "utf8")),
      )
      .map(toRepoPath)
      .filter((file) => file !== toRepoPath(__filename));

    expect(creators.sort()).toEqual([...ALLOWED_IDENTITY_CREATORS].sort());
  });
});
