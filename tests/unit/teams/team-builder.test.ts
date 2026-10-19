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
  signedPhotoUrl,
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

/** Los equipos que el club guardó (#755): ni Kelp ni Tide. */
const CLUB_TEAMS = {
  a: { name: "Orcas", color: "#D64545" },
  b: { name: "Rayas", color: "#2B3F7A" },
};

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
          photoUrl: null,
        },
        {
          userId: BRUNO.userId,
          fullName: BRUNO.fullName,
          position: { id: GOALKEEPER.id, names: GOALKEEPER.names },
          coverage: "goalkeeper",
          rating: 7,
          isUnrated: false,
          photoUrl: null,
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

  it("da los equipos del club a un evento sin reparto", async () => {
    const builder = await open({ players: [ANA], clubTeams: CLUB_TEAMS });

    expect(builder.teams).toEqual(CLUB_TEAMS);
  });

  it("da a un reparto guardado sus equipos, no los del club", async () => {
    const builder = await open({
      players: [ANA],
      clubTeams: CLUB_TEAMS,
      split: draftWith([]),
    });

    expect(builder.teams).toEqual(DEFAULT_TEAM_LABELS);
  });

  it("deja armar una competición y un evento de hoy aunque ya empezó", async () => {
    const competition = { ...SCRIMMAGE, eventType: "competition" as const };
    const today = { ...SCRIMMAGE, startsOn: "2027-06-15", startTime: "07:00" };

    await expect(open({ events: [competition] })).resolves.toBeDefined();
    await expect(open({ events: [today] })).resolves.toBeDefined();
  });

  it("deja fuera de la escuadra a quien no tiene la membresía al día, aunque dijera Sí o Quizás (#453)", async () => {
    const builder = await open({
      players: [
        ANA,
        { ...BRUNO, membershipCurrent: false },
        { ...CARLA, membershipCurrent: false },
      ],
    });

    expect(builder.available.map((entry) => entry.userId)).toEqual([
      ANA.userId,
    ]);
    expect(builder.maybe).toEqual([]);
  });

  it("marca fuera de la escuadra a un asignado que dejó de estar al día (#453)", async () => {
    const builder = await open({
      players: [ANA, { ...BRUNO, membershipCurrent: false }],
      split: draftWith([
        { userId: ANA.userId, team: "a" },
        { userId: BRUNO.userId, team: "b" },
      ]),
    });

    expect(builder.split?.assignments).toEqual([
      expect.objectContaining({ userId: ANA.userId, isOutsideSquad: false }),
      expect.objectContaining({
        userId: BRUNO.userId,
        fullName: BRUNO.fullName,
        isOutsideSquad: true,
      }),
    ]);
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

describe("las fotos (#757)", () => {
  const ANA_PHOTO = `${ANA.userId}/thumb.webp`;
  const CARLA_PHOTO = `${CARLA.userId}/thumb.webp`;
  const WITH_PHOTOS = [
    { ...ANA, photoPath: ANA_PHOTO },
    BRUNO,
    { ...CARLA, photoPath: CARLA_PHOTO },
  ];

  it("da la foto firmada de cada jugador de la escuadra", async () => {
    const builder = await open({ players: WITH_PHOTOS });

    expect(
      [...builder.available, ...builder.maybe].map((entry) => [
        entry.fullName,
        entry.photoUrl,
      ]),
    ).toEqual([
      [ANA.fullName, signedPhotoUrl(ANA_PHOTO)],
      [BRUNO.fullName, null],
      [CARLA.fullName, signedPhotoUrl(CARLA_PHOTO)],
    ]);
  });

  it("firma todas las fotos en una sola llamada", async () => {
    const club = fakeTeamsClub({ players: WITH_PHOTOS });

    await openTeamBuilder(club.gateways, {
      callerId: TEAMS_CALLER_ID,
      eventId: EVENT_ID,
      now: TEAMS_NOW,
    });

    expect(club.signedPaths).toEqual([[ANA_PHOTO, CARLA_PHOTO]]);
  });

  it("da la foto firmada de cada asignado del reparto", async () => {
    const builder = await open({
      players: WITH_PHOTOS,
      split: draftWith([
        { userId: ANA.userId, team: "a" },
        { userId: BRUNO.userId, team: "b" },
      ]),
    });

    expect(builder.split?.assignments.map((entry) => entry.photoUrl)).toEqual([
      signedPhotoUrl(ANA_PHOTO),
      null,
    ]);
  });

  it("responde con las fotos en null si firmarlas falla", async () => {
    const builder = await open({ players: WITH_PHOTOS, failingPhotos: true });

    expect(
      [...builder.available, ...builder.maybe].map((entry) => entry.photoUrl),
    ).toEqual([null, null, null]);
  });

  it("no da a un Coach la foto de un asignado dado de baja, como el directorio", async () => {
    const departed = { ...ANA, accountStatus: "inactive" as const };
    const club = fakeTeamsClub({
      players: [{ ...departed, photoPath: ANA_PHOTO }],
      split: draftWith([{ userId: ANA.userId, team: "a" }]),
    });

    const builder = await openTeamBuilder(club.gateways, {
      callerId: TEAMS_CALLER_ID,
      eventId: EVENT_ID,
      now: TEAMS_NOW,
    });

    expect(builder.split?.assignments[0]?.photoUrl).toBeNull();
    expect(club.signedPaths.flat()).not.toContain(ANA_PHOTO);
  });

  it("da a un Admin la foto de un asignado dado de baja, como el directorio", async () => {
    const builder = await open({
      callerRole: "Admin",
      players: [{ ...ANA, accountStatus: "inactive", photoPath: ANA_PHOTO }],
      split: draftWith([{ userId: ANA.userId, team: "a" }]),
    });

    expect(builder.split?.assignments[0]?.photoUrl).toBe(
      signedPhotoUrl(ANA_PHOTO),
    );
  });

  it("da la foto firmada de cada jugador que reparte el auto-balance", async () => {
    const balanced = await autoBalanceEventTeams(
      fakeTeamsClub({ players: WITH_PHOTOS }).gateways,
      { callerId: TEAMS_CALLER_ID, eventId: EVENT_ID, now: TEAMS_NOW },
    );

    expect(
      [...balanced.a, ...balanced.b].map((entry) => entry.photoUrl),
    ).toEqual([signedPhotoUrl(ANA_PHOTO), null]);
  });

  it("balancea igual con las fotos en null si firmarlas falla", async () => {
    const balanced = await autoBalanceEventTeams(
      fakeTeamsClub({ players: WITH_PHOTOS, failingPhotos: true }).gateways,
      { callerId: TEAMS_CALLER_ID, eventId: EVENT_ID, now: TEAMS_NOW },
    );

    expect(
      [...balanced.a, ...balanced.b].map((entry) => entry.photoUrl),
    ).toEqual([null, null]);
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

  it("rechaza a quien no tiene la membresía al día sin escribir nada (#453)", async () => {
    const { club, saving } = save(
      { players: [ANA, { ...BRUNO, membershipCurrent: false }] },
      [
        { userId: ANA.userId, team: "a" },
        { userId: BRUNO.userId, team: "b" },
      ],
    );

    await expect(saving).rejects.toBeInstanceOf(TeamPlayerOutsideSquadError);
    expect(club.saves).toEqual([]);
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

  it("reparte un evento sin reparto con los equipos del club", async () => {
    const { club, balancing } = balance({ clubTeams: CLUB_TEAMS });

    await expect(balancing).resolves.toMatchObject({ teams: CLUB_TEAMS });
    expect(club.saves).toEqual([
      expect.objectContaining({ teams: CLUB_TEAMS }),
    ]);
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
