import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthSessionMissingError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSessionState } from "@/lib/auth/session-reader";

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

type FakeSupabase = {
  readonly client: SupabaseClient;
  /** Cada consulta que se hizo, con la tabla y las columnas que pidió. */
  readonly queries: { readonly table: string; readonly columns: string }[];
};

/** Un doble con la forma que usa `readSessionState`: `auth.getUser()` y una
 * consulta a `members` que termina en `maybeSingle()`. La fila se lee en cada
 * consulta, así que un test puede cambiarla entre dos peticiones. */
function fakeSupabase(options: {
  readonly user: { readonly id: string; readonly email?: string } | null;
  readonly authError?: Error;
  readonly member?: MemberRow | (() => MemberRow);
  readonly memberError?: { readonly message: string };
}): FakeSupabase {
  const queries: { table: string; columns: string }[] = [];
  const readMember = (): MemberRow =>
    typeof options.member === "function"
      ? options.member()
      : (options.member ?? null);
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: options.user },
        error: options.authError ?? null,
      }),
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
  return { client, queries };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("estado de sesión", () => {
  it("es anónimo cuando no llega ninguna cookie de sesión", async () => {
    const { client } = fakeSupabase({
      user: null,
      authError: new AuthSessionMissingError(),
    });

    await expect(readSessionState(client)).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("no ensucia los registros con la visita anónima, que es el caso normal", async () => {
    const { client } = fakeSupabase({
      user: null,
      authError: new AuthSessionMissingError(),
    });

    await readSessionState(client);

    expect(console.error).not.toHaveBeenCalled();
  });

  it("es anónimo, y deja rastro, cuando el servicio de autenticación falla", async () => {
    const { client } = fakeSupabase({
      user: null,
      authError: new Error("Supabase no responde"),
    });

    await expect(readSessionState(client)).resolves.toEqual({
      kind: "anonymous",
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("es activo cuando la fila de miembro lo dice", async () => {
    const { client } = fakeSupabase({
      user: USER,
      member: { account_status: "active", role: "Player" },
    });

    await expect(readSessionState(client)).resolves.toEqual({
      kind: "active",
      role: "Player",
    });
  });

  it("es incompleto cuando la fila de miembro lo dice", async () => {
    const { client } = fakeSupabase({
      user: USER,
      member: { account_status: "incomplete", role: "Player" },
    });

    await expect(readSessionState(client)).resolves.toEqual({
      kind: "incomplete",
    });
  });

  it("trata como anónima la sesión de una cuenta dada de baja", async () => {
    const { client } = fakeSupabase({
      user: USER,
      member: { account_status: "inactive", role: "Player" },
    });

    await expect(readSessionState(client)).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("trata como anónima la sesión de una identidad sin fila de miembro", async () => {
    const { client } = fakeSupabase({ user: USER, member: null });

    await expect(readSessionState(client)).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("trata como anónima una identidad sin correo, que aquí no puede existir", async () => {
    const { client } = fakeSupabase({
      user: { id: USER_ID },
      member: { account_status: "active", role: "Player" },
    });

    await expect(readSessionState(client)).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("cierra la frontera, y deja rastro, cuando la base no contesta", async () => {
    const { client } = fakeSupabase({
      user: USER,
      memberError: { message: "connection refused" },
    });

    await expect(readSessionState(client)).resolves.toEqual({
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

    await expect(readSessionState(client)).resolves.toEqual({
      kind: "active",
      role: "Coach",
    });
  });

  it("cierra la frontera, y deja rastro, cuando el rol no está en el catálogo", async () => {
    const { client } = fakeSupabase({
      user: USER,
      member: { account_status: "active", role: "admin" },
    });

    await expect(readSessionState(client)).resolves.toEqual({
      kind: "anonymous",
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("lee el estado de la cuenta y el rol en una sola consulta a members", async () => {
    const { client, queries } = fakeSupabase({
      user: USER,
      member: { account_status: "active", role: "Coach" },
    });

    await readSessionState(client);

    expect(queries).toHaveLength(1);
    expect(queries[0]?.table).toBe("members");
    expect(queries[0]?.columns).toContain("account_status");
    expect(queries[0]?.columns).toContain("role");
  });

  it("aplica en la siguiente petición el rol que un Admin acaba de cambiar", async () => {
    let row: MemberRow = { account_status: "active", role: "Coach" };
    const { client } = fakeSupabase({ user: USER, member: () => row });
    await readSessionState(client);

    row = { account_status: "active", role: "Player" };

    await expect(readSessionState(client)).resolves.toEqual({
      kind: "active",
      role: "Player",
    });
  });
});
