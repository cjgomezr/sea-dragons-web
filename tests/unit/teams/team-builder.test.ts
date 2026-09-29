import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import { EventNotFoundError } from "@/lib/events/event-rsvp";
import {
  DEFAULT_TEAM_LABELS,
  type StoredTeamSplit,
  type TeamAssignment,
  TeamBuilderForbiddenError,
  TeamEventClosedError,
  TeamPlayerOutsideSquadError,
  TeamSplitInvalidError,
  TeamSquadEmptyError,
  autoBalanceEventTeams,
  openTeamBuilder,
  saveTeamSplit,
} from "@/lib/teams/team-builder";
import {
  EVENT_ID,
  type FakePlayer,
  type FakeTeamsClubOptions,
  OTHER_CLUB_ID,
  SCRIMMAGE,
  TEAMS_CALLER_ID,
  TEAMS_NOW,
  fakeTeamsClub,
  playerId,
} from "../helpers/team-builder-club";
import { GOALKEEPER } from "../helpers/seeded-positions";

/**
 * El team builder del coach (#401, RF-3 a RF-5 del PRD de E10), contado sin
 * Supabase delante. La hora que decide si el evento ya pasó es la que recibe
 * el dominio, que el endpoint toma del servidor.
 */

const ANA: FakePlayer = {
  userId: playerId(1),
  fullName: "Ana Zamora",
  response: "yes",
  ratings: [8, 9],
};
const BRUNO: FakePlayer = {
  userId: playerId(2),
  fullName: "Bruno Yáñez",
  response: "yes",
  positionId: GOALKEEPER.id,
  coverage: "goalkeeper",
  ratings: [7],
};
const CARLA: FakePlayer = {
  userId: playerId(3),
  fullName: "Carla Xu",
  response: "maybe",
};
const DIEGO: FakePlayer = {
  userId: playerId(4),
  fullName: "Diego Wu",
  response: "no",
  ratings: [6],
};
const ELENA: FakePlayer = { userId: playerId(5), fullName: "Elena Vidal" };

const EVERYONE = [ANA, BRUNO, CARLA, DIEGO, ELENA];

function open(options: FakeTeamsClubOptions, eventId = EVENT_ID) {
  return openTeamBuilder(fakeTeamsClub(options).gateways, {
    callerId: TEAMS_CALLER_ID,
    eventId,
    now: TEAMS_NOW,
  });
}

function draftWith(assignments: readonly TeamAssignment[]): StoredTeamSplit {
  return {
    teams: DEFAULT_TEAM_LABELS,
    mode: "manual",
    publishedAt: null,
    assignments,
  };
}

const CLOSED_EVENTS = [
  ["team_event_not_buildable", { ...SCRIMMAGE, eventType: "meeting" as const }],
  ["team_event_not_buildable", { ...SCRIMMAGE, eventType: "social" as const }],
  ["team_event_cancelled", { ...SCRIMMAGE, status: "cancelled" as const }],
  ["team_event_past", { ...SCRIMMAGE, startsOn: "2027-06-14" }],
] as const;

describe("la escuadra", () => {
  it.each<Role>(["Coach", "Admin"])(
    "da a un %s los Sí como disponibles y los Quizás aparte, con su OVR",
    async (callerRole) => {
      const builder = await open({
        callerRole,
        players: EVERYONE,
        positions: [GOALKEEPER],
      });

      expect(builder.available).toEqual([
        {
          userId: ANA.userId,
          fullName: ANA.fullName,
          position: null,
          coverage: null,
          rating: 8.5,
          isUnrated: false,
        },
        {
          userId: BRUNO.userId,
          fullName: BRUNO.fullName,
          position: { id: GOALKEEPER.id, names: GOALKEEPER.names },
          coverage: "goalkeeper",
          rating: 7,
          isUnrated: false,
        },
      ]);
      expect(builder.maybe.map((entry) => entry.userId)).toEqual([
        CARLA.userId,
      ]);
    },
  );

  it("marca al no evaluado y le da el 5,0 virtual", async () => {
    const builder = await open({ players: [CARLA] });

    expect(builder.maybe).toEqual([
      expect.objectContaining({ rating: 5, isUnrated: true }),
    ]);
  });

  it("deja fuera a quien dijo No y a quien no respondió", async () => {
    const builder = await open({ players: EVERYONE });

    const listed = [...builder.available, ...builder.maybe].map(
      (entry) => entry.userId,
    );
    expect(listed).not.toContain(DIEGO.userId);
    expect(listed).not.toContain(ELENA.userId);
  });

  it("da el evento, los equipos por defecto y ningún reparto si no hay", async () => {
    const builder = await open({ players: [ANA] });

    expect(builder.event).toEqual({
      id: EVENT_ID,
      title: SCRIMMAGE.title,
      eventType: "training",
      startsOn: SCRIMMAGE.startsOn,
      startTime: SCRIMMAGE.startTime,
    });
    expect(builder.teams).toEqual(DEFAULT_TEAM_LABELS);
    expect(builder.split).toBeNull();
  });

  it("deja armar una competición y un evento de hoy aunque ya empezó", async () => {
    const competition = { ...SCRIMMAGE, eventType: "competition" as const };
    const today = { ...SCRIMMAGE, startsOn: "2027-06-15", startTime: "07:00" };

    await expect(open({ events: [competition] })).resolves.toBeDefined();
    await expect(open({ events: [today] })).resolves.toBeDefined();
  });

  it("marca fuera de la escuadra a un asignado que cambió a No", async () => {
    const builder = await open({
      players: [ANA, DIEGO],
      split: draftWith([
        { userId: ANA.userId, team: "a" },
        { userId: DIEGO.userId, team: "b" },
      ]),
    });

    expect(builder.split?.assignments).toEqual([
      expect.objectContaining({
        userId: ANA.userId,
        team: "a",
        isOutsideSquad: false,
      }),
      expect.objectContaining({
        userId: DIEGO.userId,
        fullName: DIEGO.fullName,
        team: "b",
        rating: 6,
        isOutsideSquad: true,
      }),
    ]);
  });

  it.each(CLOSED_EVENTS)("rechaza con %s", async (code, event) => {
    await expect(open({ events: [event] })).rejects.toEqual(
      new TeamEventClosedError(code),
    );
  });

  it.each<Role>(["Committee", "Player"])(
    "niega la escuadra a un %s",
    async (callerRole) => {
      await expect(open({ callerRole })).rejects.toBeInstanceOf(
        TeamBuilderForbiddenError,
      );
    },
  );

  it("no encuentra un evento de otro club", async () => {
    await expect(
      open({ events: [{ ...SCRIMMAGE, clubId: OTHER_CLUB_ID }] }),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("no encuentra un evento que no existe", async () => {
    await expect(
      open({}, "e1e1e1e1-0000-4000-8000-0000000000ff"),
    ).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it("se la da a un Coach fuera de la audiencia del evento", async () => {
    const groupsOnly = {
      ...SCRIMMAGE,
      audience: { kind: "groups" as const, groupIds: ["otro-grupo"] },
    };

    const builder = await open({ events: [groupsOnly], players: [ANA] });

    expect(builder.available).toHaveLength(1);
  });
});

describe("guardar el reparto", () => {
  function save(
    options: FakeTeamsClubOptions,
    assignments: readonly TeamAssignment[],
  ) {
    const club = fakeTeamsClub({ players: EVERYONE, ...options });
    const saving = saveTeamSplit(club.gateways, {
      callerId: TEAMS_CALLER_ID,
      eventId: EVENT_ID,
      teams: {
        a: { name: "Orcas", color: "#112233" },
        b: { name: "Rayas", color: "#445566" },
      },
      assignments,
      now: TEAMS_NOW,
    });
    return { club, saving };
  }

  it("guarda en borrador con modo manual y los equipos que llegan", async () => {
    const { club, saving } = save({}, [
      { userId: ANA.userId, team: "a" },
      { userId: CARLA.userId, team: "b" },
    ]);
    await saving;

    expect(club.saves).toEqual([
      {
        clubId: SCRIMMAGE.clubId,
        eventId: EVENT_ID,
        savedBy: TEAMS_CALLER_ID,
        mode: "manual",
        teams: {
          a: { name: "Orcas", color: "#112233" },
          b: { name: "Rayas", color: "#445566" },
        },
        assignments: [
          { userId: ANA.userId, team: "a" },
          { userId: CARLA.userId, team: "b" },
        ],
      },
    ]);
  });

  it("no avisa a nadie ni escribe en la bitácora", async () => {
    const { club, saving } = save({}, [{ userId: ANA.userId, team: "a" }]);
    await saving;

    expect(club.notices).toEqual([]);
    expect(club.auditRows).toEqual([]);
  });

  it("guardar otra vez reemplaza el reparto entero", async () => {
    const { club, saving } = save(
      {
        split: draftWith([
          { userId: ANA.userId, team: "a" },
          { userId: BRUNO.userId, team: "b" },
        ]),
      },
      [{ userId: BRUNO.userId, team: "a" }],
    );
    await saving;

    expect(club.split()?.assignments).toEqual([
      { userId: BRUNO.userId, team: "a" },
    ]);
  });

  it("rechaza a alguien fuera de la escuadra sin escribir nada", async () => {
    const { club, saving } = save({}, [
      { userId: ANA.userId, team: "a" },
      { userId: DIEGO.userId, team: "b" },
    ]);

    await expect(saving).rejects.toBeInstanceOf(TeamPlayerOutsideSquadError);
    expect(club.saves).toEqual([]);
  });

  it("rechaza un jugador repetido como petición mal formada", async () => {
    const { club, saving } = save({}, [
      { userId: ANA.userId, team: "a" },
      { userId: ANA.userId, team: "b" },
    ]);

    await expect(saving).rejects.toBeInstanceOf(TeamSplitInvalidError);
    expect(club.saves).toEqual([]);
  });

  it.each(CLOSED_EVENTS)("rechaza guardar con %s", async (code, event) => {
    const { saving } = save({ events: [event] }, []);

    await expect(saving).rejects.toEqual(new TeamEventClosedError(code));
  });

  it.each<Role>(["Committee", "Player"])(
    "niega guardar a un %s",
    async (callerRole) => {
      const { club, saving } = save({ callerRole }, []);

      await expect(saving).rejects.toBeInstanceOf(TeamBuilderForbiddenError);
      expect(club.saves).toEqual([]);
    },
  );
});

describe("balancear", () => {
  function balance(options: FakeTeamsClubOptions) {
    const club = fakeTeamsClub({ players: EVERYONE, ...options });
    const balancing = autoBalanceEventTeams(club.gateways, {
      callerId: TEAMS_CALLER_ID,
      eventId: EVENT_ID,
      now: TEAMS_NOW,
    });
    return { club, balancing };
  }

  it("reparte los Sí con el auto-balance y guarda el borrador en auto", async () => {
    const { club, balancing } = balance({});
    const balanced = await balancing;

    expect(balanced.mode).toBe("auto");
    expect(balanced.a.map((entry) => entry.userId)).toEqual([ANA.userId]);
    expect(balanced.b.map((entry) => entry.userId)).toEqual([BRUNO.userId]);
    expect(club.saves).toEqual([
      expect.objectContaining({
        mode: "auto",
        teams: DEFAULT_TEAM_LABELS,
        assignments: [
          { userId: ANA.userId, team: "a" },
          { userId: BRUNO.userId, team: "b" },
        ],
      }),
    ]);
  });

  it("responde los totales, la sugerencia y la marca de no evaluado", async () => {
    const unrated: FakePlayer = {
      userId: playerId(6),
      fullName: "Fabio Uribe",
      response: "yes",
    };
    const { balancing } = balance({ players: [ANA, BRUNO, unrated] });
    const balanced = await balancing;

    expect(balanced.totals).toEqual({
      a: { playerCount: 1, combinedRating: 8.5, averageRating: 8.5 },
      b: { playerCount: 2, combinedRating: 12, averageRating: 6 },
      ratingDifference: 3.5,
    });
    expect(balanced.suggestion).toBeNull();
    expect(balanced.isTimeBudgetExhausted).toBe(false);
    expect(
      [...balanced.a, ...balanced.b].map((entry) => [
        entry.fullName,
        entry.isUnrated,
      ]),
    ).toEqual([
      [ANA.fullName, false],
      [BRUNO.fullName, false],
      [unrated.fullName, true],
    ]);
  });

  it("conserva los nombres y colores de un reparto ya guardado", async () => {
    const teams = {
      a: { name: "Orcas", color: "#112233" },
      b: { name: "Rayas", color: "#445566" },
    };
    const { balancing } = balance({
      split: { ...draftWith([]), teams },
    });

    await expect(balancing).resolves.toMatchObject({ teams });
  });

  it("responde que la escuadra está vacía sin guardar nada", async () => {
    const { club, balancing } = balance({ players: [CARLA, DIEGO] });

    await expect(balancing).rejects.toBeInstanceOf(TeamSquadEmptyError);
    expect(club.saves).toEqual([]);
  });

  it.each<Role>(["Committee", "Player"])(
    "niega balancear a un %s",
    async (callerRole) => {
      const { balancing } = balance({ callerRole });

      await expect(balancing).rejects.toBeInstanceOf(TeamBuilderForbiddenError);
    },
  );
});
