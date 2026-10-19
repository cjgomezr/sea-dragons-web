import { describe, expect, it } from "vitest";
import {
  isMarkUnsaved,
  isMemberUnsaved,
  markMember,
  startMarks,
} from "@/components/attendance/attendance-marks";

/**
 * Qué socio lleva el punto de "sin guardar" (#764, D2 del PRD de E29): el que
 * tiene marcado algo distinto de lo que guardó el servidor.
 */

const MATEO_ID = "11111111-0000-4000-8000-000000000001";
const RUBY_ID = "33333333-0000-4000-8000-000000000003";

describe("isMarkUnsaved", () => {
  it("devuelve false cuando lo marcado es lo guardado", () => {
    expect(isMarkUnsaved("present", "present")).toBe(false);
  });

  it("devuelve true cuando lo marcado difiere de lo guardado", () => {
    expect(isMarkUnsaved("present", "late")).toBe(true);
  });

  it("devuelve true para un socio sin marca guardada", () => {
    expect(isMarkUnsaved(undefined, "absent")).toBe(true);
  });
});

describe("isMemberUnsaved", () => {
  const opened = startMarks([
    { userId: MATEO_ID, status: "present" },
    { userId: RUBY_ID, status: "absent" },
  ]);

  it("no marca a nadie en una hoja recién abierta", () => {
    expect(isMemberUnsaved(opened, MATEO_ID)).toBe(false);
  });

  it("marca solo al socio cambiado", () => {
    const changed = markMember(opened, { userId: MATEO_ID, status: "late" });

    expect(isMemberUnsaved(changed, MATEO_ID)).toBe(true);
    expect(isMemberUnsaved(changed, RUBY_ID)).toBe(false);
  });

  it("deja de marcar al socio que vuelve a su estado guardado", () => {
    const changed = markMember(opened, { userId: MATEO_ID, status: "late" });
    const restored = markMember(changed, {
      userId: MATEO_ID,
      status: "present",
    });

    expect(isMemberUnsaved(restored, MATEO_ID)).toBe(false);
  });
});
