import { afterEach, describe, expect, it, vi } from "vitest";
import { type RsvpResponse, respondToEvent } from "@/lib/events/event-rsvp";
import type { PublishedSeat } from "@/lib/events/team-player-notices";
import {
  CLUB_EVENT_ID,
  type FakeRsvpClub,
  type FakeRsvpClubOptions,
  RSVP_CALLER_ID,
  RSVP_NOW,
  fakeRsvpClub,
} from "../helpers/event-rsvp-club";

/**
 * A quien publicó el reparto le llega un aviso cuando un jugador suyo deja de
 * ir o vuelve a ir (#838). Se decide al responder, en el dominio, con la
 * respuesta anterior y el sitio del jugador en el reparto publicado.
 */

const PUBLISHER_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const ADMIN_ID = "adadadad-0000-4000-8000-00000000000a";
const OTHER_ADMIN_ID = "adadadad-0000-4000-8000-00000000000b";
const PUBLISHED_AT = new Date(RSVP_NOW.getTime() - 60 * 60_000);
const ONE_MINUTE = 60_000;

const SEAT: PublishedSeat = {
  publishedAt: PUBLISHED_AT,
  publishedBy: PUBLISHER_ID,
  teamName: "Team Kelp",
};

const CHANGE_DATA = {
  eventId: CLUB_EVENT_ID,
  title: "Entrenamiento",
  playerId: RSVP_CALLER_ID,
  playerName: "Quien responde",
  teamName: "Team Kelp",
};

/** Responde en orden, un minuto después de la anterior cada vez. */
async function answer(
  club: FakeRsvpClub,
  responses: readonly RsvpResponse[],
  startAt: Date = RSVP_NOW,
): Promise<void> {
  for (const [index, response] of responses.entries()) {
    await respondToEvent(club.gateways, {
      callerId: RSVP_CALLER_ID,
      eventId: CLUB_EVENT_ID,
      response,
      now: new Date(startAt.getTime() + index * ONE_MINUTE),
    });
  }
}

async function noticesAfter(
  responses: readonly RsvpResponse[],
  options: FakeRsvpClubOptions = { seat: SEAT },
): Promise<FakeRsvpClub["notices"]> {
  const club = fakeRsvpClub(options);
  await answer(club, responses);
  return club.notices;
}

function typesOf(notices: FakeRsvpClub["notices"]): readonly string[] {
  return notices.map((notice) => notice.type);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("avisos de quien ya no viene o vuelve", () => {
  it.each<RsvpResponse>(["yes", "maybe"])(
    "avisa a quien publicó cuando un asignado pasa de %s a no",
    async (before) => {
      const notices = await noticesAfter([before, "no"]);

      expect(notices).toEqual([
        {
          type: "team_player_dropped",
          userId: PUBLISHER_ID,
          data: CHANGE_DATA,
          sentAt: expect.any(Date),
        },
      ]);
    },
  );

  it("avisa que vuelve a ir cuando responde sí después de no", async () => {
    const notices = await noticesAfter(["yes", "no", "maybe"]);

    expect(
      notices.map(({ type, userId, data }) => ({ type, userId, data })),
    ).toEqual([
      { type: "team_player_dropped", userId: PUBLISHER_ID, data: CHANGE_DATA },
      { type: "team_player_returned", userId: PUBLISHER_ID, data: CHANGE_DATA },
    ]);
  });

  it("como mucho avisa una vez de cada tipo por publicación", async () => {
    const notices = await noticesAfter(["yes", "no", "yes", "no", "yes", "no"]);

    expect(typesOf(notices)).toEqual([
      "team_player_dropped",
      "team_player_returned",
    ]);
  });

  it("al volver a publicar el reparto cuenta los avisos desde cero", async () => {
    const club = fakeRsvpClub({ seat: SEAT });
    await answer(club, ["yes", "no", "yes"]);
    const republishedAt = new Date(RSVP_NOW.getTime() + 10 * ONE_MINUTE);
    club.republish(republishedAt);

    await answer(
      club,
      ["no", "yes"],
      new Date(republishedAt.getTime() + ONE_MINUTE),
    );

    expect(typesOf(club.notices)).toEqual([
      "team_player_dropped",
      "team_player_returned",
      "team_player_dropped",
      "team_player_returned",
    ]);
  });

  it("no avisa sin reparto publicado o a quien no está en él", async () => {
    const notices = await noticesAfter(["yes", "no", "yes"], {});

    expect(notices).toEqual([]);
  });

  it.each<[RsvpResponse, RsvpResponse]>([
    ["yes", "maybe"],
    ["maybe", "yes"],
  ])("no avisa al pasar de %s a %s", async (before, after) => {
    const notices = await noticesAfter([before, after]);

    expect(notices).toEqual([]);
  });

  it("no avisa a quien responde no por primera vez", async () => {
    const notices = await noticesAfter(["no"]);

    expect(notices).toEqual([]);
  });

  it("no avisa que vuelve a quien no se avisó que se iba en esta publicación", async () => {
    const club = fakeRsvpClub({
      seat: {
        ...SEAT,
        publishedAt: new Date(RSVP_NOW.getTime() + ONE_MINUTE / 2),
      },
    });

    await answer(club, ["no", "yes"]);

    expect(club.notices).toEqual([]);
  });

  it("no se avisa a sí mismo quien publicó el reparto", async () => {
    const notices = await noticesAfter(["yes", "no"], {
      seat: { ...SEAT, publishedBy: RSVP_CALLER_ID },
      activeAdminIds: [ADMIN_ID],
    });

    expect(notices).toEqual([]);
  });

  it("sin quien publicó avisa a los Admin activos, sin quien responde", async () => {
    const notices = await noticesAfter(["yes", "no"], {
      seat: { ...SEAT, publishedBy: null },
      activeAdminIds: [ADMIN_ID, OTHER_ADMIN_ID, RSVP_CALLER_ID],
    });

    expect(notices.map(({ type, userId }) => ({ type, userId }))).toEqual([
      { type: "team_player_dropped", userId: ADMIN_ID },
      { type: "team_player_dropped", userId: OTHER_ADMIN_ID },
    ]);
  });

  it("guarda la respuesta aunque el aviso falle, y deja el fallo en el log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const club = fakeRsvpClub({ seat: SEAT, isNotifyingFailing: true });

    await answer(club, ["yes", "no"]);

    expect([...club.saved.values()].map(({ response }) => response)).toEqual([
      "no",
    ]);
    expect(log).toHaveBeenCalled();
  });

  it("guarda la respuesta aunque no se pueda leer el reparto, y deja el fallo en el log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const club = fakeRsvpClub({ seat: SEAT, isSeatLookupFailing: true });

    await expect(answer(club, ["yes", "no"])).resolves.toBeUndefined();

    expect([...club.saved.values()].map(({ response }) => response)).toEqual([
      "no",
    ]);
    expect(log).toHaveBeenCalledWith(
      "[events] aviso de reparto sin mandar",
      expect.objectContaining({ eventId: CLUB_EVENT_ID }),
    );
  });
});
