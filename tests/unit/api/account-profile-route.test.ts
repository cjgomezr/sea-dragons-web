import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_PROFILE_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type { OwnProfile } from "@/lib/members/own-profile";

/**
 * El perfil propio por la API (#241, FR-084, AC-039). Cualquier cuenta activa
 * edita su propia ficha, siempre la que identifica la cookie. La petición
 * entra por el proxy y sólo llega al handler si la frontera la deja seguir,
 * como en producción.
 */

const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const ORIGIN = "http://localhost:3417";
/** Lo que hace Next con la respuesta del proxy: si es `NextResponse.next()`
 * la petición sigue hasta la ruta; si no, esa respuesta es la definitiva. */
const CONTINUE_HEADER = "x-middleware-next";

const VALID_BODY = {
  fullName: "Nerea Ruiz Soto",
  country: "ES",
  position: "Forward",
  experienceLevel: "Advanced",
  gender: "undisclosed",
} as const;

const readSessionState = vi.fn();
const readAuthenticatedUserId = vi.fn();
const updateOwnProfile = vi.fn();

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: (...args: unknown[]) =>
    readAuthenticatedUserId(...args),
}));

vi.mock("@/lib/members/supabase-own-profile-gateways", () => ({
  createSupabaseOwnProfileGateways: () => ({
    kind: "ready",
    gateways: {
      profiles: {
        findOwnProfile: async () => null,
        updateOwnProfile: (...args: unknown[]) => updateOwnProfile(...args),
      },
    },
  }),
}));

const { proxy } = await import("@/proxy");
const { PATCH, GET } = await import("@/app/api/v1/account/profile/route");

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

async function patchThroughBoundary(body: unknown): Promise<Response> {
  const request = new NextRequest(new URL(ACCOUNT_PROFILE_API_PATH, ORIGIN), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? PATCH(request)
    : boundaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  givenSession({ kind: "active", role: "Player" });
  readAuthenticatedUserId.mockResolvedValue(USER_ID);
  updateOwnProfile.mockImplementation(
    async (_userId: string, profile: OwnProfile) => profile,
  );
});

describe("PATCH /api/v1/account/profile", () => {
  it.each(["Admin", "Coach", "Committee", "Player"] as const)(
    "responde 200 con el perfil guardado a un %s",
    async (role) => {
      givenSession({ kind: "active", role });

      const response = await patchThroughBoundary(VALID_BODY);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: VALID_BODY });
    },
  );

  it("escribe sobre quien identifica la cookie", async () => {
    await patchThroughBoundary(VALID_BODY);

    expect(updateOwnProfile).toHaveBeenCalledWith(USER_ID, VALID_BODY);
  });

  it("acepta posición, nivel y género vaciados a propósito", async () => {
    const body = {
      ...VALID_BODY,
      position: null,
      experienceLevel: null,
      gender: null,
    };

    const response = await patchThroughBoundary(body);

    expect(response.status).toBe(200);
    expect(updateOwnProfile).toHaveBeenCalledWith(USER_ID, body);
  });

  it("responde 400 con el motivo a un nombre vacío", async () => {
    const response = await patchThroughBoundary({
      ...VALID_BODY,
      fullName: "   ",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error", reason: "full_name_missing" },
    });
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });

  it("responde 400 con el motivo a un nombre de más de 120 caracteres", async () => {
    const response = await patchThroughBoundary({
      ...VALID_BODY,
      fullName: "a".repeat(121),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error", reason: "full_name_too_long" },
    });
  });

  it.each([
    ["country", "XX"],
    ["position", "Striker"],
    ["experienceLevel", "expert"],
    ["gender", "other"],
  ])(
    "responde 400 sin tocar la base cuando %s no existe",
    async (field, value) => {
      const response = await patchThroughBoundary({
        ...VALID_BODY,
        [field]: value,
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_error" },
      });
      expect(updateOwnProfile).not.toHaveBeenCalled();
    },
  );

  it("responde 400 cuando falta un campo", async () => {
    const response = await patchThroughBoundary({
      ...VALID_BODY,
      gender: undefined,
    });

    expect(response.status).toBe(400);
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });

  it("responde 400 a un campo que no conoce", async () => {
    const response = await patchThroughBoundary({
      ...VALID_BODY,
      userId: "0f0e0d0c-0b0a-4908-8706-050403020100",
    });

    expect(response.status).toBe(400);
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });

  it.each([
    ["role", "Admin"],
    ["aufNumber", "AUF-123"],
    ["aufExpiry", "2030-01-01"],
    ["groups", ["Senior Squad"]],
    ["status", "active"],
  ])(
    "responde 403 y nombra el campo cuando intenta cambiar %s",
    async (field, value) => {
      const response = await patchThroughBoundary({
        ...VALID_BODY,
        [field]: value,
      });

      expect(response.status).toBe(403);
      const body: unknown = await response.json();
      expect(body).toMatchObject({
        error: { code: "forbidden", reason: "reserved_fields" },
      });
      expect(JSON.stringify(body)).toContain(field);
      expect(updateOwnProfile).not.toHaveBeenCalled();
    },
  );

  it("responde 401 sin sesión y no escribe nada", async () => {
    givenSession({ kind: "anonymous" });

    const response = await patchThroughBoundary(VALID_BODY);

    expect(response.status).toBe(401);
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });

  it("responde 403 a una cuenta incompleta y no escribe nada", async () => {
    givenSession({ kind: "incomplete" });

    const response = await patchThroughBoundary(VALID_BODY);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });

  it("responde 403 cuando la sesión no corresponde a ningún miembro", async () => {
    updateOwnProfile.mockResolvedValue(null);

    const response = await patchThroughBoundary(VALID_BODY);

    expect(response.status).toBe(403);
  });

  it("no atiende otros métodos", async () => {
    const response = await GET(
      new NextRequest(new URL(ACCOUNT_PROFILE_API_PATH, ORIGIN)),
    );

    expect(response.status).toBe(405);
  });
});
