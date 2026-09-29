import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  DEFAULT_TEAM_LABELS,
  type StoredTeamSplit,
  type TeamAssignment,
  TeamBuilderForbiddenError,
  TeamEventClosedError,
  TeamSplitEmptyError,
} from "@/lib/teams/team-builder";
import { publishTeamSplit } from "@/lib/teams/team-publication";
import {
  EVENT_ID,
  type FakeTeamsClubOptions,
  PUBLISHED_AT,
  SCRIMMAGE,
  TEAMS_CALLER_ID,
  TEAMS_NOW,
  fakeTeamsClub,
  playerId,
} from "../helpers/team-builder-club";

/**
 * Publicar el reparto (#401, RF-7 del PRD de E10, FR-049, AC-020, D6): quién
 * recibe aviso, con qué, y qué queda en la bitácora.
 */

const ANA = playerId(1);
const BRUNO = playerId(2);
const CARLA = playerId(3);
const DIEGO = playerId(4);

const KELP = DEFAULT_TEAM_LABELS.a;
const TIDE = DEFAULT_TEAM_LABELS.b;

function draftWith(assignments: readonly TeamAssignment[]): StoredTeamSplit {
  return {
    teams: DEFAULT_TEAM_LABELS,
    mode: "manual",
    publishedAt: null,
    assignments,
  };
}

function publish(options: FakeTeamsClubOptions) {
  const club = fakeTeamsClub(options);
  const publishing = publishTeamSplit(club.gateways, {
    callerId: TEAMS_CALLER_ID,
    eventId: EVENT_ID,
    now: TEAMS_NOW,
  });
  return { club, publishing };
}

const EVENT_DATA = {
  eventId: EVENT_ID,
  title: SCRIMMAGE.title,
  startsOn: SCRIMMAGE.startsOn,
  startTime: SCRIMMAGE.startTime,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("publicar", () => {
  it("avisa a cada asignado con el evento, su equipo y su color", async () => {
    const { club, publishing } = publish({
      split: draftWith([
        { userId: ANA, team: "a" },
        { userId: BRUNO, team: "b" },
      ]),
    });

    await expect(publishing).resolves.toEqual({
      eventId: EVENT_ID,
      publishedAt: PUBLISHED_AT.toISOString(),
      assignedCount: 2,
      notifiedCount: 2,
    });
    expect(club.notices).toEqual([
      {
        type: "team_assigned",
        userId: ANA,
        data: { ...EVENT_DATA, teamName: KELP.name, teamColor: KELP.color },
      },
      {
        type: "team_assigned",
        userId: BRUNO,
        data: { ...EVENT_DATA, teamName: TIDE.name, teamColor: TIDE.color },
      },
    ]);
    expect(club.split()?.publishedAt).toEqual(PUBLISHED_AT);
  });

  it("no avisa a quien publica aunque juegue", async () => {
    const { club, publishing } = publish({
      split: draftWith([
        { userId: ANA, team: "a" },
        { userId: TEAMS_CALLER_ID, team: "b" },
      ]),
    });

    await expect(publishing).resolves.toMatchObject({
      assignedCount: 2,
      notifiedCount: 1,
    });
    expect(club.notices.map((notice) => notice.userId)).toEqual([ANA]);
  });

  it("al republicar avisa sólo a quien cambió de equipo, entró o salió", async () => {
    const { club, publishing } = publish({
      publishedAssignments: [
        { userId: ANA, team: "a" },
        { userId: BRUNO, team: "b" },
        { userId: CARLA, team: "a" },
      ],
      split: draftWith([
        { userId: ANA, team: "a" },
        { userId: BRUNO, team: "a" },
        { userId: DIEGO, team: "b" },
      ]),
    });

    await expect(publishing).resolves.toMatchObject({ notifiedCount: 3 });
    expect(club.notices.map((notice) => [notice.type, notice.userId])).toEqual([
      ["team_assigned", BRUNO],
      ["team_assigned", DIEGO],
      ["team_unassigned", CARLA],
    ]);
    expect(club.notices[2]?.data).toEqual(EVENT_DATA);
  });

  it("publicar dos veces sin cambios no avisa la segunda", async () => {
    const assignments: readonly TeamAssignment[] = [{ userId: ANA, team: "a" }];
    const { club, publishing } = publish({
      publishedAssignments: assignments,
      split: draftWith(assignments),
    });

    await expect(publishing).resolves.toMatchObject({ notifiedCount: 0 });
    expect(club.notices).toEqual([]);
  });

  it("deja en la bitácora quién, qué evento y cuántos, sin nombres", async () => {
    const { club, publishing } = publish({
      split: draftWith([
        { userId: ANA, team: "a" },
        { userId: BRUNO, team: "b" },
      ]),
    });
    await publishing;

    expect(club.auditRows).toEqual([
      expect.objectContaining({
        actor_id: TEAMS_CALLER_ID,
        action: "team_split.published",
        entity_type: "event",
        entity_id: EVENT_ID,
        result: "success",
        metadata: { assignedCount: 2 },
      }),
    ]);
  });

  it("queda publicado aunque fallen los avisos, y el fallo va al log", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { club, publishing } = publish({
      failingNotifications: true,
      split: draftWith([{ userId: ANA, team: "a" }]),
    });

    await expect(publishing).resolves.toMatchObject({ assignedCount: 1 });
    expect(club.split()?.publishedAt).toEqual(PUBLISHED_AT);
    expect(logged).toHaveBeenCalled();
  });

  it("avisa aunque falle la bitácora, que ya no puede deshacer lo publicado", async () => {
    const { club, publishing } = publish({
      failingAudit: true,
      split: draftWith([{ userId: ANA, team: "a" }]),
    });

    await expect(publishing).rejects.toThrow();
    expect(club.split()?.publishedAt).toEqual(PUBLISHED_AT);
    expect(club.notices.map((notice) => notice.userId)).toEqual([ANA]);
  });

  it("responde que el reparto está vacío si no tiene a nadie", async () => {
    const { club, publishing } = publish({ split: draftWith([]) });

    await expect(publishing).rejects.toBeInstanceOf(TeamSplitEmptyError);
    expect(club.auditRows).toEqual([]);
  });

  it("responde que el reparto está vacío si no hay reparto", async () => {
    const { publishing } = publish({});

    await expect(publishing).rejects.toBeInstanceOf(TeamSplitEmptyError);
  });

  it("rechaza publicar un evento cancelado", async () => {
    const { publishing } = publish({
      events: [{ ...SCRIMMAGE, status: "cancelled" }],
      split: draftWith([{ userId: ANA, team: "a" }]),
    });

    await expect(publishing).rejects.toEqual(
      new TeamEventClosedError("team_event_cancelled"),
    );
  });

  it.each<Role>(["Committee", "Player"])(
    "niega publicar a un %s",
    async (callerRole) => {
      const { club, publishing } = publish({
        callerRole,
        split: draftWith([{ userId: ANA, team: "a" }]),
      });

      await expect(publishing).rejects.toBeInstanceOf(
        TeamBuilderForbiddenError,
      );
      expect(club.notices).toEqual([]);
    },
  );
});
