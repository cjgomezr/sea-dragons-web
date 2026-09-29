import { describe, expect, it } from "vitest";
import { EventNotFoundError } from "@/lib/events/event-rsvp";
import { openMyTeam } from "@/lib/teams/my-team";
import {
  DEFAULT_TEAM_LABELS,
  type StoredTeamSplit,
} from "@/lib/teams/team-builder";
import {
  EVENT_ID,
  type FakePlayer,
  type FakeTeamsClubOptions,
  PUBLISHED_AT,
  SCRIMMAGE,
  SENIOR_SQUAD_ID,
  TEAMS_CALLER_ID,
  fakeTeamsClub,
} from "../helpers/team-builder-club";
import { FORWARD, GOALKEEPER } from "../helpers/seeded-positions";

/**
 * Lo que ve el jugador de un reparto publicado (#401, RF-8 del PRD de E10,
 * FR-048, D3): su equipo y la alineación, nunca un OVR.
 */

const ME: FakePlayer = {
  userId: TEAMS_CALLER_ID,
  fullName: "Pablo Player",
  positionId: GOALKEEPER.id,
  ratings: [9],
};
const ANA: FakePlayer = {
  userId: "4e4e4e4e-0000-4000-8000-000000000001",
  fullName: "Ana Zamora",
  positionId: FORWARD.id,
  ratings: [8],
};

const PUBLISHED: StoredTeamSplit = {
  teams: DEFAULT_TEAM_LABELS,
  mode: "auto",
  publishedAt: PUBLISHED_AT,
  assignments: [
    { userId: ME.userId, team: "b" },
    { userId: ANA.userId, team: "a" },
  ],
};

function openFor(options: FakeTeamsClubOptions) {
  return openMyTeam(
    fakeTeamsClub({
      callerRole: "Player",
      players: [ME, ANA],
      positions: [GOALKEEPER, FORWARD],
      ...options,
    }).myTeamGateways,
    { callerId: TEAMS_CALLER_ID, eventId: EVENT_ID },
  );
}

const GOALKEEPER_NAMED = { id: GOALKEEPER.id, names: GOALKEEPER.names };
const FORWARD_NAMED = { id: FORWARD.id, names: FORWARD.names };

describe("mi equipo", () => {
  it("da al asignado su equipo, su posición y las dos alineaciones", async () => {
    const team = await openFor({ split: PUBLISHED });

    expect(team).toEqual({
      status: "published",
      publishedAt: PUBLISHED_AT.toISOString(),
      me: { team: "b", position: GOALKEEPER_NAMED },
      teams: {
        a: {
          ...DEFAULT_TEAM_LABELS.a,
          players: [
            {
              userId: ANA.userId,
              fullName: ANA.fullName,
              position: FORWARD_NAMED,
            },
          ],
        },
        b: {
          ...DEFAULT_TEAM_LABELS.b,
          players: [
            {
              userId: ME.userId,
              fullName: ME.fullName,
              position: GOALKEEPER_NAMED,
            },
          ],
        },
      },
    });
  });

  it("no lleva ningún OVR en la respuesta", async () => {
    const team = await openFor({ split: PUBLISHED });

    expect(JSON.stringify(team)).not.toMatch(/rating/i);
  });

  it("da a la audiencia sin asignar la alineación y que no está en ninguno", async () => {
    const team = await openFor({
      split: {
        ...PUBLISHED,
        assignments: [{ userId: ANA.userId, team: "a" }],
      },
    });

    expect(team).toMatchObject({ status: "published", me: null });
  });

  it.each([
    ["en borrador", { ...PUBLISHED, publishedAt: null }],
    ["inexistente", null],
  ] as const)(
    "responde que no hay equipos publicados con un reparto %s",
    async (_, split) => {
      await expect(openFor({ split })).resolves.toEqual({
        status: "not_published",
      });
    },
  );

  it("no encuentra el evento de otro grupo si no juega en él", async () => {
    const seniors = {
      ...SCRIMMAGE,
      audience: { kind: "groups" as const, groupIds: [SENIOR_SQUAD_ID] },
    };

    await expect(
      openFor({ events: [seniors], split: null }),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("sirve el reparto a quien juega en él aunque salió de la audiencia", async () => {
    const seniors = {
      ...SCRIMMAGE,
      audience: { kind: "groups" as const, groupIds: [SENIOR_SQUAD_ID] },
    };

    await expect(
      openFor({ events: [seniors], split: PUBLISHED }),
    ).resolves.toMatchObject({ me: { team: "b" } });
  });

  it("sirve el reparto a quien está en el grupo del evento", async () => {
    const seniors = {
      ...SCRIMMAGE,
      audience: { kind: "groups" as const, groupIds: [SENIOR_SQUAD_ID] },
    };

    await expect(
      openFor({
        events: [seniors],
        callerGroupIds: [SENIOR_SQUAD_ID],
        split: { ...PUBLISHED, assignments: [] },
      }),
    ).resolves.toMatchObject({ status: "published", me: null });
  });

  it("no encuentra un evento que no existe", async () => {
    await expect(
      openMyTeam(fakeTeamsClub({}).myTeamGateways, {
        callerId: TEAMS_CALLER_ID,
        eventId: "e1e1e1e1-0000-4000-8000-0000000000ff",
      }),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });
});
