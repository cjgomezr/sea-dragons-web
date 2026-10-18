import { describe, expect, it } from "vitest";
import {
  AGENDA_PAGE_SIZE,
  type AgendaPage,
  listAgenda,
} from "@/lib/events/event-agenda";
import type { EventType } from "@/lib/events/event-creation";
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
 * Los pasados desde una fecha (#710). `from` es el día por el que empieza la
 * lista; de ahí sigue hacia atrás como Pasados, y el cursor lo continúa si se
 * pide con el mismo `from`.
 */

/** Más eventos de los que caben en una página: la segunda trae el resto. */
const EVENTS_PAST_A_PAGE = AGENDA_PAGE_SIZE + 5;

function pastFrom(
  options: FakeAgendaClubOptions,
  request: {
    readonly from: string;
    readonly eventTypes?: readonly EventType[];
    readonly cursor?: string;
  },
): Promise<AgendaPage> {
  return listAgenda(fakeAgendaClub(options).gateways, {
    callerId: AGENDA_CALLER_ID,
    period: "past",
    now: AGENDA_NOW,
    ...request,
  });
}

function titlesOf(page: AgendaPage): readonly string[] {
  return page.events.map((event) => event.title);
}

describe("pasados desde una fecha", () => {
  it("empieza en ese día y sigue hacia atrás", async () => {
    const events = [
      clubEvent("2027-06-01", { title: "1 de junio" }),
      clubEvent("2027-06-08", { title: "8 de junio" }),
      clubEvent("2027-06-09", { title: "9 de junio" }),
      clubEvent("2027-06-14", { title: "ayer" }),
    ];

    const page = await pastFrom({ events }, { from: "2027-06-08" });

    expect(titlesOf(page)).toEqual(["8 de junio", "1 de junio"]);
  });

  it("empieza en el día anterior más cercano si ese día no tiene eventos", async () => {
    const events = [
      clubEvent("2027-06-01", { title: "1 de junio" }),
      clubEvent("2027-06-03", { title: "3 de junio" }),
      clubEvent("2027-06-09", { title: "9 de junio" }),
    ];

    const page = await pastFrom({ events }, { from: "2027-06-07" });

    expect(titlesOf(page)).toEqual(["3 de junio", "1 de junio"]);
  });

  it("devuelve una página vacía si la fecha es anterior a todo", async () => {
    const events = [clubEvent("2027-06-01"), clubEvent("2027-06-03")];

    const page = await pastFrom({ events }, { from: "2027-05-01" });

    expect(page).toEqual({ events: [], nextCursor: null });
  });

  it("nunca trae hoy aunque la fecha sea posterior", async () => {
    const events = [
      clubEvent("2027-06-14", { title: "ayer" }),
      clubEvent("2027-06-15", { title: "hoy" }),
    ];

    const page = await pastFrom({ events }, { from: "2027-06-20" });

    expect(titlesOf(page)).toEqual(["ayer"]);
  });

  it("el cursor sigue hacia atrás desde la fecha sin saltar ni repetir", async () => {
    const events = Array.from({ length: EVENTS_PAST_A_PAGE }, (_, index) =>
      clubEvent("2027-06-05", { title: `evento ${index}` }),
    );
    const later = clubEvent("2027-06-10", { title: "después del salto" });
    const options = { events: [...events, later] };

    const first = await pastFrom(options, { from: "2027-06-08" });
    const second = await pastFrom(options, {
      from: "2027-06-08",
      cursor: first.nextCursor ?? "",
    });

    expect(first.events).toHaveLength(AGENDA_PAGE_SIZE);
    expect([...titlesOf(first), ...titlesOf(second)]).toEqual(
      events.map((event) => event.title).reverse(),
    );
    expect(second.nextCursor).toBeNull();
  });

  it("conserva el filtro de tipo", async () => {
    const events = [
      clubEvent("2027-06-04", { title: "entreno", eventType: "training" }),
      clubEvent("2027-06-05", { title: "barbacoa", eventType: "social" }),
      clubEvent("2027-06-11", {
        title: "entreno tarde",
        eventType: "training",
      }),
    ];

    const page = await pastFrom(
      { events },
      { from: "2027-06-08", eventTypes: ["training"] },
    );

    expect(titlesOf(page)).toEqual(["entreno"]);
  });

  it("aplica la misma visibilidad por grupos que Pasados", async () => {
    const events = [
      seniorSquadEvent("2027-06-08", { title: "ajeno" }),
      clubEvent("2027-06-07", { title: "del club" }),
    ];

    const page = await pastFrom(
      { callerGroupIds: [MASTERS_SQUAD.id], events },
      { from: "2027-06-08" },
    );

    expect(titlesOf(page)).toEqual(["del club"]);
  });
});
