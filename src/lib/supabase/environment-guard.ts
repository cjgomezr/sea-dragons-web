import { SUPABASE_URL_ENV } from "./config";

/** Ref del proyecto de desarrollo (`seadragons-dev`, Sídney). Ver
 * `docs/entornos.md`: es el único proyecto de Supabase que la suite de tests
 * tiene permitido alcanzar. */
export const DEVELOPMENT_SUPABASE_PROJECT_REF = "xcfrpcvomjjmfoztifuo";

type Environment = Readonly<Record<string, string | undefined>>;

export type TestSupabaseEnvironmentCheck =
  | { readonly kind: "ok" }
  | { readonly kind: "wrong-project"; readonly message: string };

/** Sin URL configurada no hay forma de que un test alcance ningún proyecto de
 * Supabase real, así que no hay nada que este guardia deba impedir: otros
 * mecanismos (`describeRls`) ya deciden si esos tests corren o se saltan. */
export function checkTestSupabaseEnvironment(
  env: Environment,
): TestSupabaseEnvironmentCheck {
  const url = env[SUPABASE_URL_ENV]?.trim();
  if (!url) {
    return { kind: "ok" };
  }

  if (!url.includes(DEVELOPMENT_SUPABASE_PROJECT_REF)) {
    return {
      kind: "wrong-project",
      message:
        `${SUPABASE_URL_ENV} no apunta al proyecto de desarrollo declarado ` +
        `(${DEVELOPMENT_SUPABASE_PROJECT_REF}). La suite de tests no puede ` +
        "alcanzar ningún otro proyecto de Supabase, ni siquiera por accidente.",
    };
  }

  return { kind: "ok" };
}

/** Punto de entrada que la suite llama antes de que cualquier test pueda abrir
 * un cliente de Supabase real (ver `tests/support/rls.ts`). Lanza en vez de
 * devolver el resultado para que un entorno mal configurado detenga la
 * corrida entera de inmediato, no solo el test que lo hubiera notado. */
export function assertTestSupabaseEnvironment(
  env: Environment = process.env,
): void {
  const check = checkTestSupabaseEnvironment(env);
  if (check.kind === "wrong-project") {
    throw new Error(check.message);
  }
}
