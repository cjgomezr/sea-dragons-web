import { SUPABASE_URL_ENV } from "./config";

/** Ref del proyecto de desarrollo (`seadragons-dev`, Sídney). Ver
 * `docs/entornos.md`: es el único proyecto de Supabase alojado que la suite
 * de tests tiene permitido alcanzar. El otro destino permitido es el Supabase
 * local de la CLI (`LOCAL_SUPABASE_ORIGINS`). */
export const DEVELOPMENT_SUPABASE_PROJECT_REF = "xcfrpcvomjjmfoztifuo";

/** Ref del proyecto de producción (`seadragons-prod`). El guardia lo conoce
 * para poder decir "esto apunta a producción" en vez de "esto apunta a otro
 * sitio": es el error que más caro cuesta y el que antes hay que reconocer.
 * El ref es público, viaja en el host de cada petición del navegador; lo que
 * este mensaje nunca imprime es el valor configurado. */
export const PRODUCTION_SUPABASE_PROJECT_REF = "weqhmtpvgewomslpvefu";

const DEVELOPMENT_SUPABASE_HOSTNAME = `${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`;
const PRODUCTION_SUPABASE_HOSTNAME = `${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;

/** El Supabase local que levanta `npm run db:start` (#447), con la API en el
 * puerto de `supabase/config.toml`. Se compara el origen entero (protocolo,
 * host y puerto) y no sólo el host: "cualquier localhost" dejaría pasar la
 * propia app en el 3417 o cualquier otro servicio de la máquina. */
const LOCAL_SUPABASE_ORIGINS: readonly string[] = [
  "http://127.0.0.1:54321",
  "http://localhost:54321",
];

type Environment = Readonly<Record<string, string | undefined>>;

export type TestSupabaseEnvironmentCheck =
  | { readonly kind: "ok" }
  | { readonly kind: "wrong-project"; readonly message: string };

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Si la URL es la del Supabase local de la CLI. Contra él, y sólo en CI, los
 * tests de red pueden correr en paralelo (#539). */
export function isLocalSupabaseUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && LOCAL_SUPABASE_ORIGINS.includes(parsed.origin);
}

function isAllowedTestSupabase(parsed: URL): boolean {
  return (
    parsed.hostname === DEVELOPMENT_SUPABASE_HOSTNAME ||
    LOCAL_SUPABASE_ORIGINS.includes(parsed.origin)
  );
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
    `(${DEVELOPMENT_SUPABASE_PROJECT_REF}) ni al Supabase local ` +
    `(${LOCAL_SUPABASE_ORIGINS.join(" o ")}). La suite de tests no puede ` +
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

  const parsed = parseUrl(url);
  if (parsed === null) {
    return { kind: "wrong-project", message: wrongProjectMessage(null) };
  }
  if (!isAllowedTestSupabase(parsed)) {
    return {
      kind: "wrong-project",
      message: wrongProjectMessage(parsed.hostname),
    };
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
