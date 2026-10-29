import { describe, expect, it } from "vitest";
import type { ManagedMark } from "@/lib/training/club-marks";
import {
  isMarkNameTaken,
  markDeletion,
} from "@/lib/training/mark-planner-view";

/**
 * Lo que Planificar → Marcas (#911, RF-11 del PRD de E35) decide antes de
 * llamar a la API: cómo se borra una marca y si un nombre ya está.
 */

function mark(overrides: Partial<ManagedMark> = {}): ManagedMark {
  return {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    name: "Back squat",
    unit: "kg",
    routineRows: 0,
    membersRecorded: 0,
    ...overrides,
  };
}

describe("markDeletion", () => {
  it("no deja borrar una marca usada en una fila de rutina", () => {
    expect(markDeletion(mark({ routineRows: 2, membersRecorded: 5 }))).toEqual({
      kind: "inUse",
    });
  });

  it("borra al momento una sin usar que nadie registró", () => {
    expect(markDeletion(mark())).toEqual({ kind: "immediate" });
  });

  it("pide confirmar una sin usar que registraron socios, con cuántos", () => {
    expect(markDeletion(mark({ membersRecorded: 3 }))).toEqual({
      kind: "confirm",
      membersRecorded: 3,
    });
  });
});

describe("isMarkNameTaken", () => {
  const marks = [mark(), mark({ id: "otra", name: "Bench press" })];

  it("ve repetido un nombre sin mirar mayúsculas, tildes ni bordes", () => {
    expect(isMarkNameTaken(marks, "  báck SQUAT ")).toBe(true);
  });

  it("no ve repetido un nombre nuevo", () => {
    expect(isMarkNameTaken(marks, "Power clean")).toBe(false);
  });

  it("no cuenta como repetida la marca que se renombra", () => {
    expect(isMarkNameTaken(marks, "back squat", mark().id)).toBe(false);
  });
});
