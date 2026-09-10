import { describe, expect, it } from "vitest";
import {
  IGNORED_ENV_VARS,
  PLATFORM_INJECTED_ENV_VARS,
  SECRET_ENV_VARS,
  findEnvVarsReadByCode,
  findUndocumentedEnvVars,
  readEnvExampleContent,
  readEnvExampleNames,
} from "../support/env-vars";

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const STRIPE_LIVE_KEY_PATTERN = /sk_live_/;
const SUPABASE_SECRET_KEY_PATTERN = /sb_secret_/;

function readEnvExampleValues(): string[] {
  return readEnvExampleContent()
    .split("\n")
    .filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line))
    .map((line) => line.slice(line.indexOf("=") + 1).trim());
}

describe(".env.example", () => {
  it("documenta toda variable que el código lee de process.env en src/, scripts/ y tests/", () => {
    const used = findEnvVarsReadByCode();
    const documented = readEnvExampleNames();

    const missing = findUndocumentedEnvVars(used, documented);

    expect(missing, `faltan en .env.example: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("no exige documentar las variables que inyecta la plataforma en vez de una persona", () => {
    const used = [...findEnvVarsReadByCode()];

    for (const name of PLATFORM_INJECTED_ENV_VARS) {
      expect(used).not.toContain(name);
    }
  });

  // Toda exclusión resta cobertura a la comprobación de arriba, así que la
  // lista se fija aquí entera: ampliarla obliga a tocar este test, y ese es el
  // momento de justificar la nueva en `tests/support/env-vars.ts`.
  it("excluye exactamente las variables declaradas, ni una más", () => {
    expect([...IGNORED_ENV_VARS]).toEqual([
      "PATH",
      ...PLATFORM_INJECTED_ENV_VARS,
    ]);
  });

  it("falla nombrando la variable que falta cuando se añade una lectura nueva sin documentarla", () => {
    const used = new Set(["NEXT_PUBLIC_SUPABASE_URL", "UNA_VARIABLE_NUEVA"]);
    const documented = new Set(["NEXT_PUBLIC_SUPABASE_URL"]);

    expect(findUndocumentedEnvVars(used, documented)).toEqual([
      "UNA_VARIABLE_NUEVA",
    ]);
  });

  it("ninguna variable de la lista de secretos lleva el prefijo NEXT_PUBLIC_", () => {
    for (const name of SECRET_ENV_VARS) {
      expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  it("ningún valor tiene forma de credencial real (JWT, sk_live, sb_secret)", () => {
    for (const value of readEnvExampleValues()) {
      expect(value).not.toMatch(JWT_PATTERN);
      expect(value).not.toMatch(STRIPE_LIVE_KEY_PATTERN);
      expect(value).not.toMatch(SUPABASE_SECRET_KEY_PATTERN);
    }
  });
});
