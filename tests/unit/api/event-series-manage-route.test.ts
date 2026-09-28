import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_SERIES_MANAGE_API_PATH } from "@/lib/auth/routes";
import {
  CALLER_ID,
  type FakeManagedSeriesClub,
  type FakeManagedSeriesClubOptions,
  MISSING_SERIES_ID,
  NOW,
  SERIES,
  SERIES_ID,
  SPENT_SERIES_ID,
  fakeManagedSeriesClub,
} from "../helpers/managed-series-club";

/**
 * Los endpoints de editar y cancelar una serie (#315, RF-12 del PRD de E7).
 * Qué decide cada caso lo prueba el dominio; aquí se prueba que cada uno
 * sale con su código de la convención: 200, 400, 401, 403, 404 y 422.
 */

const ORIGIN = "http://localhost:3417";

let club: FakeManagedSeriesClub;

function mockSessionClient(): void {
  vi.doMock("@/lib/supabase/session-client", () => ({
    readIncomingCookies: () => [],
    applySessionCookies: () => undefined,
    createSessionClient: () => ({
      kind: "ready",
      client: {},
      recorder: { recorded: () => ({ cookies: [], headers: {} }) },
    }),
  }));
}

function mockWiring(options: FakeManagedSeriesClubOptions = {}): void {
  club = fakeManagedSeriesClub(options);
  vi.doMock("@/lib/events/supabase-series-management-gateways", () => ({
    createSupabaseSeriesManagementGateways: () => ({
      kind: "ready",
      gateways: club.gateways,
    }),
  }));
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => CALLER_ID,
  }));
}

function mockAnonymousCaller(): void {
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => null,
  }));
}

function seriesUrl(seriesId: string, suffix = ""): URL {
  return new URL(
    `${EVENT_SERIES_MANAGE_API_PATH.replace("[id]", seriesId)}${suffix}`,
    ORIGIN,
  );
}

async function editSeries(seriesId: string, body: unknown): Promise<Response> {
  const { PATCH } =
    await import("@/app/api/v1/events/manage/series/[id]/route");
  return PATCH(
    new NextRequest(seriesUrl(seriesId), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: seriesId }) },
  );
}

async function cancelSeries(seriesId: string): Promise<Response> {
  const { POST } =
    await import("@/app/api/v1/events/manage/series/[id]/cancellation/route");
  return POST(
    new NextRequest(seriesUrl(seriesId, "/cancellation"), { method: "POST" }),
    { params: Promise.resolve({ id: seriesId }) },
  );
}

async function expectError(
  response: Response,
  status: number,
  error: { readonly code: string; readonly reason?: string },
): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error });
}

const NEW_PLACE = { location: "Aquatic Centre" } as const;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/events/supabase-series-management-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("endpoint de editar una serie", () => {
  it("responde 200 con la serie editada y cuántas ocurrencias cambiaron", async () => {
    mockWiring();

    const response = await editSeries(SERIES_ID, {
      ...NEW_PLACE,
      startTime: "20:00",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        series: { ...SERIES, ...NEW_PLACE, startTime: "20:00" },
        updatedOccurrences: 2,
      },
    });
  });

  it("responde 400 a un cuerpo sin ningún cambio", async () => {
    mockWiring();

    const response = await editSeries(SERIES_ID, {});

    await expectError(response, 400, { code: "validation_error" });
  });

  it.each([
    ["los días", { weekdays: [1, 3] }],
    ["la fecha de inicio", { startsOn: "2027-07-01" }],
    ["la fecha de fin", { endsOn: "2027-08-31" }],
  ])("responde 400 a un cambio de %s, sin escribir nada", async (_, body) => {
    mockWiring();

    const response = await editSeries(SERIES_ID, { ...NEW_PLACE, ...body });

    await expectError(response, 400, { code: "validation_error" });
    expect(club.writeCount()).toBe(0);
  });

  it("responde 401 a quien no ha iniciado sesión", async () => {
    mockAnonymousCaller();

    const response = await editSeries(SERIES_ID, NEW_PLACE);

    await expectError(response, 401, { code: "unauthenticated" });
  });

  it("responde 403 a un Coach", async () => {
    mockWiring({ callerRole: "Coach" });

    const response = await editSeries(SERIES_ID, NEW_PLACE);

    await expectError(response, 403, { code: "forbidden" });
  });

  it("responde 404 a una serie que no existe", async () => {
    mockWiring();

    const response = await editSeries(MISSING_SERIES_ID, NEW_PLACE);

    await expectError(response, 404, { code: "not_found" });
  });

  it("responde 404 a un id que no es uuid", async () => {
    mockWiring();

    const response = await editSeries("no-es-un-id", NEW_PLACE);

    await expectError(response, 404, { code: "not_found" });
  });

  it("responde 422 a una serie sin ocurrencias futuras", async () => {
    mockWiring();

    const response = await editSeries(SPENT_SERIES_ID, NEW_PLACE);

    await expectError(response, 422, {
      code: "business_rule",
      reason: "series_without_upcoming",
    });
  });
});

describe("endpoint de cancelar una serie", () => {
  it("responde 200 con la hora y cuántas ocurrencias canceló", async () => {
    mockWiring({ callerRole: "Admin" });

    const response = await cancelSeries(SERIES_ID);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        seriesId: SERIES_ID,
        cancelledAt: NOW.toISOString(),
        cancelledOccurrences: 2,
      },
    });
  });

  it("responde 401 a quien no ha iniciado sesión", async () => {
    mockAnonymousCaller();

    const response = await cancelSeries(SERIES_ID);

    await expectError(response, 401, { code: "unauthenticated" });
  });

  it("responde 403 a un Player", async () => {
    mockWiring({ callerRole: "Player" });

    const response = await cancelSeries(SERIES_ID);

    await expectError(response, 403, { code: "forbidden" });
  });

  it("responde 404 a una serie que no existe", async () => {
    mockWiring();

    const response = await cancelSeries(MISSING_SERIES_ID);

    await expectError(response, 404, { code: "not_found" });
  });

  it("responde 422 a una serie sin ocurrencias futuras", async () => {
    mockWiring();

    const response = await cancelSeries(SPENT_SERIES_ID);

    await expectError(response, 422, {
      code: "business_rule",
      reason: "series_without_upcoming",
    });
  });
});
