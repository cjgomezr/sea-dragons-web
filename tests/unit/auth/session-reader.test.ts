import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthSessionMissingError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_CACHE_TTL_MS,
  type SessionCache,
  createSessionCache,
} from "@/lib/auth/session-cache";
import { readSessionState, readSessionUserId } from "@/lib/auth/session-reader";

/**
 * Quién está pidiendo, visto desde el servidor: si hay sesión de verdad y, si
 * la hay, si esa cuenta puede operar o todavía le falta algo (FR-083).
 */

const USER_ID = "0f5c2f4e-1b8e-4d2a-9a5e-4f2b0c8d1a33";
const EMAIL = "nerea@example.test";

/** La identidad que devuelve Supabase para una sesión válida. Lleva correo
 * porque toda cuenta de este proyecto nace de un registro con correo. */
const USER = { id: USER_ID, email: EMAIL } as const;

type MemberRow = {
  readonly account_status: string;
  readonly role: string;
} | null;

const NOW_MS = Date.UTC(2026, 8, 30, 9, 0, 0);
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;

/** Un token con la forma de un JWT que caduca cuando se pide. */
function accessTokenExpiringAt(expiresAtMs: number): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ sub: USER_ID, exp: Math.floor(expiresAtMs / 1000) })}.firma`;
}

const ACCESS_TOKEN = accessTokenExpiringAt(NOW_MS + TOKEN_LIFETIME_MS);

type FakeSupabase = {
  readonly client: SupabaseClient;
  /** Cada consulta que se hizo, con la tabla y las columnas que pidió. */
  readonly queries: { readonly table: string; readonly columns: string }[];
  /** Cuántas veces se le preguntó al servidor de autenticación. */
  readonly getUserCalls: () => number;
};

/** Un doble con la forma que usa `readSessionState`: `auth.getSession()` para
 * leer el token de la cookie, `auth.getUser()` y una consulta a `members` que
 * termina en `maybeSingle()`. La fila se lee en cada consulta, así que un test
 * puede cambiarla entre dos peticiones. Sin `accessToken` hay cookie de sesión
 * con un token vivo; con `null`, no llegó ninguna. */
function fakeSupabase(options: {
  readonly user: { readonly id: string; readonly email?: string } | null;
  readonly accessToken?: string | null;
  readonly sessionError?: Error;
  readonly authError?: Error;
  readonly member?: MemberRow | (() => MemberRow);
  readonly memberError?: { readonly message: string };
}): FakeSupabase {
  const queries: { table: string; columns: string }[] = [];
  let getUserCount = 0;
  const readMember = (): MemberRow =>
    typeof options.member === "function"
      ? options.member()
      : (options.member ?? null);
  const accessToken =
    options.accessToken === undefined ? ACCESS_TOKEN : options.accessToken;
  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session: accessToken === null ? null : { access_token: accessToken },
        },
        error: options.sessionError ?? null,
      }),
      getUser: async () => {
        getUserCount += 1;
        return {
          data: { user: options.user },
          error: options.authError ?? null,
        };
      },
    },
    from: (table: string) => ({
      select: (columns: string) => {
        queries.push({ table, columns });
        return {
          eq: () => ({
            maybeSingle: async () => ({
              data: readMember(),
              error: options.memberError ?? null,
            }),
          }),
        };
      },
    }),
  } as unknown as SupabaseClient;
  return { client, queries, getUserCalls: () => getUserCount };
}

/** El reloj de la memoria, que cada test adelanta a mano. */
let clock: { now: number };
let cache: SessionCache;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  clock = { now: NOW_MS };
  cache = createSessionCache({ now: () => clock.now });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("estado de sesión", () => {
  it("es anónimo cuando no llega ninguna cookie de sesión", async () => {
    const { client } = fakeSupabase({
      user: null,
      accessToken: null,
      authError: new AuthSessionMissingError(),
    });

    await expect(readSessionState(client, cache)).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("no ensucia los registros con la visita anónima, que es el caso normal", async () => {
    const { client } = fakeSupabase({
      user: null,
      accessToken: null,
      authError: new AuthSessionMissingError(),
    });

    await readSessionState(client, cache);

    expect(console.error).not.toHaveBeenCalled();
  });

  it("es anónimo, y deja rastro, cuando el servicio de autenticación falla", async () => {
    const { client } = fakeSupabase({
      user: null,
      authError: new Error("Supabase no responde"),
    });

    await expect(readSessionState(client, cache)).resolves.toEqual({
      kind: "anonymous",
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("es activo cuando la fila de miembro lo dice", async () => {
    const { client } = fakeSupabase({
      user: USER,
      member: { account_status: "active", role: "Player" },
    });

    await expect(readSessionState(client, cache)).resolves.toEqual({
      kind: "active",
      role: "Player",
    });
  });

  it("es incompleto cuando la fila de miembro lo dice", async () => {
    const { client } = fakeSupabase({
      user: USER,
      member: { account_status: "incomplete", role: "Player" },
    });

    await expect(readSessionState(client, cache)).resolves.toEqual({
      kind: "incomplete",
    });
  });

  it("trata como anónima la sesión de una cuenta dada de baja", async () => {
    const { client } = fakeSupabase({
      user: USER,
      member: { account_status: "inactive", role: "Player" },
    });

    await expect(readSessionState(client, cache)).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("trata como anónima la sesión de una identidad sin fila de miembro", async () => {
    const { client } = fakeSupabase({ user: USER, member: null });

    await expect(readSessionState(client, cache)).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("trata como anónima una identidad sin correo, que aquí no puede existir", async () => {
    const { client } = fakeSupabase({
      user: { id: USER_ID },
      member: { account_status: "active", role: "Player" },
    });

    await expect(readSessionState(client, cache)).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("cierra la frontera, y deja rastro, cuando la base no contesta", async () => {
    const { client } = fakeSupabase({
      user: USER,
      memberError: { message: "connection refused" },
    });

    await expect(readSessionState(client, cache)).resolves.toEqual({
      kind: "anonymous",
    });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("lectura del rol", () => {
  it("lleva el rol de la fila en una cuenta activa", async () => {
    const { client } = fakeSupabase({
      user: USER,
      member: { account_status: "active", role: "Coach" },
    });

    await expect(readSessionState(client, cache)).resolves.toEqual({
      kind: "active",
      role: "Coach",
    });
  });

  it("cierra la frontera, y deja rastro, cuando el rol no está en el catálogo", async () => {
    const { client } = fakeSupabase({
      user: USER,
      member: { account_status: "active", role: "admin" },
    });

    await expect(readSessionState(client, cache)).resolves.toEqual({
      kind: "anonymous",
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("lee el estado de la cuenta y el rol en una sola consulta a members", async () => {
    const { client, queries } = fakeSupabase({
      user: USER,
      member: { account_status: "active", role: "Coach" },
    });

    await readSessionState(client, cache);

    expect(queries).toHaveLength(1);
    expect(queries[0]?.table).toBe("members");
    expect(queries[0]?.columns).toContain("account_status");
    expect(queries[0]?.columns).toContain("role");
  });

  it("aplica en la siguiente petición el rol que un Admin acaba de cambiar", async () => {
    let row: MemberRow = { account_status: "active", role: "Coach" };
    const { client } = fakeSupabase({ user: USER, member: () => row });
    await readSessionState(client, cache);

    row = { account_status: "active", role: "Player" };
    cache.forgetMember(USER_ID);

    await expect(readSessionState(client, cache)).resolves.toEqual({
      kind: "active",
      role: "Player",
    });
  });

  it("aplica a los 30 segundos un rol cambiado en otro servidor, que no pudo olvidarlo aquí", async () => {
    let row: MemberRow = { account_status: "active", role: "Coach" };
    const { client } = fakeSupabase({ user: USER, member: () => row });
    await readSessionState(client, cache);
    row = { account_status: "active", role: "Player" };

    const withinWindow = await readSessionState(client, cache);
    clock.now += SESSION_CACHE_TTL_MS;
    const afterWindow = await readSessionState(client, cache);

    expect(withinWindow).toEqual({ kind: "active", role: "Coach" });
    expect(afterWindow).toEqual({ kind: "active", role: "Player" });
  });
});

describe("memoria entre peticiones", () => {
  it("dos peticiones seguidas con el mismo token viajan una sola vez a Supabase", async () => {
    const { client, queries, getUserCalls } = fakeSupabase({
      user: USER,
      member: { account_status: "active", role: "Player" },
    });

    const first = await readSessionState(client, cache);
    const second = await readSessionState(client, cache);

    expect(second).toEqual(first);
    expect(getUserCalls()).toBe(1);
    expect(queries).toHaveLength(1);
  });

  it("guarda también la cuenta incompleta, que es un estado con sesión", async () => {
    const { client, getUserCalls } = fakeSupabase({
      user: USER,
      member: { account_status: "incomplete", role: "Player" },
    });

    await readSessionState(client, cache);
    await readSessionState(client, cache);

    expect(getUserCalls()).toBe(1);
  });

  it("vuelve a preguntar cuando el estado guardado pasa de 30 segundos", async () => {
    const { client, queries, getUserCalls } = fakeSupabase({
      user: USER,
      member: { account_status: "active", role: "Player" },
    });
    await readSessionState(client, cache);

    clock.now += SESSION_CACHE_TTL_MS;
    await readSessionState(client, cache);

    expect(getUserCalls()).toBe(2);
    expect(queries).toHaveLength(2);
  });

  it("no sirve desde memoria un token que caducó dentro de los 30 segundos", async () => {
    const { client, getUserCalls } = fakeSupabase({
      user: USER,
      accessToken: accessTokenExpiringAt(NOW_MS + 5_000),
      member: { account_status: "active", role: "Player" },
    });
    await readSessionState(client, cache);

    clock.now += 5_000;
    await readSessionState(client, cache);

    expect(getUserCalls()).toBe(2);
  });

  it("no pregunta a nadie cuando no llega ninguna cookie de sesión", async () => {
    const { client, queries, getUserCalls } = fakeSupabase({
      user: null,
      accessToken: null,
    });

    await readSessionState(client, cache);

    expect(getUserCalls()).toBe(0);
    expect(queries).toHaveLength(0);
  });

  it("no guarda un token que Supabase rechaza: la siguiente petición vuelve a preguntar", async () => {
    const { client, getUserCalls } = fakeSupabase({
      user: null,
      authError: new Error("invalid JWT"),
    });

    await readSessionState(client, cache);
    await readSessionState(client, cache);

    expect(getUserCalls()).toBe(2);
  });

  it("no guarda la sesión de una baja: la siguiente petición vuelve a preguntar", async () => {
    const { client, getUserCalls } = fakeSupabase({
      user: USER,
      member: { account_status: "inactive", role: "Player" },
    });

    await readSessionState(client, cache);
    await readSessionState(client, cache);

    expect(getUserCalls()).toBe(2);
  });

  it("no guarda una avería de la base: la siguiente petición vuelve a preguntar", async () => {
    const { client, queries } = fakeSupabase({
      user: USER,
      memberError: { message: "connection refused" },
    });

    await readSessionState(client, cache);
    await readSessionState(client, cache);

    expect(queries).toHaveLength(2);
  });

  it("una avería no alarga la vida de un estado guardado más allá de sus 30 segundos", async () => {
    const healthy = fakeSupabase({
      user: USER,
      member: { account_status: "active", role: "Player" },
    });
    await readSessionState(healthy.client, cache);
    const broken = fakeSupabase({
      user: USER,
      memberError: { message: "connection refused" },
    });

    clock.now += SESSION_CACHE_TTL_MS;

    await expect(readSessionState(broken.client, cache)).resolves.toEqual({
      kind: "anonymous",
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("es anónimo, y deja rastro, cuando no se puede refrescar un token caducado", async () => {
    const { client, getUserCalls } = fakeSupabase({
      user: null,
      accessToken: null,
      sessionError: new Error("Supabase no responde"),
    });

    await expect(readSessionState(client, cache)).resolves.toEqual({
      kind: "anonymous",
    });
    expect(console.error).toHaveBeenCalled();
    expect(getUserCalls()).toBe(0);
  });
});

// #427: la cáscara lee quién mira para la búsqueda global, y no puede costar
// otro viaje a Supabase en cada pantalla (#434).
describe("id de quien tiene la sesión", () => {
  it("lo saca de la memoria tras leer el estado, sin volver a preguntar", async () => {
    const { client, getUserCalls } = fakeSupabase({
      user: USER,
      member: { account_status: "active", role: "Player" },
    });
    await readSessionState(client, cache);

    const userId = await readSessionUserId(client, cache);

    expect(userId).toBe(USER.id);
    expect(getUserCalls()).toBe(1);
  });

  it("lo pregunta al servidor de autenticación si la memoria no lo tiene", async () => {
    const { client, getUserCalls } = fakeSupabase({ user: USER });

    const userId = await readSessionUserId(client, cache);

    expect(userId).toBe(USER.id);
    expect(getUserCalls()).toBe(1);
  });

  it("es nulo, sin preguntar a nadie, cuando no llega ninguna cookie", async () => {
    const { client, getUserCalls } = fakeSupabase({
      user: USER,
      accessToken: null,
    });

    expect(await readSessionUserId(client, cache)).toBeNull();
    expect(getUserCalls()).toBe(0);
  });
});
