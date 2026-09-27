import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  EventNotFoundError,
  RsvpClosedError,
  respondToEvent,
} from "@/lib/events/event-rsvp";
import {
  CLUB_EVENT_ID,
  type FakeRsvpClubOptions,
  MASTERS_SQUAD_ID,
  OTHER_CLUB_ID,
  RSVP_CALLER_ID,
  RSVP_CLUB_ID,
  RSVP_NOW,
  SENIOR_SQUAD_ID,
  UPCOMING_EVENT,
  fakeRsvpClub,
} from "../helpers/event-rsvp-club";

/**
 * Responder a un evento (#308, RF-5 del PRD de E7, FR-034 y FR-035), contado
 * sin Supabase delante. La hora que decide es la que recibe el dominio, que el
 * endpoint toma del servidor.
 */

const SENIOR_EVENT_ID = "e2e2e2e2-0000-4000-8000-00000000000e";
const SERIES_TUESDAY_ID = "e3e3e3e3-0000-4000-8000-00000000000e";
const SERIES_THURSDAY_ID = "e4e4e4e4-0000-4000-8000-00000000000e";

const SENIOR_EVENT = {
  ...UPCOMING_EVENT,
  id: SENIOR_EVENT_ID,
  audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
} as const;

function respond(
  options: FakeRsvpClubOptions,
  request: {
    readonly eventId?: string;
    readonly response: "yes" | "maybe" | "no";
    readonly now?: Date;
  },
) {
  const club = fakeRsvpClub(options);
  const result = respondToEvent(club.gateways, {
    callerId: RSVP_CALLER_ID,
    eventId: request.eventId ?? CLUB_EVENT_ID,
    response: request.response,
    now: request.now ?? RSVP_NOW,
  });
  return { club, result };
}

describe("responder a un evento", () => {
  it("guarda la última respuesta con su hora, en una sola fila", async () => {
    const club = fakeRsvpClub();
    const later = new Date(RSVP_NOW.getTime() + 60_000);

    await respondToEvent(club.gateways, {
      callerId: RSVP_CALLER_ID,
      eventId: CLUB_EVENT_ID,
      response: "maybe",
      now: RSVP_NOW,
    });
    const answer = await respondToEvent(club.gateways, {
      callerId: RSVP_CALLER_ID,
      eventId: CLUB_EVENT_ID,
      response: "yes",
      now: later,
    });

    expect(answer).toEqual({
      eventId: CLUB_EVENT_ID,
      response: "yes",
      respondedAt: later.toISOString(),
    });
    expect([...club.saved.values()]).toEqual([
      {
        clubId: RSVP_CLUB_ID,
        eventId: CLUB_EVENT_ID,
        userId: RSVP_CALLER_ID,
        response: "yes",
        respondedAt: later,
      },
    ]);
  });

  it("deja responder a un miembro de uno de los grupos de la audiencia", async () => {
    const { result } = respond(
      {
        callerGroupIds: [MASTERS_SQUAD_ID, SENIOR_SQUAD_ID],
        events: [SENIOR_EVENT],
      },
      { eventId: SENIOR_EVENT_ID, response: "no" },
    );

    await expect(result).resolves.toMatchObject({ response: "no" });
  });

  it("rechaza responder cuando el evento ya empezó", async () => {
    const { club, result } = respond(
      {},
      { response: "yes", now: UPCOMING_EVENT.startsAt },
    );

    await expect(result).rejects.toMatchObject({
      name: RsvpClosedError.name,
      code: "rsvp_event_started",
    });
    expect(club.saved.size).toBe(0);
  });

  it("rechaza responder a un evento cancelado", async () => {
    const { club, result } = respond(
      { events: [{ ...UPCOMING_EVENT, status: "cancelled" }] },
      { response: "yes" },
    );

    await expect(result).rejects.toMatchObject({
      name: RsvpClosedError.name,
      code: "rsvp_event_cancelled",
    });
    expect(club.saved.size).toBe(0);
  });

  it.each(["Admin", "Committee", "Coach", "Player"] as const)(
    "responde que no existe a un %s fuera de la audiencia",
    async (callerRole) => {
      const { club, result } = respond(
        {
          callerRole,
          callerGroupIds: [MASTERS_SQUAD_ID],
          events: [SENIOR_EVENT],
        },
        { eventId: SENIOR_EVENT_ID, response: "yes" },
      );

      await expect(result).rejects.toBeInstanceOf(EventNotFoundError);
      expect(club.saved.size).toBe(0);
    },
  );

  it("responde que no existe a quien está fuera aunque el evento esté cancelado", async () => {
    const { result } = respond(
      { events: [{ ...SENIOR_EVENT, status: "cancelled" }] },
      { eventId: SENIOR_EVENT_ID, response: "yes" },
    );

    await expect(result).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("trata una audiencia de grupos sin grupos como fuera para todos", async () => {
    const { result } = respond(
      {
        callerGroupIds: [SENIOR_SQUAD_ID],
        events: [
          { ...SENIOR_EVENT, audience: { kind: "groups", groupIds: [] } },
        ],
      },
      { eventId: SENIOR_EVENT_ID, response: "yes" },
    );

    await expect(result).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("responde que no existe a un evento de otro club", async () => {
    const { result } = respond(
      { events: [{ ...UPCOMING_EVENT, clubId: OTHER_CLUB_ID }] },
      { response: "yes" },
    );

    await expect(result).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("responde que no existe a un evento que no existe", async () => {
    const { result } = respond({ events: [] }, { response: "yes" });

    await expect(result).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("guarda la respuesta a una ocurrencia sin tocar las otras de la serie", async () => {
    const club = fakeRsvpClub({
      events: [
        { ...UPCOMING_EVENT, id: SERIES_TUESDAY_ID },
        { ...UPCOMING_EVENT, id: SERIES_THURSDAY_ID },
      ],
    });

    await respondToEvent(club.gateways, {
      callerId: RSVP_CALLER_ID,
      eventId: SERIES_THURSDAY_ID,
      response: "maybe",
      now: RSVP_NOW,
    });

    expect([...club.saved.values()].map((rsvp) => rsvp.eventId)).toEqual([
      SERIES_THURSDAY_ID,
    ]);
  });

  it("rechaza a quien no tiene fila de miembro", async () => {
    const { result } = respond({ callerIsMember: false }, { response: "yes" });

    await expect(result).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
