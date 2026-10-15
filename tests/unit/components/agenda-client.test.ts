import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agendaEventSchema,
  loadAgenda,
} from "@/components/calendar/agenda-client";

/**
 * La forma de un evento de la agenda como la lee la pantalla (#642, RF-2 del
 * PRD de E24): la hora y la fecha de fin llegan siempre, nulas en lo anterior
 * a E24 y en un evento de un día. Y los tipos que pide (#643): van en la
 * consulta, y sin ninguno no van.
 */

const AGENDA_EVENT = {
  id: "e0000000-0000-4000-8000-000000000001",
  startsOn: "2027-06-26",
  startTime: "08:30",
  endTime: "17:00",
  endsOn: "2027-06-27",
  title: "Torneo",
  eventType: "competition",
  location: "MSAC",
  place: null,
  placeDetail: null,
  status: "scheduled",
  seriesId: null,
  goingCount: 0,
  maybeCount: 0,
  myResponse: null,
  inAudience: true,
};

/** Sirve una agenda vacía y devuelve las URL que se pidieron. */
function serveEmptyAgenda(): string[] {
  const requestedUrls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return Response.json({ data: { events: [], nextCursor: null } });
    }),
  );
  return requestedUrls;
}

function typesParamOf(url: string | undefined): string | null {
  return new URL(url ?? "", "http://localhost").searchParams.get("types");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadAgenda", () => {
  it("manda los tipos pedidos en la consulta", async () => {
    const requestedUrls = serveEmptyAgenda();

    await loadAgenda("upcoming", "cursor-1", ["training", "social"]);

    expect(typesParamOf(requestedUrls[0])).toBe("training,social");
  });

  it("no manda tipos cuando no se pide ninguno", async () => {
    const requestedUrls = serveEmptyAgenda();

    await loadAgenda("past", null, []);

    expect(typesParamOf(requestedUrls[0])).toBeNull();
  });
});

describe("agendaEventSchema", () => {
  it("lee la hora y la fecha de fin de un evento de varios días", () => {
    expect(agendaEventSchema.parse(AGENDA_EVENT)).toMatchObject({
      endTime: "17:00",
      endsOn: "2027-06-27",
    });
  });

  it("lee nulas la hora y la fecha de fin de un evento anterior a E24", () => {
    const legacy = { ...AGENDA_EVENT, endTime: null, endsOn: null };

    expect(agendaEventSchema.parse(legacy)).toMatchObject({
      endTime: null,
      endsOn: null,
    });
  });

  it("lee el lugar elegido con sus coordenadas y dónde exactamente", () => {
    const place = {
      name: "MSAC",
      address: "Aughtie Dr, Albert Park VIC 3206",
      lat: -37.8423,
      lng: 144.9601,
    };

    const parsed = agendaEventSchema.parse({
      ...AGENDA_EVENT,
      place,
      placeDetail: "Piscina de buceo",
    });

    expect(parsed).toMatchObject({ place, placeDetail: "Piscina de buceo" });
  });

  it("rechaza un lugar con una sola coordenada", () => {
    const place = { name: "MSAC", address: null, lat: -37.8423, lng: null };

    expect(
      agendaEventSchema.safeParse({ ...AGENDA_EVENT, place }).success,
    ).toBe(false);
  });

  it("rechaza un evento sin la hora de fin", () => {
    const withoutEnd: Record<string, unknown> = { ...AGENDA_EVENT };
    delete withoutEnd.endTime;

    expect(agendaEventSchema.safeParse(withoutEnd).success).toBe(false);
  });
});
