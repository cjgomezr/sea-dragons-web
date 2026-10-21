import { describe, expect, it } from "vitest";
import type { EvaluationRosterEntry } from "@/lib/evaluations/evaluation-roster";
import {
  DEFAULT_ROSTER_VIEW,
  type RosterView,
  applyRosterView,
  clearRosterFilters,
  countNotEvaluated,
  hasRosterFilters,
  rosterPositions,
} from "@/lib/evaluations/roster-view";

/**
 * Lo que la tabla de Evaluaciones enseña (#818, RF-2 del PRD de E31): qué
 * jugadores pasan la búsqueda, la ficha y la posición, y en qué orden.
 */

const FORWARD = {
  id: "90510000-0000-4000-8000-000000000001",
  names: { en: "Forward", es: "Delantero" },
} as const;
const CENTRE = {
  id: "90510000-0000-4000-8000-000000000002",
  names: { en: "Centre", es: "Centro" },
} as const;

type EntryOptions = {
  readonly position?: typeof FORWARD | typeof CENTRE | null;
};

function evaluatedPlayer(
  fullName: string,
  overall: number | null,
  updatedAt: string,
  { position = null }: EntryOptions = {},
): EvaluationRosterEntry {
  return {
    status: "evaluated",
    userId: `id-${fullName}`,
    fullName,
    position,
    photoUrl: null,
    overall,
    updatedAt,
    updatedBy: null,
  };
}

function pendingPlayer(
  fullName: string,
  { position = null }: EntryOptions = {},
): EvaluationRosterEntry {
  return {
    status: "not_evaluated",
    userId: `id-${fullName}`,
    fullName,
    position,
    photoUrl: null,
  };
}

const JOSE = evaluatedPlayer("José Pérez", 6.5, "2026-09-01T00:00:00Z", {
  position: FORWARD,
});
const ANA = evaluatedPlayer("Ana Lima", 8.1, "2026-10-01T00:00:00Z", {
  position: CENTRE,
});
const BEA = pendingPlayer("Bea Soto", { position: FORWARD });
const CARLA = evaluatedPlayer("Carla Ruiz", 7.2, "2026-06-15T00:00:00Z");
const ZOE = pendingPlayer("Zoe Allen");

const ROSTER = [ANA, BEA, CARLA, JOSE, ZOE] as const;

function namesOf(view: Partial<RosterView>): readonly string[] {
  return applyRosterView(ROSTER, { ...DEFAULT_ROSTER_VIEW, ...view }).map(
    (member) => member.fullName,
  );
}

describe("filtrar la plantilla", () => {
  it("sin filtros enseña a todos por nombre", () => {
    expect(namesOf({})).toEqual([
      "Ana Lima",
      "Bea Soto",
      "Carla Ruiz",
      "José Pérez",
      "Zoe Allen",
    ]);
  });

  it("busca por nombre sin distinguir tildes ni mayúsculas", () => {
    expect(namesOf({ search: "jose" })).toEqual(["José Pérez"]);
    expect(namesOf({ search: "PÉREZ" })).toEqual(["José Pérez"]);
  });

  it("ignora los espacios de los lados de la búsqueda", () => {
    expect(namesOf({ search: "  ana " })).toEqual(["Ana Lima"]);
  });

  it("con Sin evaluar deja sólo a quien no tiene evaluación", () => {
    expect(namesOf({ filter: "not_evaluated" })).toEqual([
      "Bea Soto",
      "Zoe Allen",
    ]);
  });

  it("con una posición deja sólo a quien la tiene", () => {
    expect(namesOf({ positionId: FORWARD.id })).toEqual([
      "Bea Soto",
      "José Pérez",
    ]);
  });

  it("combina la búsqueda, la ficha y la posición", () => {
    expect(
      namesOf({
        search: "b",
        filter: "not_evaluated",
        positionId: FORWARD.id,
      }),
    ).toEqual(["Bea Soto"]);
  });
});

describe("ordenar la plantilla", () => {
  it("de OVR mayor a menor deja al final a los sin evaluar", () => {
    expect(namesOf({ sort: "overall_desc" })).toEqual([
      "Ana Lima",
      "Carla Ruiz",
      "José Pérez",
      "Bea Soto",
      "Zoe Allen",
    ]);
  });

  it("de OVR menor a mayor también deja al final a los sin evaluar", () => {
    expect(namesOf({ sort: "overall_asc" })).toEqual([
      "José Pérez",
      "Carla Ruiz",
      "Ana Lima",
      "Bea Soto",
      "Zoe Allen",
    ]);
  });

  it("por OVR deja al final una evaluación sin nota, como a los sin evaluar", () => {
    const ruby = evaluatedPlayer("Ruby Walsh", null, "2026-01-01T00:00:00Z");

    const sorted = applyRosterView([ruby, ANA, BEA], {
      ...DEFAULT_ROSTER_VIEW,
      sort: "overall_desc",
    });

    expect(sorted.map((member) => member.fullName)).toEqual([
      "Ana Lima",
      "Bea Soto",
      "Ruby Walsh",
    ]);
  });

  it("por evaluación más antigua pone primero a los sin evaluar", () => {
    expect(namesOf({ sort: "oldest" })).toEqual([
      "Bea Soto",
      "Zoe Allen",
      "Carla Ruiz",
      "José Pérez",
      "Ana Lima",
    ]);
  });

  it("desempata por nombre a dos con el mismo OVR", () => {
    const second = evaluatedPlayer("Abel Mora", 8.1, "2026-10-02T00:00:00Z");

    const sorted = applyRosterView([ANA, second], {
      ...DEFAULT_ROSTER_VIEW,
      sort: "overall_desc",
    });

    expect(sorted.map((member) => member.fullName)).toEqual([
      "Abel Mora",
      "Ana Lima",
    ]);
  });
});

describe("lo que rodea a la tabla", () => {
  it("cuenta a los sin evaluar de toda la plantilla", () => {
    expect(countNotEvaluated(ROSTER)).toBe(2);
  });

  it("ofrece una vez cada posición que alguien tiene, por su nombre", () => {
    expect(rosterPositions(ROSTER, "es")).toEqual([CENTRE, FORWARD]);
  });

  it("sabe si hay algún filtro puesto", () => {
    expect(hasRosterFilters(DEFAULT_ROSTER_VIEW)).toBe(false);
    expect(hasRosterFilters({ ...DEFAULT_ROSTER_VIEW, sort: "oldest" })).toBe(
      false,
    );
    expect(hasRosterFilters({ ...DEFAULT_ROSTER_VIEW, search: "  " })).toBe(
      false,
    );
    expect(hasRosterFilters({ ...DEFAULT_ROSTER_VIEW, search: "ana" })).toBe(
      true,
    );
  });

  it("borrar los filtros deja el orden como estaba", () => {
    expect(
      clearRosterFilters({
        search: "ana",
        filter: "not_evaluated",
        positionId: FORWARD.id,
        sort: "oldest",
      }),
    ).toEqual({ ...DEFAULT_ROSTER_VIEW, sort: "oldest" });
  });
});
