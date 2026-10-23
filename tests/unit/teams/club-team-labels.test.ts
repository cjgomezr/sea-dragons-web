import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  changeClubTeamLabels,
  clubTeamLabelsChangeSchema,
  clubTeamLabelsSchema,
  readClubTeamLabels,
} from "@/lib/teams/club-team-labels";
import {
  DEFAULT_TEAM_LABELS,
  type StoredTeamSplit,
  TeamBuilderForbiddenError,
} from "@/lib/teams/team-builder";
import { CLUB_TEAM_NAME_MAX_LENGTH } from "@/lib/teams/team-ids";
import {
  EVENT_ID,
  PUBLISHED_AT,
  SCRIMMAGE,
  TEAMS_CALLER_ID,
  TEAMS_CLUB_ID,
  fakeTeamsClub,
  playerId,
} from "../helpers/team-builder-club";

/** Un evento que el club no tiene. */
const OTHER_EVENT_ID = "e2e2e2e2-0000-4000-8000-00000000000e";

/**
 * Los equipos del club (#755, RF-1 y D1 a D3 del PRD de E28): el nombre y el
 * color de los dos equipos dejan de ser una constante. Los leen y los cambian
 * Admin y Coach, los mismos que arman equipos.
 */

const ORCAS_AND_RAYS = {
  a: { name: "Orcas", color: "#D64545" },
  b: { name: "Rayas", color: "#2B3F7A" },
};

function issuePaths(input: unknown): readonly string[] {
  const result = clubTeamLabelsSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join("."));
}

describe("la validación de los equipos del club", () => {
  it("acepta dos equipos con nombre y colores distintos del muestrario", () => {
    expect(clubTeamLabelsSchema.parse(ORCAS_AND_RAYS)).toEqual(ORCAS_AND_RAYS);
  });

  it("recorta el nombre y pasa el color a mayúsculas", () => {
    const parsed = clubTeamLabelsSchema.parse({
      a: { name: "  Orcas  ", color: "#d64545" },
      b: ORCAS_AND_RAYS.b,
    });

    expect(parsed.a).toEqual({ name: "Orcas", color: "#D64545" });
  });

  it("acepta un nombre de 24 caracteres", () => {
    const name = "x".repeat(CLUB_TEAM_NAME_MAX_LENGTH);

    expect(
      issuePaths({ ...ORCAS_AND_RAYS, a: { ...ORCAS_AND_RAYS.a, name } }),
    ).toEqual([]);
  });

  it.each([
    ["un nombre vacío tras recortar", { name: "   ", color: "#D64545" }],
    ["un nombre de 25 caracteres", { name: "x".repeat(25), color: "#D64545" }],
  ])("señala a.name con %s", (_, team) => {
    expect(issuePaths({ ...ORCAS_AND_RAYS, a: team })).toEqual(["a.name"]);
  });

  it.each([
    ["un #RRGGBB fuera del muestrario", "#123456"],
    ["un color que no es #RRGGBB", "blue"],
  ])("señala b.color con %s", (_, color) => {
    expect(
      issuePaths({ ...ORCAS_AND_RAYS, b: { name: "Rayas", color } }),
    ).toEqual(["b.color"]);
  });

  it("señala los dos colores cuando son iguales", () => {
    expect(
      issuePaths({
        a: { name: "Orcas", color: "#D64545" },
        b: { name: "Rayas", color: "#d64545" },
      }),
    ).toEqual(["a.color", "b.color"]);
  });

  it("señala el equipo que falta", () => {
    expect(issuePaths({ a: ORCAS_AND_RAYS.a })).toEqual(["b"]);
  });
});

describe("leer los equipos del club", () => {
  it.each<Role>(["Admin", "Coach"])("se los da a un %s", async (callerRole) => {
    const club = fakeTeamsClub({ callerRole, clubTeams: ORCAS_AND_RAYS });

    await expect(
      readClubTeamLabels(club.gateways, TEAMS_CALLER_ID),
    ).resolves.toEqual(ORCAS_AND_RAYS);
  });

  it.each<Role>(["Committee", "Player"])(
    "se los niega a un %s",
    async (callerRole) => {
      const club = fakeTeamsClub({ callerRole });

      await expect(
        readClubTeamLabels(club.gateways, TEAMS_CALLER_ID),
      ).rejects.toBeInstanceOf(TeamBuilderForbiddenError);
    },
  );
});

describe("cambiar los equipos del club", () => {
  it.each<Role>(["Admin", "Coach"])(
    "guarda los de un %s en su club y los devuelve",
    async (callerRole) => {
      const club = fakeTeamsClub({ callerRole });

      const change = await changeClubTeamLabels(club.gateways, {
        callerId: TEAMS_CALLER_ID,
        teams: ORCAS_AND_RAYS,
      });

      expect(change).toEqual({ teams: ORCAS_AND_RAYS, eventSplit: "none" });
      expect(club.clubTeamChanges).toEqual([
        { clubId: TEAMS_CLUB_ID, teams: ORCAS_AND_RAYS },
      ]);
    },
  );

  it.each<Role>(["Committee", "Player"])(
    "no deja cambiarlos a un %s",
    async (callerRole) => {
      const club = fakeTeamsClub({ callerRole });

      await expect(
        changeClubTeamLabels(club.gateways, {
          callerId: TEAMS_CALLER_ID,
          teams: ORCAS_AND_RAYS,
        }),
      ).rejects.toBeInstanceOf(TeamBuilderForbiddenError);
      expect(club.clubTeamChanges).toEqual([]);
    },
  );

  it("parte de Team Kelp y Team Tide", async () => {
    const club = fakeTeamsClub();

    await expect(
      readClubTeamLabels(club.gateways, TEAMS_CALLER_ID),
    ).resolves.toEqual(DEFAULT_TEAM_LABELS);
  });
});

/** Un reparto guardado del scrimmage con los equipos de siempre. */
function savedSplit(publishedAt: Date | null): StoredTeamSplit {
  return {
    teams: DEFAULT_TEAM_LABELS,
    mode: "manual",
    publishedAt,
    assignments: [],
  };
}

describe("cambiar los equipos desde el builder de un evento (D4)", () => {
  it("lleva el nombre y el color al reparto guardado y sin publicar", async () => {
    const club = fakeTeamsClub({ split: savedSplit(null) });

    const change = await changeClubTeamLabels(club.gateways, {
      callerId: TEAMS_CALLER_ID,
      teams: ORCAS_AND_RAYS,
      eventId: EVENT_ID,
    });

    expect(club.split()?.teams).toEqual(ORCAS_AND_RAYS);
    expect(change.eventSplit).toBe("relabelled");
  });

  it("deja el reparto publicado con los equipos que se avisaron", async () => {
    const club = fakeTeamsClub({ split: savedSplit(PUBLISHED_AT) });

    const change = await changeClubTeamLabels(club.gateways, {
      callerId: TEAMS_CALLER_ID,
      teams: ORCAS_AND_RAYS,
      eventId: EVENT_ID,
    });

    expect(club.split()?.teams).toEqual(DEFAULT_TEAM_LABELS);
    expect(change.eventSplit).toBe("published");
    expect(club.clubTeamChanges).toEqual([
      { clubId: TEAMS_CLUB_ID, teams: ORCAS_AND_RAYS },
    ]);
  });

  it("un evento sin reparto guardado sólo cambia los del club", async () => {
    const club = fakeTeamsClub();

    const change = await changeClubTeamLabels(club.gateways, {
      callerId: TEAMS_CALLER_ID,
      teams: ORCAS_AND_RAYS,
      eventId: EVENT_ID,
    });

    expect(change.eventSplit).toBe("none");
    expect(club.split()).toBeNull();
  });

  it("sin evento sólo cambia los del club", async () => {
    const club = fakeTeamsClub({ split: savedSplit(null) });

    await changeClubTeamLabels(club.gateways, {
      callerId: TEAMS_CALLER_ID,
      teams: ORCAS_AND_RAYS,
    });

    expect(club.split()?.teams).toEqual(DEFAULT_TEAM_LABELS);
  });

  it("no toca ni describe el reparto de un evento que no es del club", async () => {
    const club = fakeTeamsClub({ split: savedSplit(PUBLISHED_AT) });

    const change = await changeClubTeamLabels(club.gateways, {
      callerId: TEAMS_CALLER_ID,
      teams: ORCAS_AND_RAYS,
      eventId: OTHER_EVENT_ID,
    });

    expect(club.split()?.teams).toEqual(DEFAULT_TEAM_LABELS);
    expect(change.eventSplit).toBe("none");
  });

  it("acepta el evento en el cuerpo del cambio", () => {
    expect(
      clubTeamLabelsChangeSchema.parse({
        ...ORCAS_AND_RAYS,
        eventId: EVENT_ID,
      }),
    ).toEqual({ ...ORCAS_AND_RAYS, eventId: EVENT_ID });
  });

  it("señala un evento que no es un id", () => {
    const result = clubTeamLabelsChangeSchema.safeParse({
      ...ORCAS_AND_RAYS,
      eventId: "scrimmage",
    });

    expect(
      result.success ? [] : result.error.issues.map((issue) => issue.path),
    ).toEqual([["eventId"]]);
  });
});

/** Daniela y Ethan en Kelp, quien cambia los equipos en Tide. */
function publishedSplitWithPlayers(): StoredTeamSplit {
  return {
    ...savedSplit(PUBLISHED_AT),
    assignments: [
      { userId: playerId(1), team: "a" },
      { userId: playerId(2), team: "a" },
      { userId: TEAMS_CALLER_ID, team: "b" },
      { userId: playerId(3), team: "b" },
    ],
  };
}

function applyToPublished(
  club: ReturnType<typeof fakeTeamsClub>,
  teams = ORCAS_AND_RAYS,
): ReturnType<typeof changeClubTeamLabels> {
  return changeClubTeamLabels(club.gateways, {
    callerId: TEAMS_CALLER_ID,
    teams,
    eventId: EVENT_ID,
    applyToPublished: true,
  });
}

describe("aplicar los equipos al reparto publicado (#871)", () => {
  it("sin la opción, el publicado conserva los suyos y nadie se entera", async () => {
    const club = fakeTeamsClub({ split: publishedSplitWithPlayers() });

    const change = await changeClubTeamLabels(club.gateways, {
      callerId: TEAMS_CALLER_ID,
      teams: ORCAS_AND_RAYS,
      eventId: EVENT_ID,
      applyToPublished: false,
    });

    expect(change.eventSplit).toBe("published");
    expect(club.split()?.teams).toEqual(DEFAULT_TEAM_LABELS);
    expect(club.notices).toEqual([]);
    expect(club.auditRows).toEqual([]);
  });

  it("con la opción, el publicado estrena los nuevos y conserva fecha y jugadores", async () => {
    const before = publishedSplitWithPlayers();
    const club = fakeTeamsClub({ split: before });

    await applyToPublished(club);

    expect(club.split()).toEqual({ ...before, teams: ORCAS_AND_RAYS });
    expect(club.clubTeamChanges).toEqual([
      { clubId: TEAMS_CLUB_ID, teams: ORCAS_AND_RAYS },
    ]);
  });

  it("avisa a cada asignado con el nombre y el color nuevos de su equipo, menos a quien cambia", async () => {
    const club = fakeTeamsClub({ split: publishedSplitWithPlayers() });

    const change = await applyToPublished(club);

    const eventData = {
      eventId: EVENT_ID,
      title: SCRIMMAGE.title,
      startsOn: SCRIMMAGE.startsOn,
      startTime: SCRIMMAGE.startTime,
    };
    expect(club.notices).toEqual([
      {
        type: "team_assigned",
        userId: playerId(1),
        data: { ...eventData, teamName: "Orcas", teamColor: "#D64545" },
      },
      {
        type: "team_assigned",
        userId: playerId(2),
        data: { ...eventData, teamName: "Orcas", teamColor: "#D64545" },
      },
      {
        type: "team_assigned",
        userId: playerId(3),
        data: { ...eventData, teamName: "Rayas", teamColor: "#2B3F7A" },
      },
    ]);
    expect(change).toEqual({
      teams: ORCAS_AND_RAYS,
      eventSplit: "relabelledPublished",
      notifiedCount: 3,
    });
  });

  it("deja en la bitácora el cambio con el evento como entidad", async () => {
    const club = fakeTeamsClub({ split: publishedSplitWithPlayers() });

    await applyToPublished(club);

    expect(club.auditRows).toEqual([
      expect.objectContaining({
        actor_id: TEAMS_CALLER_ID,
        club_id: TEAMS_CLUB_ID,
        action: "team_split.relabelled",
        entity_type: "event",
        entity_id: EVENT_ID,
        result: "success",
        metadata: { notifiedCount: 3 },
      }),
    ]);
  });

  it("con los mismos nombres y colores que ya tiene no avisa a nadie", async () => {
    const club = fakeTeamsClub({ split: publishedSplitWithPlayers() });

    const change = await applyToPublished(club, DEFAULT_TEAM_LABELS);

    expect(club.notices).toEqual([]);
    expect(club.auditRows).toEqual([]);
    expect(change).toEqual({
      teams: DEFAULT_TEAM_LABELS,
      eventSplit: "relabelledPublished",
      notifiedCount: 0,
    });
  });

  it("no toca ni avisa el reparto publicado de un evento de otro club", async () => {
    const club = fakeTeamsClub({ split: publishedSplitWithPlayers() });

    const change = await changeClubTeamLabels(club.gateways, {
      callerId: TEAMS_CALLER_ID,
      teams: ORCAS_AND_RAYS,
      eventId: OTHER_EVENT_ID,
      applyToPublished: true,
    });

    expect(change).toEqual({ teams: ORCAS_AND_RAYS, eventSplit: "none" });
    expect(club.split()?.teams).toEqual(DEFAULT_TEAM_LABELS);
    expect(club.notices).toEqual([]);
  });

  it("sin reparto publicado la opción no cambia nada", async () => {
    const club = fakeTeamsClub({ split: savedSplit(null) });

    const change = await applyToPublished(club);

    expect(change).toEqual({ teams: ORCAS_AND_RAYS, eventSplit: "relabelled" });
    expect(club.notices).toEqual([]);
    expect(club.auditRows).toEqual([]);
  });

  it("sin reparto guardado la opción no cambia nada", async () => {
    const club = fakeTeamsClub();

    const change = await applyToPublished(club);

    expect(change).toEqual({ teams: ORCAS_AND_RAYS, eventSplit: "none" });
    expect(club.notices).toEqual([]);
  });

  it("si el aviso falla, el cambio queda hecho", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const club = fakeTeamsClub({
      split: publishedSplitWithPlayers(),
      failingNotifications: true,
    });

    const change = await applyToPublished(club);

    expect(club.split()?.teams).toEqual(ORCAS_AND_RAYS);
    expect(change.eventSplit).toBe("relabelledPublished");
  });

  it("acepta la opción en el cuerpo del cambio", () => {
    expect(
      clubTeamLabelsChangeSchema.parse({
        ...ORCAS_AND_RAYS,
        eventId: EVENT_ID,
        applyToPublished: true,
      }),
    ).toEqual({ ...ORCAS_AND_RAYS, eventId: EVENT_ID, applyToPublished: true });
  });

  it("señala una opción que no es un sí o un no", () => {
    const result = clubTeamLabelsChangeSchema.safeParse({
      ...ORCAS_AND_RAYS,
      eventId: EVENT_ID,
      applyToPublished: "yes",
    });

    expect(
      result.success ? [] : result.error.issues.map((issue) => issue.path),
    ).toEqual([["applyToPublished"]]);
  });
});
