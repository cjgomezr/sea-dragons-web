import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_NOTES_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  type EventDraft,
  type EventIssueCode,
  EventValidationError,
  EventsForbiddenError,
  createEvents,
} from "@/lib/events/event-creation";
import {
  CALLER_ID,
  CLUB_ID,
  MASTERS_SQUAD_ID,
  NOW,
  SAVED_SERIES_ID,
  SENIOR_SQUAD_ID,
  SINGLE_DRAFT,
  WEEKLY_DRAFT,
  type FakeEventsClubOptions,
  fakeEventsClub,
  savedEventId,
} from "../helpers/events-club";

/**
 * Crear un evento suelto o una serie semanal (#307, RF-2 y RF-3 del PRD de
 * E7), sin Supabase delante. Cada rechazo es un 422 con su código, y nada se
 * guarda.
 */

async function createAs(
  draft: EventDraft,
  options: FakeEventsClubOptions = {},
  now: Date = NOW,
): Promise<ReturnType<typeof fakeEventsClub>> {
  const club = fakeEventsClub(options);
  await createEvents(club.gateways, { callerId: CALLER_ID, draft, now });
  return club;
}

async function expectRejected(
  draft: EventDraft,
  code: EventIssueCode,
  options: FakeEventsClubOptions = {},
): Promise<void> {
  const club = fakeEventsClub(options);

  const attempt = createEvents(club.gateways, {
    callerId: CALLER_ID,
    draft,
    now: NOW,
  });

  await expect(attempt).rejects.toBeInstanceOf(EventValidationError);
  await expect(attempt).rejects.toMatchObject({ code });
  expect(club.saved).toEqual([]);
}

describe("crear evento: evento suelto", () => {
  it("guarda una sola fecha, sin serie, en el club de quien llama", async () => {
    const club = await createAs(SINGLE_DRAFT);

    expect(club.saved).toEqual([
      {
        clubId: CLUB_ID,
        authorId: CALLER_ID,
        fields: {
          title: "Liga estatal",
          eventType: "competition",
          startTime: "10:00",
          location: "MSAC",
          notes: "Llevad gorro azul.",
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        },
        occurrenceDates: ["2027-07-10"],
        series: null,
      },
    ]);
  });

  it("devuelve el evento creado con su audiencia", async () => {
    const club = fakeEventsClub();

    const created = await createEvents(club.gateways, {
      callerId: CALLER_ID,
      draft: SINGLE_DRAFT,
      now: NOW,
    });

    expect(created).toEqual({
      repeat: "none",
      event: {
        id: savedEventId(0),
        title: "Liga estatal",
        eventType: "competition",
        startsOn: "2027-07-10",
        startTime: "10:00",
        location: "MSAC",
        notes: "Llevad gorro azul.",
        audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
      },
    });
  });

  it("recorta título, lugar y notas, y guarda unas notas en blanco como ninguna", async () => {
    const club = await createAs({
      ...SINGLE_DRAFT,
      title: "  Liga estatal ",
      location: " MSAC ",
      notes: "   ",
    });

    expect(club.saved[0]?.fields).toMatchObject({
      title: "Liga estatal",
      location: "MSAC",
      notes: null,
    });
  });

  it("quita los grupos repetidos de la audiencia", async () => {
    const club = await createAs({
      ...SINGLE_DRAFT,
      audience: {
        kind: "groups",
        groupIds: [SENIOR_SQUAD_ID, MASTERS_SQUAD_ID, SENIOR_SQUAD_ID],
      },
    });

    expect(club.saved[0]?.fields.audience).toEqual({
      kind: "groups",
      groupIds: [SENIOR_SQUAD_ID, MASTERS_SQUAD_ID],
    });
  });

  it("rechaza una fecha y hora que ya pasaron", async () => {
    // NOW son las 10:00 del 15 de junio en Melbourne.
    await expectRejected(
      { ...SINGLE_DRAFT, startsOn: "2027-06-15", startTime: "10:00" },
      "event_in_past",
    );
    await expectRejected(
      { ...SINGLE_DRAFT, startsOn: "2027-06-14", startTime: "23:00" },
      "event_in_past",
    );
  });

  it("acepta hoy a una hora que todavía no llegó", async () => {
    const club = await createAs({
      ...SINGLE_DRAFT,
      startsOn: "2027-06-15",
      startTime: "10:01",
    });

    expect(club.saved[0]?.occurrenceDates).toEqual(["2027-06-15"]);
  });
});

describe("crear evento: validaciones comunes", () => {
  it("rechaza una audiencia de grupos vacía", async () => {
    await expectRejected(
      { ...SINGLE_DRAFT, audience: { kind: "groups", groupIds: [] } },
      "event_audience_empty",
    );
  });

  it("rechaza un grupo que no es del club", async () => {
    await expectRejected(
      {
        ...WEEKLY_DRAFT,
        audience: { kind: "groups", groupIds: [MASTERS_SQUAD_ID] },
      },
      "event_audience_foreign_group",
      { clubGroupIds: [SENIOR_SQUAD_ID] },
    );
  });

  it.each([
    ["vacío", "   "],
    ["demasiado largo", "x".repeat(EVENT_TITLE_MAX_LENGTH + 1)],
    ["con caracteres de control", "Liga\u0007"],
  ])("rechaza un título %s", async (_case, title) => {
    await expectRejected({ ...SINGLE_DRAFT, title }, "event_title_invalid");
  });

  it.each([
    ["vacío", " "],
    ["demasiado largo", "x".repeat(EVENT_LOCATION_MAX_LENGTH + 1)],
  ])("rechaza un lugar %s", async (_case, location) => {
    await expectRejected(
      { ...SINGLE_DRAFT, location },
      "event_location_invalid",
    );
  });

  it("rechaza unas notas demasiado largas", async () => {
    await expectRejected(
      { ...SINGLE_DRAFT, notes: "x".repeat(EVENT_NOTES_MAX_LENGTH + 1) },
      "event_notes_too_long",
    );
  });

  it.each(["Coach", "Player"] as const)(
    "niega crear a un %s sin guardar nada",
    async (callerRole) => {
      const club = fakeEventsClub({ callerRole });

      const attempt = createEvents(club.gateways, {
        callerId: CALLER_ID,
        draft: SINGLE_DRAFT,
        now: NOW,
      });

      await expect(attempt).rejects.toBeInstanceOf(EventsForbiddenError);
      expect(club.saved).toEqual([]);
    },
  );

  it("no deja crear a quien no es socio", async () => {
    const club = fakeEventsClub({ callerIsMember: false });

    await expect(
      createEvents(club.gateways, {
        callerId: CALLER_ID,
        draft: SINGLE_DRAFT,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

describe("crear evento: serie semanal", () => {
  it("guarda la serie con una fecha por cada martes y jueves del rango", async () => {
    const club = await createAs(WEEKLY_DRAFT, { callerRole: "Admin" });

    const saved = club.saved[0];
    expect(saved?.series).toEqual({
      weekdays: [2, 4],
      startsOn: "2027-07-01",
      endsOn: "2027-08-31",
    });
    expect(saved?.occurrenceDates).toHaveLength(18);
    expect(saved?.occurrenceDates[0]).toBe("2027-07-01");
    expect(saved?.occurrenceDates.at(-1)).toBe("2027-08-31");
  });

  it("devuelve la serie y sus ocurrencias con su id y su fecha", async () => {
    const club = fakeEventsClub();

    const created = await createEvents(club.gateways, {
      callerId: CALLER_ID,
      draft: { ...WEEKLY_DRAFT, startsOn: "2027-07-06", endsOn: "2027-07-08" },
      now: NOW,
    });

    expect(created).toEqual({
      repeat: "weekly",
      series: {
        id: SAVED_SERIES_ID,
        title: "Entrenamiento",
        eventType: "training",
        startTime: "19:00",
        location: "MSAC",
        notes: null,
        audience: { kind: "club" },
        weekdays: [2, 4],
        startsOn: "2027-07-06",
        endsOn: "2027-07-08",
      },
      occurrences: [
        { id: savedEventId(0), startsOn: "2027-07-06" },
        { id: savedEventId(1), startsOn: "2027-07-08" },
      ],
    });
  });

  it("ordena los días y quita los repetidos", async () => {
    const club = await createAs({ ...WEEKLY_DRAFT, weekdays: [4, 2, 4] });

    expect(club.saved[0]?.series?.weekdays).toEqual([2, 4]);
  });

  it("no guarda la de hoy si su hora ya pasó", async () => {
    // NOW es el martes 15 de junio a las 10:00 de Melbourne.
    const club = await createAs({
      ...WEEKLY_DRAFT,
      weekdays: [2],
      startTime: "09:00",
      startsOn: "2027-06-15",
      endsOn: "2027-06-29",
    });

    expect(club.saved[0]?.occurrenceDates).toEqual([
      "2027-06-22",
      "2027-06-29",
    ]);
  });

  it("rechaza una serie sin días elegidos", async () => {
    await expectRejected(
      { ...WEEKLY_DRAFT, weekdays: [] },
      "series_weekdays_empty",
    );
  });

  it("rechaza una serie con el fin antes del inicio", async () => {
    await expectRejected(
      { ...WEEKLY_DRAFT, startsOn: "2027-08-31", endsOn: "2027-07-01" },
      "series_range_inverted",
    );
  });

  it("acepta un año justo y rechaza un día más", async () => {
    const club = await createAs({
      ...WEEKLY_DRAFT,
      startsOn: "2027-07-01",
      endsOn: "2028-06-30",
    });
    expect(club.saved).toHaveLength(1);

    await expectRejected(
      { ...WEEKLY_DRAFT, startsOn: "2027-07-01", endsOn: "2028-07-01" },
      "series_range_too_long",
    );
  });

  it("rechaza un rango sin ninguno de los días elegidos", async () => {
    await expectRejected(
      {
        ...WEEKLY_DRAFT,
        weekdays: [2],
        startsOn: "2027-07-07",
        endsOn: "2027-07-12",
      },
      "series_without_sessions",
    );
  });
});
