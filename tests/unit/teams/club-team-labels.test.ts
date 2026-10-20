import { describe, expect, it } from "vitest";
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
  TEAMS_CALLER_ID,
  TEAMS_CLUB_ID,
  fakeTeamsClub,
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
