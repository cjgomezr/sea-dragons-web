import { SUPABASE_URL_ENV } from "./config";

/** Ref del proyecto de desarrollo (`seadragons-dev`, Sídney). Ver
 * `docs/entornos.md`: es el único proyecto de Supabase que la suite de tests
 * tiene permitido alcanzar. Un Supabase local vía CLI (`127.0.0.1:54321`)
 * también se rechaza a propósito: este proyecto no lo usa como flujo
 * soportado, así que cualquier URL que no sea exactamente esta cuenta como
 * "proyecto equivocado". */
export const DEVELOPMENT_SUPABASE_PROJECT_REF = "xcfrpcvomjjmfoztifuo";

/** Ref del proyecto de producción (`seadragons-prod`). El guardia lo conoce
 * para poder decir "esto apunta a producción" en vez de "esto apunta a otro
 * sitio": es el error que más caro cuesta y el que antes hay que reconocer.
 * El ref es público, viaja en el host de cada petición del navegador; lo que
 * este mensaje nunca imprime es el valor configurado. */
export const PRODUCTION_SUPABASE_PROJECT_REF = "weqhmtpvgewomslpvefu";

const DEVELOPMENT_SUPABASE_HOSTNAME = `${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`;
const PRODUCTION_SUPABASE_HOSTNAME = `${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;

type Environment = Readonly<Record<string, string | undefined>>;

export type TestSupabaseEnvironmentCheck =
  | { readonly kind: "ok" }
  | { readonly kind: "wrong-project"; readonly message: string };

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Qué se le dice a quien lea el fallo. Un secreto de CI que apunta a
 * producción merece que el mensaje lo nombre: desde el issue #149 el runner
 * lleva una llave de escritura, y "apunta a otro proyecto" costaría media
 * hora de búsqueda justo en el caso más caro. Cualquier otro destino sólo
 * necesita saber que no es el que la suite tiene permitido alcanzar. */
function wrongProjectMessage(hostname: string | null): string {
  if (hostname === PRODUCTION_SUPABASE_HOSTNAME) {
    return (
      `${SUPABASE_URL_ENV} apunta al proyecto de PRODUCCIÓN (seadragons-prod, ` +
      `${PRODUCTION_SUPABASE_PROJECT_REF}). La suite de tests sólo puede ` +
      `alcanzar el de desarrollo (${DEVELOPMENT_SUPABASE_PROJECT_REF}), así ` +
      "que se detiene aquí, antes de que ningún test escriba."
    );
  }
  return (
    `${SUPABASE_URL_ENV} no apunta al proyecto de desarrollo declarado ` +
    `(${DEVELOPMENT_SUPABASE_PROJECT_REF}). La suite de tests no puede ` +
    "alcanzar ningún otro proyecto de Supabase, ni siquiera por accidente."
  );
}

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

  const hostname = hostnameOf(url);
  if (hostname !== DEVELOPMENT_SUPABASE_HOSTNAME) {
    return { kind: "wrong-project", message: wrongProjectMessage(hostname) };
  }

  return { kind: "ok" };
}

/** Punto de entrada que `vitest.setup.ts` llama antes de que cualquier test
 * pueda abrir un cliente de Supabase real. Lanza en vez de devolver el
 * resultado para que un entorno mal configurado detenga la corrida entera de
 * inmediato, no solo el test que lo hubiera notado. */
export function assertTestSupabaseEnvironment(
  env: Environment = process.env,
): void {
  const check = checkTestSupabaseEnvironment(env);
  if (check.kind === "wrong-project") {
    throw new Error(check.message);
  }
}
