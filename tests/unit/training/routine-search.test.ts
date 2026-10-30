import { describe, expect, it } from "vitest";
import type { ManagedRoutine } from "@/lib/training/club-routines";
import { filterRoutinesByName } from "@/lib/training/routine-search";

/** La búsqueda de Planificar → Rutinas (#945): filtra por nombre en el
 * navegador con la misma regla que el directorio. */

function routineNamed(name: string, index: number): ManagedRoutine {
  return {
    id: `bbbbbbbb-0000-4000-8000-00000000000${index}`,
    name,
    cycleId: null,
    colorIndex: index,
    itemCount: 0,
    daysUsed: 0,
  };
}

const GYM_A = routineNamed("Gym A · Strength", 1);
const GYM_B = routineNamed("Gym B · Power", 2);
const POOL = routineNamed("Pool · Apnea", 3);
const ROUTINES = [GYM_A, GYM_B, POOL];

describe("filterRoutinesByName", () => {
  it("returns every routine when the search is empty", () => {
    expect(filterRoutinesByName(ROUTINES, "")).toEqual(ROUTINES);
  });

  it("returns every routine when the search is only spaces", () => {
    expect(filterRoutinesByName(ROUTINES, "   ")).toEqual(ROUTINES);
  });

  it("keeps the routines whose name contains the text", () => {
    expect(filterRoutinesByName(ROUTINES, "gym b")).toEqual([GYM_B]);
  });

  it("ignores case and accents", () => {
    const apnea = routineNamed("Apnéa estática", 4);

    expect(filterRoutinesByName([GYM_A, apnea], "APNEA")).toEqual([apnea]);
  });

  it("ignores the spaces around the text", () => {
    expect(filterRoutinesByName(ROUTINES, "  power ")).toEqual([GYM_B]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterRoutinesByName(ROUTINES, "yoga")).toEqual([]);
  });

  it("keeps the original order", () => {
    expect(filterRoutinesByName([POOL, GYM_B, GYM_A], "gym")).toEqual([
      GYM_B,
      GYM_A,
    ]);
  });
});
