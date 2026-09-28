import { describe, expect, it } from "vitest";
import {
  toClubAttendanceRate,
  toMemberAttendance,
} from "@/lib/attendance/attendance-stats";

/**
 * El porcentaje de asistencia (#394, RF-5 y RF-7 del PRD de E8, FR-042),
 * contado sin Supabase delante. La base ya redondea (la mitad hacia arriba lo
 * fija `attendance-stats-migration.test.ts`); aquí se decide cómo se sirve:
 * con su variante propia cuando no hay datos (AC-017b), nunca como 0.
 */

describe("el porcentaje de asistencia", () => {
  it("sirve el porcentaje y las sesiones a las que vino", () => {
    const attendance = toMemberAttendance({
      eligibleSessions: 10,
      attendedSessions: 9,
      percent: 90,
    });

    expect(attendance).toEqual({ kind: "rate", percent: 90, sessions: 9 });
  });

  it("distingue un cero de verdad de la falta de datos", () => {
    const attendance = toMemberAttendance({
      eligibleSessions: 4,
      attendedSessions: 0,
      percent: 0,
    });

    expect(attendance).toEqual({ kind: "rate", percent: 0, sessions: 0 });
  });

  it("dice sin datos cuando no hay sesiones elegibles (AC-017b)", () => {
    const attendance = toMemberAttendance({
      eligibleSessions: 0,
      attendedSessions: 0,
      percent: null,
    });

    expect(attendance).toEqual({ kind: "no_data" });
  });

  it("falla si la base trae sesiones elegibles sin porcentaje", () => {
    expect(() =>
      toMemberAttendance({
        eligibleSessions: 3,
        attendedSessions: 1,
        percent: null,
      }),
    ).toThrow(/porcentaje/);
  });
});

describe("la tasa de asistencia del club", () => {
  it("sirve el porcentaje y cuántas filas lo forman", () => {
    const rate = toClubAttendanceRate({ totalRecords: 4, percent: 75 });

    expect(rate).toEqual({ kind: "rate", percent: 75, records: 4 });
  });

  it("dice sin datos cuando no hay ninguna hoja", () => {
    const rate = toClubAttendanceRate({ totalRecords: 0, percent: null });

    expect(rate).toEqual({ kind: "no_data" });
  });

  it("falla si la base trae filas sin porcentaje", () => {
    expect(() =>
      toClubAttendanceRate({ totalRecords: 2, percent: null }),
    ).toThrow(/porcentaje/);
  });
});
