import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS_API_PATH, EVENT_API_PATH } from "@/lib/auth/routes";
import {
  AGENDA_CALLER_ID,
  AGENDA_NOW,
  type FakeAgendaClubOptions,
  MASTERS_SQUAD,
  clubEvent,
  fakeAgendaClub,
  seniorSquadEvent,
} from "../helpers/event-agenda-club";

/**
 * Los endpoints de la agenda y del detalle (#309, RF-4, RF-6 y RF-7 del PRD
 * de E7). Qué ve cada rol lo prueba el dominio; aquí se prueba que cada caso
 * sale con su código de la convención: 200, 400, 401 y 404.
 */

const ORIGIN = "http://localhost:3417";

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

function mockWiring(options: FakeAgendaClubOptions = {}): void {
  const club = fakeAgendaClub(options);
  vi.doMock("@/lib/events/supabase-event-agenda-gateways", () => ({
    createSupabaseEventAgendaGateways: () => ({
      kind: "ready",
      gateways: club.gateways,
    }),
  }));
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => AGENDA_CALLER_ID,
  }));
}

function mockAnonymousCaller(): void {
  mockSessionClient();
  vi.doMock("@/lib/auth/session-reader", () => ({
    readAuthenticatedUserId: async () => null,
  }));
}

async function requestAgenda(query = ""): Promise<Response> {
  const { GET } = await import("@/app/api/v1/events/route");
  return GET(new NextRequest(new URL(`${EVENTS_API_PATH}${query}`, ORIGIN)));
}

async function requestEvent(eventId: string): Promise<Response> {
  const { GET } = await import("@/app/api/v1/events/[id]/route");
  return GET(
    new NextRequest(new URL(EVENT_API_PATH.replace("[id]", eventId), ORIGIN)),
    { params: Promise.resolve({ id: eventId }) },
  );
}

async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ now: AGENDA_NOW, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/events/supabase-event-agenda-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("endpoints de agenda y detalle", () => {
  it("la agenda responde 200 con los próximos según la hora del servidor", async () => {
    mockWiring({
      events: [
        clubEvent("2027-06-14", { title: "ayer" }),
        clubEvent("2027-06-22", { title: "próximo" }),
      ],
    });

    const response = await requestAgenda();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { events: [{ title: "próximo" }], nextCursor: null },
    });
  });

  it("la agenda responde 200 con los pasados cuando se piden", async () => {
    mockWiring({
      events: [
        clubEvent("2027-06-14", { title: "ayer" }),
        clubEvent("2027-06-22", { title: "próximo" }),
      ],
    });

    const response = await requestAgenda("?period=past");

    await expect(response.json()).resolves.toMatchObject({
      data: { events: [{ title: "ayer" }] },
    });
  });

  it("la agenda responde 400 a un periodo que no existe", async () => {
    mockWiring();

    const response = await requestAgenda("?period=manana");

    await expectError(response, 400, "validation_error");
  });

  it("la agenda responde 400 a un cursor inventado", async () => {
    mockWiring();

    const response = await requestAgenda("?cursor=inventado");

    await expectError(response, 400, "validation_error");
  });

  it("la agenda responde 401 sin sesión", async () => {
    mockAnonymousCaller();

    const response = await requestAgenda();

    await expectError(response, 401, "unauthenticated");
  });

  it("el detalle responde 200 con las notas del evento", async () => {
    const event = clubEvent("2027-06-22", { notes: "Traed aletas." });
    mockWiring({ events: [event] });

    const response = await requestEvent(event.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: event.id, notes: "Traed aletas.", going: [], maybe: [] },
    });
  });

  it("el detalle responde 404 a un miembro fuera de la audiencia", async () => {
    const event = seniorSquadEvent("2027-06-22");
    mockWiring({ callerGroupIds: [MASTERS_SQUAD.id], events: [event] });

    const response = await requestEvent(event.id);

    await expectError(response, 404, "not_found");
  });

  it("el detalle responde 404 a un id que no es un uuid", async () => {
    mockWiring();

    const response = await requestEvent("no-es-un-id");

    await expectError(response, 404, "not_found");
  });

  it("el detalle responde 401 sin sesión", async () => {
    mockAnonymousCaller();

    const response = await requestEvent(clubEvent("2027-06-22").id);

    await expectError(response, 401, "unauthenticated");
  });
});
