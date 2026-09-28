import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_MANAGE_API_PATH } from "@/lib/auth/routes";
import {
  CALLER_ID,
  CANCELLED_EVENT_ID,
  type FakeManagedEventsClub,
  type FakeManagedEventsClubOptions,
  MISSING_EVENT_ID,
  NOW,
  PAST_EVENT_ID,
  SINGLE_EVENT,
  SINGLE_EVENT_ID,
  fakeManagedEventsClub,
} from "../helpers/managed-events-club";

/**
 * Los endpoints de editar y cancelar un evento o una ocurrencia (#314, RF-11
 * del PRD de E7). Qué decide cada caso lo prueba el dominio; aquí se prueba
 * que cada uno sale con su código de la convención: 200, 400, 401, 403, 404
 * y 422.
 */

const ORIGIN = "http://localhost:3417";

let club: FakeManagedEventsClub;

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

function mockWiring(options: FakeManagedEventsClubOptions = {}): void {
  club = fakeManagedEventsClub(options);
  vi.doMock("@/lib/events/supabase-event-management-gateways", () => ({
    createSupabaseEventManagementGateways: () => ({
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

function manageUrl(eventId: string, suffix = ""): URL {
  return new URL(
    `${EVENT_MANAGE_API_PATH.replace("[id]", eventId)}${suffix}`,
    ORIGIN,
  );
}

async function editEvent(eventId: string, body: unknown): Promise<Response> {
  const { PATCH } = await import("@/app/api/v1/events/manage/[id]/route");
  return PATCH(
    new NextRequest(manageUrl(eventId), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: eventId }) },
  );
}

async function cancelEvent(eventId: string): Promise<Response> {
  const { POST } =
    await import("@/app/api/v1/events/manage/[id]/cancellation/route");
  return POST(
    new NextRequest(manageUrl(eventId, "/cancellation"), { method: "POST" }),
    { params: Promise.resolve({ id: eventId }) },
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

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/events/supabase-event-management-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("endpoint de editar un evento", () => {
  it("responde 200 con el evento editado", async () => {
    mockWiring();

    const response = await editEvent(SINGLE_EVENT_ID, {
      location: "Aquatic Centre",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { ...SINGLE_EVENT, location: "Aquatic Centre" },
    });
  });

  it("responde 400 a un cuerpo sin ningún cambio", async () => {
    mockWiring();

    const response = await editEvent(SINGLE_EVENT_ID, {});

    await expectError(response, 400, { code: "validation_error" });
  });

  it("responde 400 a una fecha que no es fecha", async () => {
    mockWiring();

    const response = await editEvent(SINGLE_EVENT_ID, {
      startsOn: "mañana",
    });

    await expectError(response, 400, { code: "validation_error" });
  });

  it("responde 401 a quien no ha iniciado sesión", async () => {
    mockAnonymousCaller();

    const response = await editEvent(SINGLE_EVENT_ID, { location: "MSAC 2" });

    await expectError(response, 401, { code: "unauthenticated" });
  });

  it("responde 403 a un Player", async () => {
    mockWiring({ callerRole: "Player" });

    const response = await editEvent(SINGLE_EVENT_ID, { location: "MSAC 2" });

    await expectError(response, 403, { code: "forbidden" });
  });

  it("responde 404 a un evento que no existe", async () => {
    mockWiring();

    const response = await editEvent(MISSING_EVENT_ID, { location: "MSAC 2" });

    await expectError(response, 404, { code: "not_found" });
  });

  it("responde 404 a un id que no es uuid", async () => {
    mockWiring();

    const response = await editEvent("no-es-un-id", { location: "MSAC 2" });

    await expectError(response, 404, { code: "not_found" });
  });

  it("responde 422 a una fecha que ya pasó", async () => {
    mockWiring();

    const response = await editEvent(SINGLE_EVENT_ID, {
      startsOn: "2027-06-01",
    });

    await expectError(response, 422, {
      code: "business_rule",
      reason: "event_in_past",
    });
  });

  it("responde 422 a un evento que ya empezó", async () => {
    mockWiring();

    const response = await editEvent(PAST_EVENT_ID, { location: "MSAC 2" });

    await expectError(response, 422, {
      code: "business_rule",
      reason: "event_started",
    });
  });
});

describe("endpoint de cancelar un evento", () => {
  it("responde 200 con el evento cancelado y su hora", async () => {
    mockWiring({ callerRole: "Admin" });

    const response = await cancelEvent(SINGLE_EVENT_ID);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        ...SINGLE_EVENT,
        status: "cancelled",
        cancelledAt: NOW.toISOString(),
      },
    });
  });

  it("responde 401 a quien no ha iniciado sesión", async () => {
    mockAnonymousCaller();

    const response = await cancelEvent(SINGLE_EVENT_ID);

    await expectError(response, 401, { code: "unauthenticated" });
  });

  it("responde 403 a un Coach", async () => {
    mockWiring({ callerRole: "Coach" });

    const response = await cancelEvent(SINGLE_EVENT_ID);

    await expectError(response, 403, { code: "forbidden" });
  });

  it("responde 404 a un evento que no existe", async () => {
    mockWiring();

    const response = await cancelEvent(MISSING_EVENT_ID);

    await expectError(response, 404, { code: "not_found" });
  });

  it("responde 422 a un evento ya cancelado", async () => {
    mockWiring();

    const response = await cancelEvent(CANCELLED_EVENT_ID);

    await expectError(response, 422, {
      code: "business_rule",
      reason: "event_cancelled",
    });
  });
});
