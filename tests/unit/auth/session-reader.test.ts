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

type MemberRow = { readonly account_status: string } | null;

type FakeSupabase = {
  readonly client: SupabaseClient;
};

/** Un doble con la forma que usa `readSessionState`: `auth.getUser()` y una
 * consulta a `members` que termina en `maybeSingle()`. */
function fakeSupabase(options: {
  readonly user: { readonly id: string; readonly email?: string } | null;
  readonly authError?: Error;
  readonly member?: MemberRow;
  readonly memberError?: { readonly message: string };
}): FakeSupabase {
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: options.user },
        error: options.authError ?? null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: options.member ?? null,
            error: options.memberError ?? null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { client };
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

    await expect(readSessionState(client)).resolves.toBe("anonymous");
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

    await expect(readSessionState(client)).resolves.toBe("anonymous");
    expect(console.error).toHaveBeenCalled();
  });

  it("es activo cuando la fila de miembro lo dice", async () => {
    const { client } = fakeSupabase({
      user: USER,
      member: { account_status: "active" },
    });

    await expect(readSessionState(client)).resolves.toBe("active");
  });

  it("es incompleto cuando la fila de miembro lo dice", async () => {
    const { client } = fakeSupabase({
      user: USER,
      member: { account_status: "incomplete" },
    });

    await expect(readSessionState(client)).resolves.toBe("incomplete");
  });

  it("trata como anónima la sesión de una cuenta dada de baja", async () => {
    const { client } = fakeSupabase({
      user: USER,
      member: { account_status: "inactive" },
    });

    await expect(readSessionState(client)).resolves.toBe("anonymous");
  });

  it("trata como anónima la sesión de una identidad sin fila de miembro", async () => {
    const { client } = fakeSupabase({ user: USER, member: null });

    await expect(readSessionState(client)).resolves.toBe("anonymous");
  });

  it("trata como anónima una identidad sin correo, que aquí no puede existir", async () => {
    const { client } = fakeSupabase({
      user: { id: USER_ID },
      member: { account_status: "active" },
    });

    await expect(readSessionState(client)).resolves.toBe("anonymous");
  });

  it("cierra la frontera, y deja rastro, cuando la base no contesta", async () => {
    const { client } = fakeSupabase({
      user: USER,
      memberError: { message: "connection refused" },
    });

    await expect(readSessionState(client)).resolves.toBe("anonymous");
    expect(console.error).toHaveBeenCalled();
  });
});
