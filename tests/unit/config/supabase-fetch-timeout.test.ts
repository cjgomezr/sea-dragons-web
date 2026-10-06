import { describe, expect, it, vi } from "vitest";
import {
  createFetchTimeoutTally,
  describeFetchTimeoutSummary,
  SUPABASE_FETCH_TIMEOUT_MS,
  SUPABASE_FETCH_WORST_CASE_MS,
  withFetchTimeout,
} from "../../support/supabase-fetch-timeout";
import {
  SUPABASE_RETRY_BUDGET_MS,
  SUPABASE_RETRY_DELAYS_MS,
  withSupabaseRetry,
} from "../../support/supabase-retry";
import { RLS_NETWORK_TEST_TIMEOUT_MS } from "../../support/rls";

const SUPABASE_ORIGIN = "https://abcdefghijklmnop.supabase.co";
const SERVICE_KEY = "service-role-secret";
const READ_URL = `${SUPABASE_ORIGIN}/rest/v1/members?email=eq.socia%40example.com`;
const WRITE_URL = `${SUPABASE_ORIGIN}/rest/v1/members?id=eq.42`;
/** Lo bastante corto para que un `fetch` colgado no frene la suite. */
const TEST_TIMEOUT_MS = 20;

type FetchCall = Parameters<typeof fetch>;

/** Un `fetch` que no contesta nunca: sólo se rinde cuando lo abortan, como
 * undici con una señal. */
function hangingResponse(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(init.signal?.reason);
    });
  });
}

function scriptedFetch(
  answers: readonly ("hang" | "answer")[],
): ReturnType<typeof vi.fn<(...args: FetchCall) => Promise<Response>>> {
  let callIndex = 0;
  return vi.fn((_input: FetchCall[0], init?: FetchCall[1]) => {
    const answer = answers[callIndex] ?? "answer";
    callIndex += 1;
    return answer === "hang"
      ? hangingResponse(init)
      : Promise.resolve(new Response("[]", { status: 200 }));
  });
}

function guard(baseFetch: typeof fetch) {
  const tally = createFetchTimeoutTally();
  const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  const guardedFetch = withFetchTimeout(baseFetch, {
    supabaseOrigin: SUPABASE_ORIGIN,
    timeoutMs: TEST_TIMEOUT_MS,
    sleep,
    tally,
  });
  return { guardedFetch, tally, sleep };
}

describe("el tiempo máximo de las peticiones a Supabase dev", () => {
  it("es de diez segundos", () => {
    expect(SUPABASE_FETCH_TIMEOUT_MS).toBe(10_000);
  });

  it("deja pasar sin reintentos una respuesta que llega a tiempo", async () => {
    const baseFetch = scriptedFetch(["answer"]);
    const { guardedFetch, tally } = guard(baseFetch);

    const response = await guardedFetch(READ_URL);

    expect(response.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(tally.counts()).toEqual({ timedOut: 0, retried: 0 });
  });

  it("deja pasar una respuesta lenta que llega antes del tiempo máximo", async () => {
    const slowFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(new Response("[]", { status: 200 }));
          }, TEST_TIMEOUT_MS / 4);
        }),
    );
    const { guardedFetch, tally } = guard(slowFetch);

    const response = await guardedFetch(READ_URL);

    expect(response.status).toBe(200);
    expect(slowFetch).toHaveBeenCalledTimes(1);
    expect(tally.counts()).toEqual({ timedOut: 0, retried: 0 });
  });

  it("aborta una lectura colgada y la reintenta tras la primera espera", async () => {
    const baseFetch = scriptedFetch(["hang", "answer"]);
    const { guardedFetch, sleep } = guard(baseFetch);

    const response = await guardedFetch(READ_URL, { method: "GET" });

    expect(response.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(SUPABASE_RETRY_DELAYS_MS[0]);
  });

  it("trata una petición sin método como una lectura", async () => {
    const baseFetch = scriptedFetch(["hang", "answer"]);
    const { guardedFetch } = guard(baseFetch);

    const response = await guardedFetch(READ_URL);

    expect(response.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it("reintenta también un HEAD colgado", async () => {
    const baseFetch = scriptedFetch(["hang", "answer"]);
    const { guardedFetch } = guard(baseFetch);

    await guardedFetch(READ_URL, { method: "HEAD" });

    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it("falla con método y ruta si una lectura se cuelga en todos los intentos", async () => {
    const attempts = SUPABASE_RETRY_DELAYS_MS.length + 1;
    const baseFetch = scriptedFetch(
      Array.from({ length: attempts }, () => "hang"),
    );
    const { guardedFetch, sleep } = guard(baseFetch);

    const failure = guardedFetch(READ_URL, {
      headers: { apikey: SERVICE_KEY },
    });

    await expect(failure).rejects.toThrow(
      `Supabase dev no contestó a GET /rest/v1/members en ${TEST_TIMEOUT_MS} ms, ${attempts} intentos`,
    );
    expect(baseFetch).toHaveBeenCalledTimes(attempts);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
      ...SUPABASE_RETRY_DELAYS_MS,
    ]);
  });

  it("no reintenta una escritura colgada y falla con método y ruta", async () => {
    const baseFetch = scriptedFetch(["hang", "answer"]);
    const { guardedFetch, sleep } = guard(baseFetch);

    const failure = guardedFetch(WRITE_URL, {
      method: "PATCH",
      headers: { apikey: SERVICE_KEY },
      body: JSON.stringify({ phone: "0400 000 000" }),
    });

    await expect(failure).rejects.toThrow(
      `Supabase dev no contestó a PATCH /rest/v1/members en ${TEST_TIMEOUT_MS} ms`,
    );
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each(["POST", "PUT", "DELETE"])(
    "tampoco reintenta un %s colgado",
    async (method) => {
      const baseFetch = scriptedFetch(["hang", "answer"]);
      const { guardedFetch } = guard(baseFetch);

      await expect(guardedFetch(WRITE_URL, { method })).rejects.toThrow(
        `${method} /rest/v1/members`,
      );
      expect(baseFetch).toHaveBeenCalledTimes(1);
    },
  );

  it("no deja en el mensaje ni el host, ni la llave, ni los datos", async () => {
    const baseFetch = scriptedFetch(["hang"]);
    const { guardedFetch } = guard(baseFetch);

    const thrown = await guardedFetch(WRITE_URL, {
      method: "POST",
      headers: { apikey: SERVICE_KEY },
      body: JSON.stringify({ phone: "0400 000 000" }),
    }).catch((error: unknown) => error);

    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).not.toContain("supabase.co");
    expect(message).not.toContain(SERVICE_KEY);
    expect(message).not.toContain("eq.42");
    expect(message).not.toContain("0400");
  });

  it("lee el método y la ruta de un Request", async () => {
    const baseFetch = scriptedFetch(["hang"]);
    const { guardedFetch } = guard(baseFetch);

    const failure = guardedFetch(new Request(WRITE_URL, { method: "DELETE" }));

    await expect(failure).rejects.toThrow("DELETE /rest/v1/members");
  });

  it("marca el fallo como un aborto para que PostgREST no lo reintente encima", async () => {
    const baseFetch = scriptedFetch(["hang"]);
    const { guardedFetch } = guard(baseFetch);

    const thrown = await guardedFetch(WRITE_URL, { method: "POST" }).catch(
      (error: unknown) => error,
    );

    expect(thrown).toMatchObject({ code: "ABORT_ERR" });
  });

  it("no vuelve a reintentar desde withSupabaseRetry lo que ya falló por tiempo", async () => {
    const baseFetch = scriptedFetch(["hang", "answer"]);
    const { guardedFetch } = guard(baseFetch);
    const retrySleep = vi.fn(() => Promise.resolve());

    const failure = withSupabaseRetry(
      "guardar el teléfono",
      async () => {
        try {
          await guardedFetch(WRITE_URL, { method: "POST" });
          return { error: null };
        } catch (thrown) {
          // Así lo devuelve auth-js: el mensaje original con su nombre propio.
          const message = thrown instanceof Error ? thrown.message : "";
          return { error: { name: "AuthRetryableFetchError", message } };
        }
      },
      retrySleep,
    );

    await expect(failure).resolves.toMatchObject({
      error: { message: expect.stringContaining("POST /rest/v1/members") },
    });
    expect(retrySleep).not.toHaveBeenCalled();
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it("respeta el aborto de quien hizo la petición, sin reintentarlo", async () => {
    const baseFetch = scriptedFetch(["hang", "answer"]);
    const { guardedFetch, tally } = guard(baseFetch);
    const controller = new AbortController();

    const failure = guardedFetch(READ_URL, { signal: controller.signal });
    controller.abort(new Error("cancelada por el test"));

    await expect(failure).rejects.toThrow("cancelada por el test");
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(tally.counts()).toEqual({ timedOut: 0, retried: 0 });
  });

  it("no toca las peticiones que no van a Supabase", async () => {
    const otherFetch = vi.fn(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    );
    const { guardedFetch } = guard(otherFetch);

    await guardedFetch("https://api.stripe.com/v1/prices", { method: "POST" });

    const init = otherFetch.mock.calls[0]?.at(1) as RequestInit | undefined;
    expect(init?.signal).toBeUndefined();
  });

  it("cuenta las peticiones abortadas por tiempo y las reintentadas", async () => {
    const baseFetch = scriptedFetch(["hang", "answer", "hang"]);
    const { guardedFetch, tally } = guard(baseFetch);

    await guardedFetch(READ_URL);
    await guardedFetch(WRITE_URL, { method: "POST" }).catch(() => undefined);

    expect(tally.counts()).toEqual({ timedOut: 2, retried: 1 });
  });
});

describe("el resumen de la corrida", () => {
  it("suma lo que contó cada archivo", () => {
    const summary = describeFetchTimeoutSummary([
      { timedOut: 2, retried: 1 },
      { timedOut: 1, retried: 1 },
    ]);

    expect(summary).toBe(
      "Peticiones a Supabase dev abortadas por tiempo: 3; reintentadas: 2.",
    );
  });

  it("dice también cuando no se abortó ninguna", () => {
    const summary = describeFetchTimeoutSummary([{ timedOut: 0, retried: 0 }]);

    expect(summary).toBe(
      "Peticiones a Supabase dev abortadas por tiempo: 0; reintentadas: 0.",
    );
  });

  it("no dice nada si no corrió ningún archivo de integración", () => {
    expect(describeFetchTimeoutSummary([])).toBeNull();
  });
});

describe("el plazo de un test de integración", () => {
  it("cubre una lectura colgada en todos sus intentos, con sus esperas", () => {
    const attempts = SUPABASE_RETRY_DELAYS_MS.length + 1;

    expect(SUPABASE_FETCH_WORST_CASE_MS).toBe(
      SUPABASE_RETRY_BUDGET_MS + SUPABASE_FETCH_TIMEOUT_MS * attempts,
    );
    expect(RLS_NETWORK_TEST_TIMEOUT_MS).toBeGreaterThan(
      SUPABASE_FETCH_WORST_CASE_MS,
    );
  });
});
