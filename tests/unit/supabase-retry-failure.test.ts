import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { RLS_NETWORK_TEST_TIMEOUT_MS } from "../support/rls";
import {
  createConfirmedUser,
  describeSupabaseFailure,
  SUPABASE_RETRY_BUDGET_MS,
  type AuthAdmin,
} from "../support/supabase-retry";

const OPERATION = "borrar el socio de prueba";

function noWait() {
  return vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
}

describe("fallo de Supabase reducido a un mensaje", () => {
  it("devuelve null cuando la llamada contesta bien", async () => {
    const call = vi.fn().mockResolvedValue({ data: {}, error: null });

    const failure = await describeSupabaseFailure(OPERATION, call, noWait());

    expect(failure).toBeNull();
  });

  it("devuelve el mensaje del error que Supabase devolvió", async () => {
    const call = vi.fn().mockResolvedValue({
      data: null,
      error: new AuthApiError("User not allowed", 403, "not_admin"),
    });

    const failure = await describeSupabaseFailure(OPERATION, call, noWait());

    expect(failure).toBe("User not allowed");
  });

  it("devuelve el mensaje en vez de lanzar cuando se agotan los intentos", async () => {
    const call = vi.fn().mockResolvedValue({
      data: null,
      error: new AuthRetryableFetchError("Gateway Timeout", 504),
    });

    const failure = await describeSupabaseFailure(OPERATION, call, noWait());

    expect(failure).toBe(
      "Supabase dev no contestó a borrar el socio de prueba tras 4 intentos (último: 504 Gateway Timeout)",
    );
  });

  it("devuelve el mensaje en vez de lanzar cuando la operación lanza", async () => {
    const call = vi.fn().mockRejectedValue(new Error("se rompió"));

    const failure = await describeSupabaseFailure(OPERATION, call, noWait());

    expect(failure).toBe("se rompió");
  });
});

describe("reintentos anidados", () => {
  it("un reintento agotado dentro de la operación no se vuelve a reintentar desde fuera", async () => {
    const createUser = vi
      .fn()
      .mockResolvedValueOnce({
        data: { user: null },
        error: new AuthRetryableFetchError("Gateway Timeout", 504),
      })
      .mockResolvedValueOnce({
        data: { user: null },
        error: new AuthApiError("already registered", 422, "email_exists"),
      });
    const listUsers = vi.fn().mockResolvedValue({
      data: { users: [] },
      error: new AuthRetryableFetchError("fetch failed", 0),
    });
    const admin = { createUser, listUsers } as unknown as AuthAdmin;

    await expect(
      createConfirmedUser(
        admin,
        {
          email: "e2e-1@example.test",
          password: "secret",
          operation: "crear el socio de prueba",
        },
        noWait(),
      ),
    ).rejects.toThrow(
      /buscar el usuario de prueba por su correo tras 4 intentos/,
    );

    expect(createUser).toHaveBeenCalledTimes(2);
    expect(listUsers).toHaveBeenCalledTimes(4);
  });
});

describe("plazo de los tests con red", () => {
  it("el presupuesto de reintento es la suma de las esperas", () => {
    expect(SUPABASE_RETRY_BUDGET_MS).toBe(17_000);
  });

  it("un test con red deja sitio para que un reintento complete sus esperas", () => {
    expect(RLS_NETWORK_TEST_TIMEOUT_MS).toBeGreaterThan(
      SUPABASE_RETRY_BUDGET_MS * 2,
    );
  });
});
