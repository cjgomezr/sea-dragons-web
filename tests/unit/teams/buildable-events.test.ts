import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  BUILDABLE_EVENTS_LIMIT,
  listBuildableEvents,
} from "@/lib/teams/buildable-events";
import {
  TeamBuilderForbiddenError,
  type TeamBuilderEvent,
} from "@/lib/teams/team-builder";
import {
  OTHER_CLUB_ID,
  SCRIMMAGE,
  TEAMS_CALLER_ID,
  TEAMS_NOW,
  fakeTeamsClub,
} from "../helpers/team-builder-club";

/**
 * Los eventos que se pueden armar (#402, RF-9 del PRD de E10): lo que la
 * pantalla de Equipos ofrece en su selector. Qué filas lee la consulta lo
 * prueba el test de integración del adaptador; aquí, quién puede pedirlos y
 * desde qué día se cuentan.
 */

function eventOn(
  index: number,
  changes: Partial<TeamBuilderEvent>,
): TeamBuilderEvent {
  return {
    ...SCRIMMAGE,
    id: `e1e1e1e1-0000-4000-8000-${String(index).padStart(12, "0")}`,
    ...changes,
  };
}

function list(
  events: readonly TeamBuilderEvent[],
  options: { readonly role?: Role; readonly now?: Date } = {},
) {
  return listBuildableEvents(
    fakeTeamsClub({ events, callerRole: options.role ?? "Coach" }).gateways,
    { callerId: TEAMS_CALLER_ID, now: options.now ?? TEAMS_NOW },
  );
}

describe("listBuildableEvents", () => {
  it.each<Role>(["Coach", "Admin"])(
    "da a un %s los armables del club, del más cercano al más lejano",
    async (role) => {
      const later = eventOn(1, {
        title: "Competición",
        startsOn: "2027-06-26",
      });
      const sooner = eventOn(2, { title: "Técnica", startsOn: "2027-06-16" });

      const { events } = await list([later, sooner], { role });

      expect(events.map((event) => event.title)).toEqual([
        "Técnica",
        "Competición",
      ]);
      expect(events[0]).toEqual({
        id: sooner.id,
        title: "Técnica",
        eventType: "training",
        startsOn: "2027-06-16",
        startTime: "10:00",
      });
    },
  );

  it("deja fuera los de otro club, los cancelados, las reuniones y los pasados", async () => {
    const { events } = await list([
      eventOn(1, { title: "Armable" }),
      eventOn(2, { title: "De otro club", clubId: OTHER_CLUB_ID }),
      eventOn(3, { title: "Cancelado", status: "cancelled" }),
      eventOn(4, { title: "Reunión", eventType: "meeting" }),
      eventOn(5, { title: "Ayer", startsOn: "2027-06-14" }),
    ]);

    expect(events.map((event) => event.title)).toEqual(["Armable"]);
  });

  it("cuenta el día en Melbourne: pasada la medianoche, el de ayer ya no se arma", async () => {
    // 16 de junio a la 01:00 en Melbourne, todavía 15 en UTC.
    const afterMidnight = new Date("2027-06-15T15:00:00Z");

    const { events } = await list(
      [
        eventOn(1, { title: "Del 15", startsOn: "2027-06-15" }),
        eventOn(2, { title: "Del 16", startsOn: "2027-06-16" }),
      ],
      { now: afterMidnight },
    );

    expect(events.map((event) => event.title)).toEqual(["Del 16"]);
  });

  it("no pasa del límite", async () => {
    const many = Array.from({ length: BUILDABLE_EVENTS_LIMIT + 1 }, (_, i) =>
      eventOn(i + 1, { title: `Sesión ${i}` }),
    );

    const { events } = await list(many);

    expect(events).toHaveLength(BUILDABLE_EVENTS_LIMIT);
  });

  it.each<Role>(["Committee", "Player"])("rechaza a un %s", async (role) => {
    await expect(list([SCRIMMAGE], { role })).rejects.toBeInstanceOf(
      TeamBuilderForbiddenError,
    );
  });
});
