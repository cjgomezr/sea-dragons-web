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
import { EventNotFoundError } from "@/lib/events/event-rsvp";
import {
  AGENDA_CALLER_ID,
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
          title: "Entrenamiento",
          eventType: "training",
          location: "MSAC",
          status: "scheduled",
          seriesId: "5e5e5e5e-0000-4000-8000-000000000005",
          goingCount: 7,
          maybeCount: 2,
          myResponse: "maybe",
          inAudience: true,
        },
      ],
      nextCursor: null,
    });
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
      title: "Entrenamiento",
      eventType: "training",
      location: "MSAC",
      status: "scheduled",
      seriesId: null,
      goingCount: 2,
      maybeCount: 1,
      myResponse: null,
      inAudience: true,
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
