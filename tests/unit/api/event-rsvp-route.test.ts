import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_RSVP_API_PATH } from "@/lib/auth/routes";
import {
  CLUB_EVENT_ID,
  type FakeRsvpClub,
  type FakeRsvpClubOptions,
  RSVP_CALLER_ID,
  RSVP_NOW,
  UPCOMING_EVENT,
  fakeRsvpClub,
} from "../helpers/event-rsvp-club";

/**
 * El endpoint de RSVP (#308, RF-5 del PRD de E7). Qué decide cada caso lo
 * prueba el dominio; aquí se prueba que cada uno sale con su código de la
 * convención: 200, 400, 401, 404 y 422.
 */

const ORIGIN = "http://localhost:3417";

let club: FakeRsvpClub;

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

function mockWiring(options: FakeRsvpClubOptions = {}): void {
  club = fakeRsvpClub(options);
  vi.doMock("@/lib/events/supabase-event-rsvp-gateways", () => ({
    createSupabaseEventRsvpGateways: () => ({
      kind: "ready",
      gateways: club.gateways,
    }),
  }));
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => RSVP_CALLER_ID,
  }));
}

function mockAnonymousCaller(): void {
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => null,
  }));
}

async function respond(
  body: unknown,
  eventId: string = CLUB_EVENT_ID,
): Promise<Response> {
  const { PUT } = await import("@/app/api/v1/events/[id]/rsvp/route");
  return PUT(
    new NextRequest(
      new URL(EVENT_RSVP_API_PATH.replace("[id]", eventId), ORIGIN),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
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
  vi.useFakeTimers({ now: RSVP_NOW, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/events/supabase-event-rsvp-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("endpoint de RSVP", () => {
  it("responde 200 con la respuesta guardada y la hora del servidor", async () => {
    mockWiring();

    const response = await respond({ response: "maybe" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        eventId: CLUB_EVENT_ID,
        response: "maybe",
        respondedAt: RSVP_NOW.toISOString(),
      },
    });
    expect(club.saved.size).toBe(1);
  });

  it("responde 400 a una respuesta fuera de yes, maybe y no", async () => {
    mockWiring();

    const response = await respond({ response: "attending" });

    await expectError(response, 400, { code: "validation_error" });
    expect(club.saved.size).toBe(0);
  });

  it("responde 401 sin sesión", async () => {
    mockAnonymousCaller();

    const response = await respond({ response: "yes" });

    await expectError(response, 401, { code: "unauthenticated" });
  });

  it("responde 404 a un id que no es un uuid", async () => {
    mockWiring();

    const response = await respond({ response: "yes" }, "no-es-un-id");

    await expectError(response, 404, { code: "not_found" });
  });

  it("responde 404 a quien está fuera de la audiencia", async () => {
    mockWiring({
      callerRole: "Admin",
      events: [
        {
          ...UPCOMING_EVENT,
          audience: { kind: "groups", groupIds: ["otro-grupo"] },
        },
      ],
    });

    const response = await respond({ response: "yes" });

    await expectError(response, 404, { code: "not_found" });
  });

  it("responde 422 cuando el evento ya empezó", async () => {
    mockWiring({ events: [{ ...UPCOMING_EVENT, startsAt: RSVP_NOW }] });

    const response = await respond({ response: "yes" });

    await expectError(response, 422, {
      code: "business_rule",
      reason: "rsvp_event_started",
    });
  });

  it("responde 422 a un evento cancelado", async () => {
    mockWiring({ events: [{ ...UPCOMING_EVENT, status: "cancelled" }] });

    const response = await respond({ response: "yes" });

    await expectError(response, 422, {
      code: "business_rule",
      reason: "rsvp_event_cancelled",
    });
  });
});
