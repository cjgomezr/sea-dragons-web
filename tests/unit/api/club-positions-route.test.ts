import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLUB_POSITIONS_API_PATH } from "@/lib/auth/routes";
import {
  FORWARD,
  GOALKEEPER,
  asDirectoryPosition,
} from "../helpers/seeded-positions";

/**
 * Las posiciones que se pueden elegir en el club de quien llama (#299): el
 * desplegable del alta de un miembro, y el de la aplicación de Release 2
 * (CON-002). Lo alcanza cualquier cuenta activa.
 */

const ORIGIN = "http://localhost:3417";
const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";

const listPositionChoices = vi.fn();

function mockCaller(userId: string | null): void {
  vi.doMock("@/lib/supabase/session-client", () => ({
    readIncomingCookies: () => [],
    applySessionCookies: () => undefined,
    createSessionClient: () => ({
      kind: "ready",
      client: {},
      recorder: { recorded: () => ({ cookies: [], headers: {} }) },
    }),
  }));
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => userId,
  }));
  vi.doMock("@/lib/club/supabase-club-positions", () => ({
    createSupabasePositionChoicesGateways: () => ({
      kind: "ready",
      gateways: {},
    }),
  }));
  vi.doMock("@/lib/club/club-positions", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    listPositionChoices: (...args: unknown[]) => listPositionChoices(...args),
  }));
}

async function getPositions(): Promise<Response> {
  const { GET } = await import("@/app/api/v1/club/positions/route");
  return GET(new NextRequest(new URL(CLUB_POSITIONS_API_PATH, ORIGIN)));
}

beforeEach(() => {
  vi.resetModules();
  listPositionChoices.mockReset();
});

afterEach(() => {
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.doUnmock("@/lib/club/supabase-club-positions");
  vi.doUnmock("@/lib/club/club-positions");
});

describe("GET /api/v1/club/positions", () => {
  it("responde 200 con las posiciones que puede elegir el club de quien llama", async () => {
    mockCaller(CALLER_ID);
    listPositionChoices.mockResolvedValue([
      asDirectoryPosition(GOALKEEPER),
      asDirectoryPosition(FORWARD),
    ]);

    const response = await getPositions();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        positions: [
          asDirectoryPosition(GOALKEEPER),
          asDirectoryPosition(FORWARD),
        ],
      },
    });
    expect(listPositionChoices).toHaveBeenCalledWith(
      expect.anything(),
      CALLER_ID,
    );
  });

  it("responde 401 sin sesión", async () => {
    mockCaller(null);

    const response = await getPositions();

    expect(response.status).toBe(401);
    expect(listPositionChoices).not.toHaveBeenCalled();
  });

  it("responde 403 a una identidad sin fila de miembro", async () => {
    mockCaller(CALLER_ID);
    // La copia que cargará la ruta tras `resetModules`, o `instanceof` falla.
    const { MemberNotFoundError } = await import(
      "@/lib/auth/account-activation"
    );
    listPositionChoices.mockRejectedValue(new MemberNotFoundError(CALLER_ID));

    const response = await getPositions();

    expect(response.status).toBe(403);
  });
});
