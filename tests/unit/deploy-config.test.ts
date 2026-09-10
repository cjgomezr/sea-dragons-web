import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const VERCEL_CONFIG_PATH = "vercel.json";

/** Sídney. Los dos proyectos de Supabase viven en `ap-southeast-2`, así que
 * cualquier otra región de funciones cruzaría el Pacífico en cada consulta.
 * Ver `docs/prd/e16a-entornos-y-despliegue.md`, RF-2. */
const SYDNEY_FUNCTION_REGION = "syd1";

type VercelConfig = {
  readonly regions?: readonly string[];
  readonly framework?: string;
};

function readVercelConfig(): VercelConfig {
  return JSON.parse(readFileSync(VERCEL_CONFIG_PATH, "utf-8")) as VercelConfig;
}

describe("configuración de despliegue", () => {
  it("declara syd1 como la única región de funciones", () => {
    expect(readVercelConfig().regions).toEqual([SYDNEY_FUNCTION_REGION]);
  });

  // La región se eligió a mano en el panel de Vercel el 9 de septiembre de
  // 2026, porque su importador ya no la pregunta. Declararla en el repositorio
  // es lo que impide que el próximo proyecto, o un cambio de panel, la deje
  // otra vez en Estados Unidos sin que nadie se entere.
  it("declara el framework para que el repositorio no dependa del panel", () => {
    expect(readVercelConfig().framework).toBe("nextjs");
  });
});
