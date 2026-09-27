import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS_MANAGE_API_PATH } from "@/lib/auth/routes";
import {
  CALLER_ID,
  CLUB_ID,
  type FakeEventsClub,
  type FakeEventsClubOptions,
  MASTERS_SQUAD_ID,
  SENIOR_SQUAD_ID,
  fakeEventsClub,
} from "../helpers/events-club";

/**
 * El endpoint de crear eventos (#307, RF-2 y RF-3 del PRD de E7). Qué decide
 * cada caso lo prueba el dominio; aquí se prueba que cada uno sale con su
 * código de la convención: 201, 400, 401, 403 y 422.
 */

const ORIGIN = "http://localhost:3417";

/** 2027-06-15 10:00 en Melbourne. */
const NOW = new Date("2027-06-15T00:00:00Z");

const COMPETITION = {
  title: "Liga estatal",
  eventType: "competition",
  startTime: "10:00",
  location: "MSAC",
  notes: "Llevad gorro azul.",
  audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
  repeat: "none",
  startsOn: "2027-07-10",
};

const WEEKLY_TRAINING = {
  title: "Entrenamiento",
  eventType: "training",
  startTime: "19:00",
  location: "MSAC",
  notes: null,
  audience: { kind: "club" },
  repeat: "weekly",
  weekdays: [2, 4],
  startsOn: "2027-07-01",
  endsOn: "2027-08-31",
};

let club: FakeEventsClub;

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

function mockWiring(options: FakeEventsClubOptions = {}): void {
  club = fakeEventsClub(options);
  vi.doMock("@/lib/events/supabase-event-gateways", () => ({
    createSupabaseEventGateways: () => ({
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

async function createEvent(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/v1/events/manage/route");
  return POST(
    new NextRequest(new URL(EVENTS_MANAGE_API_PATH, ORIGIN), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
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
  vi.doUnmock("@/lib/events/supabase-event-gateways");
  vi.doUnmock("@/lib/supabase/session-client");
  vi.doUnmock("@/lib/auth/session-reader");
  vi.restoreAllMocks();
});

describe("endpoint de crear eventos", () => {
  it("responde 201 a un Committee con la Competition creada y su audiencia", async () => {
    mockWiring({ callerRole: "Committee" });

    const response = await createEvent(COMPETITION);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        repeat: "none",
        event: {
          title: "Liga estatal",
          eventType: "competition",
          startsOn: "2027-07-10",
          startTime: "10:00",
          location: "MSAC",
          notes: "Llevad gorro azul.",
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        },
      },
    });
    expect(club.saved[0]?.clubId).toBe(CLUB_ID);
  });

  it("responde 201 a un Admin con una ocurrencia por cada martes y jueves", async () => {
    mockWiring({ callerRole: "Admin" });

    const response = await createEvent(WEEKLY_TRAINING);

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      data: { occurrences: { startsOn: string }[] };
    };
    expect(body.data.occurrences).toHaveLength(18);
  });

  it("no acepta el club por el cuerpo", async () => {
    mockWiring({ callerRole: "Admin" });

    await createEvent({ ...COMPETITION, clubId: "otro" });

    expect(club.saved[0]?.clubId).toBe(CLUB_ID);
  });

  it.each(["Coach", "Player"] as const)(
    "responde 403 a un %s sin crear nada",
    async (callerRole) => {
      mockWiring({ callerRole });

      const response = await createEvent(COMPETITION);

      await expectError(response, 403, { code: "forbidden" });
      expect(club.saved).toEqual([]);
    },
  );

  it("responde 401 sin sesión", async () => {
    mockAnonymousCaller();

    const response = await createEvent(COMPETITION);

    await expectError(response, 401, { code: "unauthenticated" });
  });

  it.each([
    ["un tipo fuera de los cuatro", { ...COMPETITION, eventType: "party" }],
    ["una repetición desconocida", { ...COMPETITION, repeat: "monthly" }],
    ["una fecha sin forma de fecha", { ...COMPETITION, startsOn: "10/07" }],
    ["una hora sin forma de hora", { ...COMPETITION, startTime: "25:00" }],
    [
      "un día de la semana fuera de 1 a 7",
      { ...WEEKLY_TRAINING, weekdays: [8] },
    ],
    [
      "un grupo que no es un uuid",
      { ...COMPETITION, audience: { kind: "groups", groupIds: ["senior"] } },
    ],
  ])("responde 400 a %s", async (_case, body) => {
    mockWiring({ callerRole: "Admin" });

    const response = await createEvent(body);

    await expectError(response, 400, { code: "validation_error" });
    expect(club.saved).toEqual([]);
  });

  it.each([
    [
      "una fecha y hora ya pasadas",
      { ...COMPETITION, startsOn: "2027-06-14" },
      "event_in_past",
    ],
    [
      "una audiencia de grupos vacía",
      { ...COMPETITION, audience: { kind: "groups", groupIds: [] } },
      "event_audience_empty",
    ],
    [
      "un grupo que no es del club",
      {
        ...COMPETITION,
        audience: { kind: "groups", groupIds: [MASTERS_SQUAD_ID] },
      },
      "event_audience_foreign_group",
    ],
    [
      "un rango de más de un año",
      { ...WEEKLY_TRAINING, endsOn: "2028-07-01" },
      "series_range_too_long",
    ],
    [
      "una serie sin días elegidos",
      { ...WEEKLY_TRAINING, weekdays: [] },
      "series_weekdays_empty",
    ],
    [
      "una serie con el fin antes del inicio",
      { ...WEEKLY_TRAINING, endsOn: "2027-06-30" },
      "series_range_inverted",
    ],
    [
      "un rango sin ninguno de los días elegidos",
      {
        ...WEEKLY_TRAINING,
        weekdays: [2],
        startsOn: "2027-07-07",
        endsOn: "2027-07-12",
      },
      "series_without_sessions",
    ],
  ])("responde 422 a %s", async (_case, body, reason) => {
    mockWiring({ callerRole: "Admin", clubGroupIds: [SENIOR_SQUAD_ID] });

    const response = await createEvent(body);

    await expectError(response, 422, { code: "business_rule", reason });
    expect(club.saved).toEqual([]);
  });
});
