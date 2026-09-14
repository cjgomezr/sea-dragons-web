import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Supabase dev a veces contesta `504 Gateway Timeout` desde CI y un minuto
 * después contesta bien. Sin reintento, ese corte deja la corrida entera en
 * rojo y, si pasa en main, abre un incidente falso (#163). Esto sólo lo usa el
 * arnés de pruebas: la aplicación no reintenta (#165).
 */

/** Las esperas entre intentos. Definen a la vez cuánto se espera y cuántos
 * reintentos hay: uno por espera, después del primer intento. */
export const SUPABASE_RETRY_DELAYS_MS: readonly number[] = [
  2_000, 5_000, 10_000,
];

/** Lo más que puede llegar a esperar un reintento, sin contar lo que tarde
 * cada intento. Los plazos de los tests con red tienen que dejarle sitio. */
export const SUPABASE_RETRY_BUDGET_MS = SUPABASE_RETRY_DELAYS_MS.reduce(
  (total, delay) => total + delay,
  0,
);

export type Sleep = (ms: number) => Promise<void>;

const waitFor: Sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type SupabaseErrorLike = {
  readonly message: string;
  readonly name?: string;
  readonly status?: number;
};

/** Lo que devuelven auth (`error.status`) y PostgREST (`status` en la propia
 * respuesta): supabase-js casi nunca lanza, así que el fallo hay que leerlo. */
export type SupabaseResult = {
  readonly error: SupabaseErrorLike | null;
  readonly status?: number;
  readonly statusText?: string;
};

const SERVER_ERROR_MIN_STATUS = 500;
const SERVER_ERROR_MAX_STATUS = 599;
/** El nombre con el que auth-js marca un fallo de red o un 5xx. */
const AUTH_RETRYABLE_ERROR_NAME = "AuthRetryableFetchError";
/** Lo que deja una conexión que no llegó a completarse: undici dice
 * `fetch failed` y PostgREST lo devuelve como `TypeError: fetch failed`. */
const NETWORK_FAILURE_PATTERN =
  /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|other side closed/i;

function isServerErrorStatus(status: number | undefined): boolean {
  return (
    status !== undefined &&
    status >= SERVER_ERROR_MIN_STATUS &&
    status <= SERVER_ERROR_MAX_STATUS
  );
}

/** Describe el fallo si es pasajero (5xx o red), o `null` si no lo es. */
function describeTransientResult(result: SupabaseResult): string | null {
  const { error } = result;
  if (error === null) {
    return null;
  }
  const status = error.status ?? result.status;
  if (isServerErrorStatus(status)) {
    return `${status} ${result.statusText || error.message}`;
  }
  if (
    error.name === AUTH_RETRYABLE_ERROR_NAME ||
    NETWORK_FAILURE_PATTERN.test(error.message)
  ) {
    return error.message;
  }
  return null;
}

/** Lo que lanza un reintento que se agotó. Su mensaje cita el último fallo, que
 * suele ser de red, así que se distingue por la clase: si no, un reintento
 * anidado se volvería a reintentar entero desde fuera. */
class SupabaseRetryExhaustedError extends Error {
  override readonly name = "SupabaseRetryExhaustedError";
}

function describeTransientThrow(thrown: unknown): string | null {
  if (thrown instanceof SupabaseRetryExhaustedError) {
    return null;
  }
  return thrown instanceof Error && NETWORK_FAILURE_PATTERN.test(thrown.message)
    ? thrown.message
    : null;
}

type Attempt<T> =
  | { readonly kind: "returned"; readonly result: T }
  | { readonly kind: "thrown"; readonly thrown: unknown };

async function attempt<T>(call: () => PromiseLike<T>): Promise<Attempt<T>> {
  try {
    return { kind: "returned", result: await call() };
  } catch (thrown) {
    return { kind: "thrown", thrown };
  }
}

/**
 * Ejecuta `call` y la repite mientras falle por algo pasajero (5xx o red),
 * esperando `SUPABASE_RETRY_DELAYS_MS` entre intentos. Cualquier otro
 * resultado, bueno o malo, vuelve al llamador en cuanto aparece: un 4xx es un
 * bug del test y repetirlo sólo lo esconde. Si se agotan los intentos, lanza
 * nombrando `operation`.
 */
export async function withSupabaseRetry<T extends SupabaseResult>(
  operation: string,
  call: () => PromiseLike<T>,
  sleep: Sleep = waitFor,
): Promise<T> {
  for (let attemptIndex = 0; ; attemptIndex += 1) {
    const outcome = await attempt(call);
    const transientFailure =
      outcome.kind === "returned"
        ? describeTransientResult(outcome.result)
        : describeTransientThrow(outcome.thrown);

    if (transientFailure === null) {
      if (outcome.kind === "thrown") {
        throw outcome.thrown;
      }
      return outcome.result;
    }

    const delay = SUPABASE_RETRY_DELAYS_MS[attemptIndex];
    if (delay === undefined) {
      throw new SupabaseRetryExhaustedError(
        `Supabase dev no contestó a ${operation} tras ${attemptIndex + 1} intentos (último: ${transientFailure})`,
      );
    }
    await sleep(delay);
  }
}

/**
 * Como `withSupabaseRetry`, pero cualquier fallo vuelve como mensaje en vez de
 * lanzar: el error que Supabase devolvió, el reintento agotado o lo que lance
 * la operación. `null` es que contestó bien. Es para las limpiezas, que no
 * deben tapar el resultado de quien las llama.
 */
export async function describeSupabaseFailure(
  operation: string,
  call: () => PromiseLike<SupabaseResult>,
  sleep: Sleep = waitFor,
): Promise<string | null> {
  try {
    const { error } = await withSupabaseRetry(operation, call, sleep);
    return error === null ? null : error.message;
  } catch (thrown) {
    return thrown instanceof Error ? thrown.message : String(thrown);
  }
}

export type AuthAdmin = Pick<
  SupabaseClient["auth"]["admin"],
  "createUser" | "listUsers"
>;

export type ConfirmedUserRequest = {
  readonly email: string;
  readonly password: string;
  /** Qué se está creando, para los mensajes de error. */
  readonly operation: string;
};

const EMAIL_EXISTS_CODE = "email_exists";
const USERS_PAGE_SIZE = 1_000;

/** Busca por correo recorriendo las páginas de usuarios. El correo del arnés
 * es un UUID aleatorio, así que no puede coincidir con el de nadie más. */
async function findUserByEmail(
  admin: AuthAdmin,
  email: string,
  sleep: Sleep,
): Promise<User | null> {
  for (let page = 1; ; page += 1) {
    const { data, error } = await withSupabaseRetry(
      "buscar el usuario de prueba por su correo",
      () => admin.listUsers({ page, perPage: USERS_PAGE_SIZE }),
      sleep,
    );
    if (error) {
      throw new Error(
        `No se pudo buscar el usuario de prueba por su correo: ${error.message}`,
      );
    }
    const found = data.users.find((user) => user.email === email);
    if (found) {
      return found;
    }
    if (data.users.length < USERS_PAGE_SIZE) {
      return null;
    }
  }
}

/**
 * Crea una identidad ya confirmada, reintentando los cortes pasajeros.
 *
 * Un 5xx no garantiza que Supabase no la creara: a veces la crea y lo que se
 * pierde es la respuesta. Entonces el reintento recibe "el correo ya existe",
 * y lo correcto es seguir con ese usuario en vez de dejarlo huérfano en dev.
 * Si el correo ya existe a la primera, sin corte previo, es un bug del test.
 */
export async function createConfirmedUser(
  admin: AuthAdmin,
  request: ConfirmedUserRequest,
  sleep: Sleep = waitFor,
): Promise<User> {
  let attempts = 0;
  const { data, error } = await withSupabaseRetry(
    request.operation,
    async () => {
      attempts += 1;
      const result = await admin.createUser({
        email: request.email,
        password: request.password,
        email_confirm: true,
      });
      // Si hubo un intento anterior, fue pasajero: de lo contrario el reintento
      // no habría vuelto a llamar.
      const isLostCreation =
        attempts > 1 && result.error?.code === EMAIL_EXISTS_CODE;
      if (!isLostCreation) {
        return result;
      }
      const user = await findUserByEmail(admin, request.email, sleep);
      return user ? { data: { user }, error: null } : result;
    },
    sleep,
  );

  if (error || !data.user) {
    throw new Error(
      `No se pudo ${request.operation}: ${error?.message ?? "sin datos"}`,
    );
  }
  return data.user;
}
