import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe } from "vitest";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { decideSupabaseCredentials } from "./supabase-credentials";
import {
  createConfirmedUser,
  describeSupabaseFailure,
  SUPABASE_RETRY_BUDGET_MS,
  withSupabaseRetry,
} from "./supabase-retry";

// `.env.local` ya está cargado y verificado contra el proyecto de desarrollo
// por `vitest.setup.ts` (que corre antes que cualquier archivo de test): no
// se repite aquí.

/** Timeout de los tests que hablan por red con el proyecto de Supabase (en
 * Sídney): bajo `npm test` completo compiten por CPU y sockets con el resto
 * de los workers de Vitest, y los 5 s por defecto, pensados para tests en
 * memoria, no alcanzan. Mismo patrón que el #50 para tests que lanzan
 * procesos reales.
 *
 * Encima va el presupuesto de dos reintentos completos (#165): un test crea el
 * usuario, inicia sesión, consulta y limpia, y un corte puede pillar a más de
 * una de esas llamadas. Sin ese margen el test caería por plazo antes de que
 * el reintento pudiera recuperarlo. */
const NETWORK_TEST_BASE_TIMEOUT_MS = 20_000;
const RETRIES_COVERED_PER_TEST = 2;
export const RLS_NETWORK_TEST_TIMEOUT_MS =
  NETWORK_TEST_BASE_TIMEOUT_MS +
  SUPABASE_RETRY_BUDGET_MS * RETRIES_COVERED_PER_TEST;

type Environment = Readonly<Record<string, string | undefined>>;

// Dos tipos distintos, nunca uno intercambiable por el otro: `RlsClient`
// queda sujeto a las policies de la base, `ServiceRoleClient` las salta. El
// campo `kind` es lo que permite a `assertDenied` rechazar en tiempo de
// ejecución un cliente de servicio colado con un `as`.
export type RlsClient = {
  readonly kind: "rls-client";
  readonly role: "anon" | "authenticated";
  readonly client: SupabaseClient;
};

export type ServiceRoleClient = {
  readonly kind: "service-role-client";
  readonly client: SupabaseClient;
};

export type RlsIdentity =
  | { readonly role: "anon" }
  | {
      readonly role: "authenticated";
      readonly email: string;
      readonly password: string;
    };

/** Cliente sujeto a RLS que actúa con la identidad pedida. Usa siempre la
 * llave anónima, nunca la de servicio: para "authenticated" abre sesión con
 * un usuario real (créalo antes con `withTestUser`). */
export async function createRlsClient(
  identity: RlsIdentity,
  env: Environment,
): Promise<RlsClient> {
  const config = readSupabaseConfig(env);
  if (config.kind === "missing") {
    throw new Error(
      `Faltan variables de entorno para el cliente RLS: ${config.missingKeys.join(", ")}`,
    );
  }

  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (identity.role === "authenticated") {
    const { error } = await withSupabaseRetry(
      "autenticar el cliente RLS de prueba",
      () =>
        client.auth.signInWithPassword({
          email: identity.email,
          password: identity.password,
        }),
    );
    if (error) {
      throw new Error(
        `No se pudo autenticar el cliente RLS de prueba: ${error.message}`,
      );
    }
  }

  return { kind: "rls-client", role: identity.role, client };
}

/** Cliente que evita RLS, envuelto con un tipo distinto al de `RlsClient` a
 * propósito. Solo para sembrar y limpiar datos de prueba, nunca para afirmar
 * sobre lo que un usuario puede leer. */
export function createServiceRoleTestClient(
  env: Environment,
): ServiceRoleClient {
  return { kind: "service-role-client", client: createServiceRoleClient(env) };
}

/** `describe` para casos de RLS reales. Las pruebas necesitan la llave anónima
 * (para actuar como usuario) y la de servicio (para crear el usuario y
 * sembrar/limpiar datos): sin cualquiera de las dos no hay forma de montar el
 * caso. Fuera de CI eso se salta, y el nombre del salto nombra las variables
 * que faltan; en CI rompe, porque allí están (ver
 * `decideSupabaseCredentials`). */
export function describeRls(
  name: string,
  fn: () => void,
  env: Environment = process.env,
): void {
  const decision = decideSupabaseCredentials(env);
  if (decision.kind === "skip") {
    describe.skip(skippedSuiteName(name, decision.reason), fn);
    return;
  }
  describe(name, fn);
}

/** El título con el que sale un salto. Quien lea la corrida ve ahí qué le
 * falta a su máquina, así que se prueba aparte: el nombre es la única parte
 * de un test saltado que alguien llega a leer. */
export function skippedSuiteName(name: string, reason: string): string {
  return `${name} (saltado: ${reason})`;
}

/** Ejecuta `run` y siempre intenta `cleanup` después, sin dejar que un fallo
 * de limpieza tape la razón real por la que `run` falló: si las dos fallan,
 * la de `run` es la que se relanza y la de limpieza queda registrada aparte.
 * `cleanup` devuelve el mensaje de su fallo, o `null` si limpió. */
async function runWithCleanup<T>(
  run: () => Promise<T>,
  cleanup: () => Promise<string | null>,
  cleanupFailureMessage: string,
): Promise<T> {
  let result: T;
  try {
    result = await run();
  } catch (runError) {
    const cleanupFailure = await cleanup();
    if (cleanupFailure !== null) {
      console.error(`${cleanupFailureMessage}: ${cleanupFailure}`);
    }
    throw runError;
  }

  const cleanupFailure = await cleanup();
  if (cleanupFailure !== null) {
    throw new Error(`${cleanupFailureMessage}: ${cleanupFailure}`);
  }
  return result;
}

export type TestUser = {
  readonly id: string;
  readonly email: string;
  readonly password: string;
};

/** Crea un usuario real de Supabase Auth con la llave de servicio, lo pasa a
 * `run`, y lo borra al terminar incluso si `run` lanza. Es la única forma
 * correcta de obtener una identidad "authenticated" para `createRlsClient`. */
export async function withTestUser<T>(
  serviceClient: ServiceRoleClient,
  run: (user: TestUser) => Promise<T>,
): Promise<T> {
  const email = `rls-harness-${randomUUID()}@example.test`;
  const password = randomUUID();

  const createdUser = await createConfirmedUser(
    serviceClient.client.auth.admin,
    { email, password, operation: "crear el usuario de prueba del arnés RLS" },
  );

  const user: TestUser = { id: createdUser.id, email, password };
  return runWithCleanup(
    () => run(user),
    () =>
      describeSupabaseFailure("borrar el usuario de prueba del arnés RLS", () =>
        serviceClient.client.auth.admin.deleteUser(user.id),
      ),
    "No se pudo limpiar el usuario de prueba del arnés RLS",
  );
}

/** Siembra `rows` en `table` con la llave de servicio, pasa las filas
 * insertadas (con su `id` real) a `run`, y las borra al terminar incluso si
 * `run` lanza: ningún test de RLS deja residuo para el siguiente. */
export async function withSeededRows<T>(
  serviceClient: ServiceRoleClient,
  table: string,
  rows: readonly Record<string, unknown>[],
  run: (seededRows: readonly Record<string, unknown>[]) => Promise<T>,
): Promise<T> {
  const { data, error } = await serviceClient.client
    .from(table)
    .insert(rows)
    .select();
  if (error || !data) {
    throw new Error(
      `No se pudo sembrar la tabla ${table} para el arnés RLS: ${error?.message ?? "sin datos"}`,
    );
  }

  const ids = data.map((row) => row.id as string);
  return runWithCleanup(
    () => run(data),
    () =>
      describeSupabaseFailure(
        `limpiar la tabla ${table} tras el arnés RLS`,
        () => serviceClient.client.from(table).delete().in("id", ids),
      ),
    `No se pudo limpiar la tabla ${table} tras el arnés RLS`,
  );
}

export type RlsQueryError = {
  readonly code?: string;
  readonly message: string;
};

export type RlsQueryResult = {
  readonly data: unknown;
  readonly error: RlsQueryError | null;
};

// Código Postgres de `insufficient_privilege`. Sin `GRANT`, PostgREST
// responde con este mismo error antes de que RLS llegue a evaluarse (ver la
// sección 1 del skill `nextjs-supabase-practices`): un error genérico no
// relacionado con permisos (tabla renombrada, timeout de red) no cuenta como
// negación, o `assertDenied` daría por buena una tabla que ya no existe.
const PERMISSION_DENIED_CODE = "42501";
const PERMISSION_DENIED_MESSAGE_PATTERN = /permission denied/i;

function isPermissionDenied(error: RlsQueryError): boolean {
  return (
    error.code === PERMISSION_DENIED_CODE ||
    PERMISSION_DENIED_MESSAGE_PATTERN.test(error.message)
  );
}

/** Afirma que RLS niega `query` para `rlsClient`: pasa con una lista vacía o
 * un error de permiso, falla en cuanto ve una fila o un error que no es de
 * permiso. Rechaza en tiempo de ejecución un cliente que no sea `RlsClient`,
 * para que un cliente de servicio colado a la fuerza no produzca un falso
 * verde. */
export async function assertDenied(
  rlsClient: RlsClient,
  query: (client: SupabaseClient) => PromiseLike<RlsQueryResult>,
): Promise<void> {
  if (rlsClient.kind !== "rls-client") {
    throw new Error(
      "assertDenied requiere un cliente sujeto a RLS (createRlsClient): un cliente de servicio salta RLS y produciría un falso verde.",
    );
  }

  const { data, error } = await query(rlsClient.client);
  if (error !== null) {
    if (!isPermissionDenied(error)) {
      throw new Error(
        `assertDenied esperaba un error de permiso, pero recibió uno distinto: ${error.message}`,
      );
    }
    return;
  }

  const rowCount = Array.isArray(data) ? data.length : data == null ? 0 : 1;
  if (rowCount > 0) {
    throw new Error(
      `Se esperaba que RLS negara la consulta, pero devolvió ${rowCount} fila(s).`,
    );
  }
}
