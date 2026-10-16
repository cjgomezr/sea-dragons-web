import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { Role } from "@/lib/auth/roles";
import {
  AGENDA_PAGE_SIZE,
  type AgendaPeriod,
  InvalidAgendaCursorError,
  listAgenda,
  openEvent,
} from "@/lib/events/event-agenda";
import { eventCoverPathsOf } from "@/lib/events/event-covers";
import { EventNotFoundError } from "@/lib/events/event-rsvp";
import { SIGNED_URL_PREFIX } from "../helpers/event-covers-club";
import {
  AGENDA_CALLER_ID,
  AGENDA_CLUB_ID,
  AGENDA_NOW,
  type FakeAgendaClubOptions,
  MASTERS_SQUAD,
  OTHER_CLUB_ID,
  SENIOR_SQUAD,
  clubEvent,
  fakeAgendaClub,
  seniorSquadEvent,
} from "../helpers/event-agenda-club";

/**
 * La agenda y el detalle de un evento (#309, RF-4, RF-6 y RF-7 del PRD de
 * E7), sin Supabase delante. "Hoy" es la fecha de Melbourne de la hora que
 * recibe el dominio: `AGENDA_NOW` es el 15 de junio de 2027 allí.
 */

const TODAY = "2027-06-15";

function agenda(
  options: FakeAgendaClubOptions,
  request: { readonly period?: AgendaPeriod; readonly cursor?: string } = {},
) {
  return listAgenda(fakeAgendaClub(options).gateways, {
    callerId: AGENDA_CALLER_ID,
    period: request.period ?? "upcoming",
    now: AGENDA_NOW,
    ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
  });
}

function titlesOf(page: {
  readonly events: readonly { readonly title: string }[];
}): readonly string[] {
  return page.events.map((event) => event.title);
}

const MSAC_PLACE = {
  name: "MSAC",
  address: "Aughtie Dr, Albert Park VIC 3206",
  lat: -37.8423,
  lng: 144.9601,
} as const;

describe("agenda", () => {
  it("devuelve cada evento con sus campos, sus conteos y la respuesta propia", async () => {
    const event = clubEvent("2027-06-22", {
      seriesId: "5e5e5e5e-0000-4000-8000-000000000005",
      myResponse: "maybe",
    });

    const page = await agenda({
      events: [event],
      tallies: [{ eventId: event.id, goingCount: 7, maybeCount: 2 }],
    });

    expect(page).toEqual({
      events: [
        {
          id: event.id,
          startsOn: "2027-06-22",
          startTime: "19:00",
          endTime: "20:30",
          endsOn: null,
          title: "Entrenamiento",
          eventType: "training",
          location: "MSAC",
          place: null,
          placeDetail: null,
          status: "scheduled",
          seriesId: "5e5e5e5e-0000-4000-8000-000000000005",
          goingCount: 7,
          maybeCount: 2,
          myResponse: "maybe",
          inAudience: true,
          coverThumbUrl: null,
        },
      ],
      nextCursor: null,
    });
  });

  it("trae la fecha de fin de un evento de varios días", async () => {
    const event = clubEvent("2027-06-26", {
      startTime: "08:30",
      endTime: "17:00",
      endsOn: "2027-06-27",
    });

    const page = await agenda({ events: [event] });

    expect(page.events[0]).toMatchObject({
      startTime: "08:30",
      endTime: "17:00",
      endsOn: "2027-06-27",
    });
  });

  it("trae el lugar elegido y dónde exactamente", async () => {
    const event = clubEvent("2027-06-22", {
      place: MSAC_PLACE,
      placeDetail: "Piscina de buceo",
    });

    const page = await agenda({ events: [event] });

    expect(page.events[0]).toMatchObject({
      location: "MSAC",
      place: MSAC_PLACE,
      placeDetail: "Piscina de buceo",
    });
  });

  it("trae el lugar nulo en un evento con texto libre", async () => {
    const event = clubEvent("2027-06-22", { location: "Piscina de Box Hill" });

    const page = await agenda({ events: [event] });

    expect(page.events[0]).toMatchObject({ place: null, placeDetail: null });
  });

  it("trae sin hora ni fecha de fin un evento anterior a E24", async () => {
    const event = clubEvent("2027-06-22", { endTime: null });

    const page = await agenda({ events: [event] });

    expect(page.events[0]).toMatchObject({ endTime: null, endsOn: null });
  });

  it("trae los de hoy en adelante, en fecha de Melbourne, por inicio ascendente", async () => {
    const events = [
      clubEvent("2027-06-29", { title: "dentro de dos semanas" }),
      clubEvent("2027-06-14", { title: "ayer" }),
      clubEvent(TODAY, { title: "hoy" }),
      clubEvent("2027-06-22", { title: "la semana que viene" }),
    ];

    const page = await agenda({ events });

    expect(titlesOf(page)).toEqual([
      "hoy",
      "la semana que viene",
      "dentro de dos semanas",
    ]);
  });

  it("en modo pasados trae los anteriores a hoy, del más reciente al más antiguo", async () => {
    const events = [
      clubEvent("2027-06-01", { title: "hace dos semanas" }),
      clubEvent(TODAY, { title: "hoy" }),
      clubEvent("2027-06-14", { title: "ayer" }),
    ];

    const page = await agenda({ events }, { period: "past" });

    expect(titlesOf(page)).toEqual(["ayer", "hace dos semanas"]);
  });

  it("pone a cero los conteos de un evento sin respuestas que cuenten", async () => {
    const page = await agenda({ events: [clubEvent("2027-06-22")] });

    expect(page.events[0]).toMatchObject({ goingCount: 0, maybeCount: 0 });
  });

  it("trae un evento cancelado con su estado", async () => {
    const page = await agenda({
      events: [clubEvent("2027-06-22", { status: "cancelled" })],
    });

    expect(page.events[0]?.status).toBe("cancelled");
  });

  it("pide los conteos de toda la página en una sola llamada", async () => {
    const events = Array.from({ length: AGENDA_PAGE_SIZE }, () =>
      clubEvent("2027-06-22"),
    );
    const club = fakeAgendaClub({ events });

    await listAgenda(club.gateways, {
      callerId: AGENDA_CALLER_ID,
      period: "upcoming",
      now: AGENDA_NOW,
    });

    expect(club.tallyCalls).toEqual([events.map((event) => event.id)]);
  });

  it("con más de 50 devuelve 50 y un cursor que trae los siguientes", async () => {
    const events = Array.from({ length: AGENDA_PAGE_SIZE + 3 }, (_, index) =>
      clubEvent("2027-06-22", { title: `evento ${index}` }),
    );
    const options = { events };

    const first = await agenda(options);
    const second = await agenda(options, {
      cursor: first.nextCursor ?? "sin cursor",
    });

    expect(first.events).toHaveLength(AGENDA_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    expect(titlesOf(second)).toEqual(["evento 50", "evento 51", "evento 52"]);
    expect(second.nextCursor).toBeNull();
  });

  it("el cursor de los pasados sigue hacia atrás", async () => {
    const events = Array.from({ length: AGENDA_PAGE_SIZE + 1 }, (_, index) =>
      clubEvent("2027-06-01", { title: `pasado ${index}` }),
    );

    const first = await agenda({ events }, { period: "past" });
    const second = await agenda(
      { events },
      { period: "past", cursor: first.nextCursor ?? "sin cursor" },
    );

    expect(titlesOf(second)).toEqual(["pasado 0"]);
  });

  it("rechaza un cursor que no salió de la agenda", async () => {
    await expect(
      agenda({ events: [] }, { cursor: "no-es-un-cursor" }),
    ).rejects.toBeInstanceOf(InvalidAgendaCursorError);
  });

  it("a un miembro de Senior Squad le muestra su evento", async () => {
    const page = await agenda({
      callerGroupIds: [SENIOR_SQUAD.id],
      events: [seniorSquadEvent("2027-06-22")],
    });

    expect(titlesOf(page)).toEqual(["Senior Squad"]);
  });

  it("a un miembro fuera de Senior Squad no se lo muestra", async () => {
    const page = await agenda({
      callerGroupIds: [MASTERS_SQUAD.id],
      events: [seniorSquadEvent("2027-06-22")],
    });

    expect(page.events).toEqual([]);
  });

  it.each<Role>(["Admin", "Committee"])(
    "a un %s le muestra todos, cada uno con si está en su audiencia",
    async (role) => {
      const page = await agenda({
        callerRole: role,
        callerGroupIds: [MASTERS_SQUAD.id],
        events: [
          clubEvent("2027-06-21", { title: "club" }),
          seniorSquadEvent("2027-06-22"),
        ],
      });

      expect(
        page.events.map((event) => [event.title, event.inAudience]),
      ).toEqual([
        ["club", true],
        ["Senior Squad", false],
      ]);
    },
  );

  it("a un Coach sólo le muestra los de su audiencia", async () => {
    const page = await agenda({
      callerRole: "Coach",
      events: [
        clubEvent("2027-06-21", { title: "club" }),
        seniorSquadEvent("2027-06-22"),
      ],
    });

    expect(titlesOf(page)).toEqual(["club"]);
  });

  it("no muestra los eventos de otro club", async () => {
    const page = await agenda({
      callerRole: "Admin",
      events: [clubEvent("2027-06-22", { clubId: OTHER_CLUB_ID })],
    });

    expect(page.events).toEqual([]);
  });

  it("rechaza a quien no tiene fila de miembro", async () => {
    await expect(
      agenda({ callerIsMember: false, events: [] }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

function open(options: FakeAgendaClubOptions, eventId: string) {
  return openEvent(fakeAgendaClub(options).gateways, {
    callerId: AGENDA_CALLER_ID,
    eventId,
  });
}

describe("detalle de un evento", () => {
  it("trae el lugar elegido y dónde exactamente", async () => {
    const event = clubEvent("2027-06-22", {
      place: MSAC_PLACE,
      placeDetail: "Piscina de buceo",
    });

    const detail = await open({ events: [event] }, event.id);

    expect(detail).toMatchObject({
      place: MSAC_PLACE,
      placeDetail: "Piscina de buceo",
    });
  });

  it("trae las notas y los nombres de quién va y quién quizás, ordenados", async () => {
    const event = clubEvent("2027-06-22", { notes: "Traed aletas." });

    const detail = await open(
      {
        events: [event],
        responders: {
          [event.id]: [
            { fullName: "Zoe", response: "yes" },
            { fullName: "Bea", response: "maybe" },
            { fullName: "Ana", response: "yes" },
          ],
        },
      },
      event.id,
    );

    expect(detail).toEqual({
      id: event.id,
      startsOn: "2027-06-22",
      startTime: "19:00",
      endTime: "20:30",
      endsOn: null,
      title: "Entrenamiento",
      eventType: "training",
      location: "MSAC",
      place: null,
      placeDetail: null,
      status: "scheduled",
      seriesId: null,
      goingCount: 2,
      maybeCount: 1,
      myResponse: null,
      inAudience: true,
      coverThumbUrl: null,
      coverUrl: null,
      notes: "Traed aletas.",
      going: ["Ana", "Zoe"],
      maybe: ["Bea"],
    });
  });

  it.each<Role>(["Admin", "Committee"])(
    "a un %s le da también la audiencia con el nombre de cada grupo",
    async (role) => {
      const event = seniorSquadEvent("2027-06-22");

      const detail = await open(
        { callerRole: role, events: [event] },
        event.id,
      );

      expect(detail).toMatchObject({
        inAudience: false,
        audience: { kind: "groups", groups: [SENIOR_SQUAD] },
      });
    },
  );

  it("a un Admin le dice que es para todo el club", async () => {
    const event = clubEvent("2027-06-22");

    const detail = await open(
      { callerRole: "Admin", events: [event] },
      event.id,
    );

    expect(detail).toMatchObject({ audience: { kind: "club" } });
  });

  it.each<Role>(["Coach", "Player"])(
    "a un %s no le da la audiencia",
    async (role) => {
      const event = seniorSquadEvent("2027-06-22");

      const detail = await open(
        {
          callerRole: role,
          callerGroupIds: [SENIOR_SQUAD.id],
          events: [event],
        },
        event.id,
      );

      expect(detail).not.toHaveProperty("audience");
    },
  );

  it("responde que no existe a un miembro fuera de la audiencia", async () => {
    const event = seniorSquadEvent("2027-06-22");

    await expect(
      open(
        {
          callerRole: "Coach",
          callerGroupIds: [MASTERS_SQUAD.id],
          events: [event],
        },
        event.id,
      ),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("responde que no existe a un evento de otro club, aunque pregunte un Admin", async () => {
    const event = clubEvent("2027-06-22", { clubId: OTHER_CLUB_ID });

    await expect(
      open({ callerRole: "Admin", events: [event] }, event.id),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("rechaza a quien no tiene fila de miembro", async () => {
    const event = clubEvent("2027-06-22");

    await expect(
      open({ callerIsMember: false, events: [event] }, event.id),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});

describe("imagen de los eventos (#644)", () => {
  const COVER = "cccccccc-0000-4000-8000-000000000001";
  const OTHER_COVER = "cccccccc-0000-4000-8000-000000000002";
  const coverOf = (id: string) =>
    eventCoverPathsOf({ id, clubId: AGENDA_CLUB_ID });
  const storedCoverPaths = [COVER, OTHER_COVER].flatMap((id) => [
    coverOf(id).thumbnail,
    coverOf(id).large,
  ]);
  const signed = (path: string): string => `${SIGNED_URL_PREFIX}${path}`;

  it("da a cada evento de la audiencia su miniatura firmada", async () => {
    const event = clubEvent("2027-06-22", { coverUploadId: COVER });
    const plain = clubEvent("2027-06-23");

    const page = await agenda({ events: [event, plain], storedCoverPaths });

    expect(page.events.map((row) => row.coverThumbUrl)).toEqual([
      signed(coverOf(COVER).thumbnail),
      null,
    ]);
  });

  it("firma todas las miniaturas de la página en una sola llamada", async () => {
    const club = fakeAgendaClub({
      storedCoverPaths,
      events: [
        clubEvent("2027-06-22", { coverUploadId: COVER }),
        clubEvent("2027-06-23", { coverUploadId: OTHER_COVER }),
        clubEvent("2027-06-24", { coverUploadId: COVER }),
      ],
    });

    await listAgenda(club.gateways, {
      callerId: AGENDA_CALLER_ID,
      period: "upcoming",
      now: AGENDA_NOW,
    });

    expect(club.coverSignCalls).toEqual([
      [coverOf(COVER).thumbnail, coverOf(OTHER_COVER).thumbnail],
    ]);
  });

  it("no llama a Storage si ningún evento de la página tiene imagen", async () => {
    const club = fakeAgendaClub({ events: [clubEvent("2027-06-22")] });

    await listAgenda(club.gateways, {
      callerId: AGENDA_CALLER_ID,
      period: "upcoming",
      now: AGENDA_NOW,
    });

    expect(club.coverSignCalls).toEqual([]);
  });

  it("trae la grande y la miniatura en el detalle", async () => {
    const event = clubEvent("2027-06-22", { coverUploadId: COVER });

    const detail = await open({ events: [event], storedCoverPaths }, event.id);

    expect(detail).toMatchObject({
      coverThumbUrl: signed(coverOf(COVER).thumbnail),
      coverUrl: signed(coverOf(COVER).large),
    });
  });

  it("da a una sesión de una serie la imagen que heredó", async () => {
    const session = clubEvent("2027-06-22", {
      seriesId: "5e5e5e5e-0000-4000-8000-000000000005",
      coverUploadId: COVER,
    });

    const detail = await open(
      { events: [session], storedCoverPaths },
      session.id,
    );

    expect(detail).toMatchObject({ coverUrl: signed(coverOf(COVER).large) });
  });

  it("no da ninguna dirección a quien organiza pero no es la audiencia", async () => {
    const event = seniorSquadEvent("2027-06-22", { coverUploadId: COVER });
    const club = fakeAgendaClub({
      callerRole: "Committee",
      events: [event],
      storedCoverPaths,
    });

    const page = await listAgenda(club.gateways, {
      callerId: AGENDA_CALLER_ID,
      period: "upcoming",
      now: AGENDA_NOW,
    });
    const detail = await openEvent(club.gateways, {
      callerId: AGENDA_CALLER_ID,
      eventId: event.id,
    });

    expect(page.events[0]?.coverThumbUrl).toBeNull();
    expect(detail).toMatchObject({ coverThumbUrl: null, coverUrl: null });
    expect(club.coverSignCalls).toEqual([]);
  });

  it("da null si Storage ya no tiene el fichero", async () => {
    const event = clubEvent("2027-06-22", { coverUploadId: COVER });

    const detail = await open({ events: [event] }, event.id);

    expect(detail).toMatchObject({ coverThumbUrl: null, coverUrl: null });
  });
});
