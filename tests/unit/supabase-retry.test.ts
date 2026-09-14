import {
  AuthApiError,
  AuthRetryableFetchError,
  type User,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createConfirmedUser,
  SUPABASE_RETRY_DELAYS_MS,
  withSupabaseRetry,
  type AuthAdmin,
} from "../support/supabase-retry";

const OPERATION = "crear el usuario de prueba del arnés RLS";

function authFailure(error: Error): { data: null; error: Error } {
  return { data: null, error };
}

function gatewayFailure(status: number, statusText: string) {
  return authFailure(new AuthRetryableFetchError(statusText, status));
}

const SUCCESS = { data: { id: "ok" }, error: null };

function noWait() {
  return vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
}

describe("reintento de Supabase en el arnés", () => {
  it("devuelve el resultado cuando un 504 va seguido de un éxito, y llamó 2 veces", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(gatewayFailure(504, "Gateway Timeout"))
      .mockResolvedValueOnce(SUCCESS);

    const result = await withSupabaseRetry(OPERATION, call, noWait());

    expect(result).toBe(SUCCESS);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it.each([
    [502, "Bad Gateway"],
    [503, "Service Unavailable"],
  ])("reintenta un %i igual que un 504", async (status, statusText) => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(gatewayFailure(status, statusText))
      .mockResolvedValueOnce(SUCCESS);

    const result = await withSupabaseRetry(OPERATION, call, noWait());

    expect(result).toBe(SUCCESS);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("reintenta el estado 5xx que PostgREST pone en la respuesta", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "upstream timed out", code: "" },
        status: 504,
        statusText: "Gateway Timeout",
      })
      .mockResolvedValueOnce(SUCCESS);

    const result = await withSupabaseRetry(OPERATION, call, noWait());

    expect(result).toBe(SUCCESS);
  });

  it("reintenta un TypeError de red lanzado por la operación", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(SUCCESS);

    const result = await withSupabaseRetry(OPERATION, call, noWait());

    expect(result).toBe(SUCCESS);
  });

  it("reintenta un AuthRetryableFetchError de red, sin estado HTTP", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(
        authFailure(new AuthRetryableFetchError("fetch failed", 0)),
      )
      .mockResolvedValueOnce(SUCCESS);

    const result = await withSupabaseRetry(OPERATION, call, noWait());

    expect(result).toBe(SUCCESS);
  });

  it("reintenta la conexión cortada que PostgREST devuelve con estado 0", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "TypeError: fetch failed", code: "" },
        status: 0,
        statusText: "",
      })
      .mockResolvedValueOnce(SUCCESS);

    const result = await withSupabaseRetry(OPERATION, call, noWait());

    expect(result).toBe(SUCCESS);
  });

  it.each([400, 401, 403, 404, 409, 422])(
    "no reintenta un %i: una sola llamada y ninguna espera",
    async (status) => {
      const rejection = authFailure(new AuthApiError("rechazado", status, ""));
      const call = vi.fn().mockResolvedValue(rejection);
      const sleep = noWait();

      const result = await withSupabaseRetry(OPERATION, call, sleep);

      expect(result).toBe(rejection);
      expect(call).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it("con 5xx en todos los intentos hace 4 llamadas, espera 2, 5 y 10 segundos, y lanza con operación, intentos y último estado", async () => {
    const call = vi
      .fn()
      .mockResolvedValue(gatewayFailure(504, "Gateway Timeout"));
    const sleep = noWait();

    await expect(withSupabaseRetry(OPERATION, call, sleep)).rejects.toThrow(
      "Supabase dev no contestó a crear el usuario de prueba del arnés RLS tras 4 intentos (último: 504 Gateway Timeout)",
    );

    expect(call).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[2_000], [5_000], [10_000]]);
    expect(SUPABASE_RETRY_DELAYS_MS).toEqual([2_000, 5_000, 10_000]);
  });

  it("con éxito a la primera no llama a la espera", async () => {
    const call = vi.fn().mockResolvedValue(SUCCESS);
    const sleep = noWait();

    await withSupabaseRetry(OPERATION, call, sleep);

    expect(sleep).not.toHaveBeenCalled();
  });

  it("no reintenta un error sin estado que no sea de red", async () => {
    const bug = new Error("undefined is not a function");
    const call = vi.fn().mockRejectedValue(bug);
    const sleep = noWait();

    await expect(withSupabaseRetry(OPERATION, call, sleep)).rejects.toBe(bug);

    expect(call).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("crear usuario de prueba con reintento", () => {
  const credentials = {
    email: "rls-harness-1b2c@example.test",
    password: "secret",
  };
  const existingUser = { id: "user-1", email: credentials.email } as User;
  const emailExists = authFailure(
    new AuthApiError(
      "A user with this email address has already been registered",
      422,
      "email_exists",
    ),
  );

  function fakeAdmin(createUserResults: readonly unknown[]) {
    const createUser = vi.fn();
    for (const result of createUserResults) {
      createUser.mockResolvedValueOnce(result);
    }
    const listUsers = vi.fn().mockResolvedValue({
      data: {
        users: [{ id: "other", email: "otro@example.test" }, existingUser],
      },
      error: null,
    });
    return {
      createUser,
      listUsers,
      admin: { createUser, listUsers } as unknown as AuthAdmin,
    };
  }

  it("si el primer intento da 504 y el segundo dice que el correo ya existe, recupera el usuario existente por su correo", async () => {
    const { admin, createUser } = fakeAdmin([
      gatewayFailure(504, "Gateway Timeout"),
      emailExists,
    ]);

    const user = await createConfirmedUser(
      admin,
      { ...credentials, operation: OPERATION },
      noWait(),
    );

    expect(user).toEqual(existingUser);
    expect(createUser).toHaveBeenCalledTimes(2);
  });

  it("si el correo ya existe en el primer intento, sin un 5xx previo, falla", async () => {
    const { admin, listUsers } = fakeAdmin([emailExists]);

    await expect(
      createConfirmedUser(
        admin,
        { ...credentials, operation: OPERATION },
        noWait(),
      ),
    ).rejects.toThrow(
      "No se pudo crear el usuario de prueba del arnés RLS: A user with this email address has already been registered",
    );
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("devuelve el usuario creado cuando Supabase contesta a la primera", async () => {
    const created = { id: "nuevo", email: credentials.email } as User;
    const { admin } = fakeAdmin([{ data: { user: created }, error: null }]);

    const user = await createConfirmedUser(
      admin,
      { ...credentials, operation: OPERATION },
      noWait(),
    );

    expect(user).toBe(created);
  });
});
