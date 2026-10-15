import { describe, expect, it } from "vitest";
import {
  AGENDA_PAGE_SIZE,
  type AgendaPage,
  listAgenda,
  readAgendaTypes,
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
 * La agenda filtrada por tipo (#643, D8 del PRD de E24). El filtro va en la
 * consulta, antes de paginar: si se filtrara después, una página podría
 * llegar vacía con más eventos detrás.
 */

/** Más sociales de los que caben en una página: la segunda trae el resto. */
const SOCIALS_PAST_A_PAGE = AGENDA_PAGE_SIZE + 5;

function agenda(
  options: FakeAgendaClubOptions,
  request: {
    readonly eventTypes?: readonly EventType[];
    readonly cursor?: string;
  } = {},
): Promise<AgendaPage> {
  return listAgenda(fakeAgendaClub(options).gateways, {
    callerId: AGENDA_CALLER_ID,
    period: "upcoming",
    now: AGENDA_NOW,
    ...request,
  });
}

function titlesOf(page: AgendaPage): readonly string[] {
  return page.events.map((event) => event.title);
}

describe("readAgendaTypes", () => {
  it("devuelve nulo, todos los tipos, cuando falta el parámetro", () => {
    expect(readAgendaTypes(null)).toBeNull();
  });

  it("devuelve nulo cuando el parámetro llega vacío", () => {
    expect(readAgendaTypes("")).toBeNull();
  });

  it("lee los tipos válidos separados por comas", () => {
    expect(readAgendaTypes("training,social")).toEqual(["training", "social"]);
  });

  it("ignora un tipo desconocido y se queda con los válidos", () => {
    expect(readAgendaTypes("training,foo")).toEqual(["training"]);
  });

  it("devuelve nulo cuando ningún tipo es válido", () => {
    expect(readAgendaTypes("foo,,bar")).toBeNull();
  });

  it("trata un tipo repetido como uno", () => {
    expect(readAgendaTypes("social,training,social")).toEqual([
      "social",
      "training",
    ]);
  });
});

describe("agenda filtrada por tipo", () => {
  it("devuelve sólo los eventos de los tipos pedidos", async () => {
    const events = [
      clubEvent("2027-06-16", { title: "entreno", eventType: "training" }),
      clubEvent("2027-06-17", { title: "torneo", eventType: "competition" }),
      clubEvent("2027-06-18", { title: "asamblea", eventType: "meeting" }),
      clubEvent("2027-06-19", { title: "barbacoa", eventType: "social" }),
    ];

    const page = await agenda(
      { events },
      { eventTypes: ["training", "social"] },
    );

    expect(titlesOf(page)).toEqual(["entreno", "barbacoa"]);
  });

  it("mantiene la audiencia de quien no organiza", async () => {
    const events = [
      seniorSquadEvent("2027-06-16", { title: "ajeno", eventType: "social" }),
      clubEvent("2027-06-17", { title: "del club", eventType: "social" }),
    ];

    const page = await agenda(
      { callerGroupIds: [MASTERS_SQUAD.id], events },
      { eventTypes: ["social"] },
    );

    expect(titlesOf(page)).toEqual(["del club"]);
  });

  it("devuelve todos los tipos cuando no se pide ninguno", async () => {
    const events = [
      clubEvent("2027-06-16", { title: "entreno", eventType: "training" }),
      clubEvent("2027-06-17", { title: "torneo", eventType: "competition" }),
    ];

    const page = await agenda({ events });

    expect(titlesOf(page)).toEqual(["entreno", "torneo"]);
  });

  it("pagina el filtro sin saltar ni repetir eventos", async () => {
    // Un social y un entreno alternos, para que cortar antes de filtrar deje
    // la mitad de la primera página fuera.
    const events = Array.from({ length: 2 * SOCIALS_PAST_A_PAGE }, (_, index) =>
      clubEvent("2027-06-20", {
        title: `evento ${index}`,
        eventType: index % 2 === 0 ? "social" : "training",
      }),
    );
    const socials = events.filter((event) => event.eventType === "social");
    const options = { events };

    const first = await agenda(options, { eventTypes: ["social"] });
    const second = await agenda(options, {
      eventTypes: ["social"],
      cursor: first.nextCursor ?? "",
    });

    expect(first.events).toHaveLength(AGENDA_PAGE_SIZE);
    expect([...titlesOf(first), ...titlesOf(second)]).toEqual(
      socials.map((event) => event.title),
    );
    expect(second.nextCursor).toBeNull();
  });
});
