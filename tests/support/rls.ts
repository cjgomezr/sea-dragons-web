import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe } from "vitest";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { runWithCleanup } from "./run-with-cleanup";
import { createSupabaseTestMemberPool } from "./supabase-test-member-pool";
import { decideSupabaseCredentials } from "./supabase-credentials";
import { SUPABASE_FETCH_WORST_CASE_MS } from "./supabase-fetch-timeout";
import {
  describeSupabaseFailure,
  SUPABASE_RETRY_BUDGET_MS,
  withSupabaseRetry,
} from "./supabase-retry";
import {
  createRunId,
  leasePooledMember,
  type PooledMember,
  type TestMemberPool,
  withPooledMember,
} from "./test-member-pool";

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
 * el reintento pudiera recuperarlo.
 *
 * Y encima, una lectura colgada en todos sus intentos (#506): si el test se
 * agotara antes, el fallo diría "timeout" en vez de nombrar la petición. */
const NETWORK_TEST_BASE_TIMEOUT_MS = 20_000;
const RETRIES_COVERED_PER_TEST = 2;
export const RLS_NETWORK_TEST_TIMEOUT_MS =
  NETWORK_TEST_BASE_TIMEOUT_MS +
  SUPABASE_RETRY_BUDGET_MS * RETRIES_COVERED_PER_TEST +
  SUPABASE_FETCH_WORST_CASE_MS;

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

export type TestUser = PooledMember;

/** El `runId` de este proceso de Vitest: marca las plazas que arrienda, para
 * saber de quién es una que se quedó colgada. */
const HARNESS_RUN_ID = createRunId();

/** La reserva del arnés: sus socios se llaman `rls-<plaza>@example.test`. */
const HARNESS_POOL_NAMESPACE = "rls";

function harnessPool(serviceClient: ServiceRoleClient): TestMemberPool {
  return createSupabaseTestMemberPool(serviceClient.client, HARNESS_RUN_ID);
}

/** Pasa a `run` un usuario real de Supabase Auth que nadie más está usando, y
 * al terminar le borra la fila de socio y lo devuelve a la reserva, incluso si
 * `run` lanza. No crea una identidad por llamada ni la borra (#415): sale de
 * la reserva, y sólo se crea una nueva si todas están ocupadas. Es la única
 * forma correcta de obtener una identidad "authenticated" para
 * `createRlsClient`. */
export async function withTestUser<T>(
  serviceClient: ServiceRoleClient,
  run: (user: TestUser) => Promise<T>,
): Promise<T> {
  return withPooledMember(
    harnessPool(serviceClient),
    HARNESS_POOL_NAMESPACE,
    run,
  );
}

/** Como `withTestUser`, para los tests que montan su usuario en un
 * `beforeAll` y lo sueltan en un `afterAll`. `release` lanza si no pudo
 * dejarlo limpio. */
export async function leaseTestUser(serviceClient: ServiceRoleClient): Promise<{
  readonly user: TestUser;
  readonly release: () => Promise<void>;
}> {
  const { member, returnToPool } = await leasePooledMember(
    harnessPool(serviceClient),
    HARNESS_POOL_NAMESPACE,
  );
  return {
    user: member,
    async release() {
      const failure = await returnToPool();
      if (failure !== null) {
        throw new Error(
          `No se pudo devolver a la reserva al socio de prueba ${member.email}: ${failure}`,
        );
      }
    },
  };
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

/**
 * Pone al día la membresía de un socio ya sembrado (#453): sin ella la
 * frontera, el inicio y las audiencias vivas lo tratan como quien no pagó.
 * No hace falta limpiarla: `memberships` cuelga de `members` en cascada, así
 * que se va con la fila del socio.
 */
export async function seedCurrentMembership(
  serviceClient: ServiceRoleClient,
  member: { readonly clubId: string; readonly userId: string },
): Promise<void> {
  const { error } = await serviceClient.client.from("memberships").upsert({
    club_id: member.clubId,
    user_id: member.userId,
    status: "active",
  });
  if (error) {
    throw new Error(
      `No se pudo poner al día la membresía de ${member.userId}: ${error.message}`,
    );
  }
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
