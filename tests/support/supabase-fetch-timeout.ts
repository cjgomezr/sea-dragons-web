import {
  SUPABASE_GAVE_UP_PREFIX,
  SUPABASE_RETRY_BUDGET_MS,
  SUPABASE_RETRY_DELAYS_MS,
  type Sleep,
} from "./supabase-retry";

/**
 * A veces una petición a `seadragons-dev` no contesta nunca: ni error ni
 * respuesta. `withSupabaseRetry` sólo ve lo que falla, así que el test se
 * quedaba esperando hasta agotar su plazo, y el job salía en rojo sin decir que
 * había sido dev (#506). Esto envuelve el `fetch` del proyecto `integration`:
 * la aplicación no pone tiempo máximo ni reintenta (#165).
 */

/** Lo más que se espera a que dev conteste una petición. */
export const SUPABASE_FETCH_TIMEOUT_MS = 10_000;

const ATTEMPTS_PER_READ = SUPABASE_RETRY_DELAYS_MS.length + 1;

/** Lo que tarda en rendirse una lectura colgada en todos sus intentos. Los
 * plazos de los tests con red tienen que dejarle sitio. */
export const SUPABASE_FETCH_WORST_CASE_MS =
  SUPABASE_RETRY_BUDGET_MS + SUPABASE_FETCH_TIMEOUT_MS * ATTEMPTS_PER_READ;

/** Repetir una lectura no cambia nada en dev; una escritura colgada pudo
 * aplicarse, y repetirla a ciegas la duplicaría. */
const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);
const DEFAULT_METHOD = "GET";

/** Lo que Node pone a sus errores de aborto. PostgREST reintenta por su cuenta
 * las lecturas que fallan, salvo los abortos: sin esto, cada lectura agotada
 * se repetiría entera otras tres veces. */
const ABORT_ERROR_CODE = "ABORT_ERR";

export type FetchTimeoutCounts = {
  readonly timedOut: number;
  readonly retried: number;
};

export type FetchTimeoutTally = {
  readonly recordTimeout: () => void;
  readonly recordRetry: () => void;
  readonly counts: () => FetchTimeoutCounts;
};

export function createFetchTimeoutTally(): FetchTimeoutTally {
  let counts: FetchTimeoutCounts = { timedOut: 0, retried: 0 };
  return {
    recordTimeout: () => {
      counts = { ...counts, timedOut: counts.timedOut + 1 };
    },
    recordRetry: () => {
      counts = { ...counts, retried: counts.retried + 1 };
    },
    counts: () => counts,
  };
}

export type FetchTimeoutOptions = {
  /** Sólo las peticiones a este origen llevan tiempo máximo. */
  readonly supabaseOrigin: string;
  readonly tally: FetchTimeoutTally;
  readonly timeoutMs?: number;
  readonly sleep?: Sleep;
};

class SupabaseFetchTimeoutError extends Error {
  override readonly name = "SupabaseFetchTimeoutError";
  readonly code = ABORT_ERROR_CODE;
}

type FetchInput = Parameters<typeof fetch>[0];

type GuardedRequest = {
  readonly input: FetchInput;
  readonly init: RequestInit | undefined;
  /** Método y ruta, sin host ni consulta: el host identifica el proyecto y la
   * consulta lleva datos de socios. */
  readonly label: string;
  readonly isRead: boolean;
};

/** `null` si no es una URL absoluta: lo que no va a Supabase pasa sin tocar,
 * y una ruta relativa nunca va. */
function toAbsoluteUrl(input: FetchInput): URL | null {
  const href = input instanceof Request ? input.url : input;
  return URL.canParse(href) ? new URL(href) : null;
}

function readMethod(input: FetchInput, init: RequestInit | undefined): string {
  const method =
    init?.method ?? (input instanceof Request ? input.method : DEFAULT_METHOD);
  return method.toUpperCase();
}

function readCallerSignal(
  input: FetchInput,
  init: RequestInit | undefined,
): AbortSignal | undefined {
  if (init?.signal) {
    return init.signal;
  }
  return input instanceof Request ? input.signal : undefined;
}

type AttemptOutcome =
  | { readonly kind: "answered"; readonly response: Response }
  | { readonly kind: "timed-out" };

async function attemptWithTimeout(
  baseFetch: typeof fetch,
  request: GuardedRequest,
  timeoutMs: number,
): Promise<AttemptOutcome> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const callerSignal = readCallerSignal(request.input, request.init);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;
  try {
    const response = await baseFetch(request.input, {
      ...request.init,
      signal,
    });
    return { kind: "answered", response };
  } catch (thrown) {
    const isOwnTimeout = timeoutSignal.aborted && !callerSignal?.aborted;
    if (!isOwnTimeout) {
      throw thrown;
    }
    return { kind: "timed-out" };
  }
}

function describeGiveUp(
  request: GuardedRequest,
  timeoutMs: number,
  attempts: number,
): string {
  const base = `${SUPABASE_GAVE_UP_PREFIX} a ${request.label} en ${timeoutMs} ms`;
  if (!request.isRead) {
    return `${base}; es una escritura y pudo aplicarse, así que no se reintenta`;
  }
  return `${base}, ${attempts} intentos`;
}

const waitFor: Sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function fetchWithTimeout(
  baseFetch: typeof fetch,
  request: GuardedRequest,
  options: FetchTimeoutOptions,
): Promise<Response> {
  const { tally, timeoutMs = SUPABASE_FETCH_TIMEOUT_MS, sleep } = options;
  for (let attemptIndex = 0; ; attemptIndex += 1) {
    const outcome = await attemptWithTimeout(baseFetch, request, timeoutMs);
    if (outcome.kind === "answered") {
      return outcome.response;
    }
    tally.recordTimeout();

    const delay = SUPABASE_RETRY_DELAYS_MS[attemptIndex];
    if (!request.isRead || delay === undefined) {
      throw new SupabaseFetchTimeoutError(
        describeGiveUp(request, timeoutMs, attemptIndex + 1),
      );
    }
    tally.recordRetry();
    await (sleep ?? waitFor)(delay);
  }
}

/** Devuelve un `fetch` que aborta las peticiones a Supabase que pasan de
 * `timeoutMs`, reintenta las lecturas con las esperas de
 * `SUPABASE_RETRY_DELAYS_MS` y falla en el acto con las escrituras. */
export function withFetchTimeout(
  baseFetch: typeof fetch,
  options: FetchTimeoutOptions,
): typeof fetch {
  const supabaseOrigin = new URL(options.supabaseOrigin).origin;
  return (input, init) => {
    const url = toAbsoluteUrl(input);
    if (url === null || url.origin !== supabaseOrigin) {
      return baseFetch(input, init);
    }
    const method = readMethod(input, init);
    return fetchWithTimeout(
      baseFetch,
      {
        input,
        init,
        label: `${method} ${url.pathname}`,
        isRead: READ_METHODS.has(method),
      },
      options,
    );
  };
}

/** La línea del resumen de la corrida, o `null` si no corrió ningún archivo
 * de integración. */
export function describeFetchTimeoutSummary(
  perFile: readonly FetchTimeoutCounts[],
): string | null {
  if (perFile.length === 0) {
    return null;
  }
  const timedOut = perFile.reduce((total, file) => total + file.timedOut, 0);
  const retried = perFile.reduce((total, file) => total + file.retried, 0);
  return `Peticiones a Supabase dev abortadas por tiempo: ${timedOut}; reintentadas: ${retried}.`;
}
