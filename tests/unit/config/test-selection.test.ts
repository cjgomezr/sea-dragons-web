import { describe, expect, it } from "vitest";
import {
  describeSkippedIntegrationTests,
  INTEGRATION_TEST_PATTERNS,
  RUN_INTEGRATION_TESTS_ENV,
  selectExcludedTests,
} from "../../support/test-selection";

describe("la selección de tests de Vitest", () => {
  it("excluye los de integración y los de RLS cuando la variable no está", () => {
    const excluded = selectExcludedTests({});

    expect(excluded).toEqual(
      expect.arrayContaining([
        "tests/**/*.integration.test.ts",
        "tests/rls/**",
      ]),
    );
  });

  it("no excluye ninguno de los dos con RUN_INTEGRATION_TESTS=1", () => {
    const excluded = selectExcludedTests({ [RUN_INTEGRATION_TESTS_ENV]: "1" });

    for (const pattern of INTEGRATION_TEST_PATTERNS) {
      expect(excluded).not.toContain(pattern);
    }
  });

  it("sigue excluyendo lo que Vitest excluye por defecto en los dos casos", () => {
    for (const env of [{}, { [RUN_INTEGRATION_TESTS_ENV]: "1" }]) {
      expect(selectExcludedTests(env)).toContain("**/node_modules/**");
    }
  });

  it("trata cualquier valor distinto de 1 como si la variable no estuviera", () => {
    const excluded = selectExcludedTests({ [RUN_INTEGRATION_TESTS_ENV]: "0" });

    expect(excluded).toEqual(
      expect.arrayContaining([...INTEGRATION_TEST_PATTERNS]),
    );
  });

  it("dice en una línea que se saltaron y cómo correrlos", () => {
    const notice = describeSkippedIntegrationTests({});

    expect(notice).not.toBeNull();
    expect(notice).not.toContain("\n");
    expect(notice).toContain("RUN_INTEGRATION_TESTS=1");
  });

  it("no dice nada cuando los tests de integración corren", () => {
    expect(
      describeSkippedIntegrationTests({ [RUN_INTEGRATION_TESTS_ENV]: "1" }),
    ).toBeNull();
  });
});
