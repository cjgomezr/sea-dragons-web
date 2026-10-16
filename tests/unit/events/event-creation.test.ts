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
  PLACE_ADDRESS_MAX_LENGTH,
  PLACE_DETAIL_MAX_LENGTH,
  PLACE_NAME_MAX_LENGTH,
} from "@/lib/events/event-place";
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
import {
  FOREIGN_COVER_ID,
  MISSING_COVER_ID,
  ORGANIZER_COVER_ID,
  ORPHAN_COVER_ID,
  OWN_COVER_ID,
  PLAYER_COVER_ID,
} from "../helpers/event-covers-club";

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
          endTime: "12:00",
          location: "MSAC",
          place: null,
          placeDetail: null,
          notes: "Llevad gorro azul.",
          audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
        },
        endsOn: null,
        coverUploadId: null,
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
        endsOn: null,
        startTime: "10:00",
        endTime: "12:00",
        location: "MSAC",
        place: null,
        placeDetail: null,
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
      place: null,
      placeDetail: null,
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
        endTime: "20:30",
        location: "MSAC",
        place: null,
        placeDetail: null,
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

describe("crear evento: hora y fecha de fin", () => {
  it("rechaza un evento suelto sin hora de fin", async () => {
    await expectRejected(
      { ...SINGLE_DRAFT, endTime: undefined },
      "end_time_required",
    );
  });

  it("rechaza una serie sin hora de fin", async () => {
    await expectRejected(
      { ...WEEKLY_DRAFT, endTime: null },
      "end_time_required",
    );
  });

  it("rechaza una hora de fin anterior al inicio en un evento de un día", async () => {
    await expectRejected(
      { ...SINGLE_DRAFT, startTime: "10:00", endTime: "09:30" },
      "end_before_start",
    );
  });

  it("rechaza una hora de fin igual al inicio en un evento de un día", async () => {
    await expectRejected(
      { ...SINGLE_DRAFT, startTime: "10:00", endTime: "10:00" },
      "end_before_start",
    );
  });

  it("rechaza en una serie una hora de fin que no va después del inicio", async () => {
    await expectRejected(
      { ...WEEKLY_DRAFT, startTime: "19:00", endTime: "18:00" },
      "end_before_start",
    );
  });

  it("guarda la hora de fin de un evento de un día, sin fecha de fin", async () => {
    const club = await createAs(SINGLE_DRAFT);

    expect(club.saved[0]).toMatchObject({
      fields: { startTime: "10:00", endTime: "12:00" },
      endsOn: null,
    });
  });

  it("acepta un evento de varios días con cualquier hora de fin", async () => {
    const club = await createAs({
      ...SINGLE_DRAFT,
      startsOn: "2027-07-10",
      startTime: "18:00",
      endsOn: "2027-07-11",
      endTime: "08:00",
    });

    expect(club.saved[0]).toMatchObject({
      fields: { startTime: "18:00", endTime: "08:00" },
      endsOn: "2027-07-11",
    });
  });

  it("devuelve el evento creado con su hora y su fecha de fin", async () => {
    const club = fakeEventsClub();

    const created = await createEvents(club.gateways, {
      callerId: CALLER_ID,
      draft: { ...SINGLE_DRAFT, endsOn: "2027-07-12", endTime: "16:00" },
      now: NOW,
    });

    expect(created).toMatchObject({
      repeat: "none",
      event: { endTime: "16:00", endsOn: "2027-07-12" },
    });
  });

  it("trata como de un día un evento con la fecha de fin igual a la de inicio", async () => {
    const club = await createAs({ ...SINGLE_DRAFT, endsOn: "2027-07-10" });

    expect(club.saved[0]?.endsOn).toBeNull();
  });

  it("rechaza con la fecha de fin igual a la de inicio una hora de fin que no va después", async () => {
    await expectRejected(
      {
        ...SINGLE_DRAFT,
        endsOn: "2027-07-10",
        startTime: "10:00",
        endTime: "09:00",
      },
      "end_before_start",
    );
  });

  it("rechaza una fecha de fin anterior a la de inicio", async () => {
    await expectRejected(
      { ...SINGLE_DRAFT, startsOn: "2027-07-10", endsOn: "2027-07-09" },
      "end_before_start",
    );
  });

  it("guarda la serie y sus sesiones con la hora de fin de la serie y sin fecha de fin", async () => {
    const club = await createAs(WEEKLY_DRAFT);

    expect(club.saved[0]).toMatchObject({
      fields: { startTime: "19:00", endTime: "20:30" },
      endsOn: null,
    });
  });
});

describe("crear evento: lugar estructurado", () => {
  const MSAC_PLACE = {
    name: "MSAC",
    address: "Aughtie Dr, Albert Park VIC 3206",
    lat: -37.8423,
    lng: 144.9601,
  } as const;

  it("guarda el lugar y dónde exactamente, y enseña el nombre del lugar", async () => {
    const club = await createAs({
      ...SINGLE_DRAFT,
      location: "Texto que escribió antes de elegir",
      place: MSAC_PLACE,
      placeDetail: "Piscina de buceo",
    });

    expect(club.saved[0]?.fields).toMatchObject({
      location: "MSAC",
      place: MSAC_PLACE,
      placeDetail: "Piscina de buceo",
    });
  });

  it("recorta el nombre, la dirección y el detalle, y guarda los vacíos como ninguno", async () => {
    const club = await createAs({
      ...SINGLE_DRAFT,
      place: { name: " MSAC ", address: "  ", lat: null, lng: null },
      placeDetail: "   ",
    });

    expect(club.saved[0]?.fields).toMatchObject({
      location: "MSAC",
      place: { name: "MSAC", address: null, lat: null, lng: null },
      placeDetail: null,
    });
  });

  it("acepta un lugar sin dirección ni coordenadas", async () => {
    const club = await createAs({ ...SINGLE_DRAFT, place: { name: "MSAC" } });

    expect(club.saved[0]?.fields.place).toEqual({
      name: "MSAC",
      address: null,
      lat: null,
      lng: null,
    });
  });

  it("deja el lugar y el detalle nulos cuando sólo llega el texto libre", async () => {
    const club = await createAs({
      ...SINGLE_DRAFT,
      location: "Piscina de Box Hill",
    });

    expect(club.saved[0]?.fields).toMatchObject({
      location: "Piscina de Box Hill",
      place: null,
      placeDetail: null,
    });
  });

  it("guarda el lugar en la serie, que lo comparten sus sesiones", async () => {
    const club = await createAs({ ...WEEKLY_DRAFT, place: MSAC_PLACE });

    expect(club.saved[0]?.fields.place).toEqual(MSAC_PLACE);
  });

  it.each([
    ["una latitud por encima de 90", { ...MSAC_PLACE, lat: 90.0001 }],
    ["una latitud por debajo de -90", { ...MSAC_PLACE, lat: -91 }],
    ["una longitud por encima de 180", { ...MSAC_PLACE, lng: 180.5 }],
    ["una longitud por debajo de -180", { ...MSAC_PLACE, lng: -181 }],
    ["una latitud sin longitud", { ...MSAC_PLACE, lng: null }],
    ["una longitud sin latitud", { name: "MSAC", lng: 144.9601 }],
  ])("rechaza %s", async (_case, place) => {
    await expectRejected(
      { ...SINGLE_DRAFT, place },
      "event_place_coordinates_invalid",
    );
  });

  it("acepta las coordenadas justo en el borde del rango", async () => {
    const club = await createAs({
      ...SINGLE_DRAFT,
      place: { name: "Polo", address: null, lat: -90, lng: 180 },
    });

    expect(club.saved[0]?.fields.place).toMatchObject({ lat: -90, lng: 180 });
  });

  it.each([
    ["un nombre vacío", { name: "  " }],
    [
      "un nombre de más de 120 caracteres",
      { name: "x".repeat(PLACE_NAME_MAX_LENGTH + 1) },
    ],
    ["un nombre con caracteres de control", { name: "MSAC\u0007" }],
    [
      "una dirección de más de 200 caracteres",
      { name: "MSAC", address: "x".repeat(PLACE_ADDRESS_MAX_LENGTH + 1) },
    ],
  ])("rechaza %s", async (_case, place) => {
    await expectRejected({ ...SINGLE_DRAFT, place }, "event_place_invalid");
  });

  it("rechaza un detalle de más de 120 caracteres", async () => {
    await expectRejected(
      {
        ...SINGLE_DRAFT,
        place: MSAC_PLACE,
        placeDetail: "x".repeat(PLACE_DETAIL_MAX_LENGTH + 1),
      },
      "event_place_detail_invalid",
    );
  });
});

describe("crear evento: imagen (#644)", () => {
  it("enlaza una imagen subida por quien crea", async () => {
    const club = await createAs({
      ...SINGLE_DRAFT,
      coverUploadId: OWN_COVER_ID,
    });

    expect(club.saved[0]?.coverUploadId).toBe(OWN_COVER_ID);
  });

  it("enlaza una imagen que subió otra persona que organiza eventos", async () => {
    const club = await createAs({
      ...SINGLE_DRAFT,
      coverUploadId: ORGANIZER_COVER_ID,
    });

    expect(club.saved[0]?.coverUploadId).toBe(ORGANIZER_COVER_ID);
  });

  it("guarda la imagen de una serie, que la base copia a sus sesiones", async () => {
    const club = await createAs({
      ...WEEKLY_DRAFT,
      coverUploadId: OWN_COVER_ID,
    });

    expect(club.saved[0]?.coverUploadId).toBe(OWN_COVER_ID);
  });

  it("deja el evento sin imagen si no llega el campo o llega a null", async () => {
    const withoutField = await createAs(SINGLE_DRAFT);
    const withNull = await createAs({ ...SINGLE_DRAFT, coverUploadId: null });

    expect(withoutField.saved[0]?.coverUploadId).toBeNull();
    expect(withNull.saved[0]?.coverUploadId).toBeNull();
  });

  it.each([
    ["de otro club", FOREIGN_COVER_ID],
    ["de alguien que ya no organiza eventos", PLAYER_COVER_ID],
    ["de alguien a quien se le borró la ficha", ORPHAN_COVER_ID],
    ["que no existe", MISSING_COVER_ID],
  ])("rechaza una imagen %s sin guardar nada", async (_case, coverUploadId) => {
    await expectRejected(
      { ...SINGLE_DRAFT, coverUploadId },
      "event_cover_upload_invalid",
    );
  });
});
