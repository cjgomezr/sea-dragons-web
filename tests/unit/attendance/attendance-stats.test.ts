import { describe, expect, it } from "vitest";
import {
  attendanceOf,
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

describe("la asistencia de cada miembro de la lista", () => {
  const MEMBER_ID = "e39bfd53-6a91-43ba-bc5a-1f8f7c1c90a9";

  it("sirve la que trajo la consulta", () => {
    const counted = { kind: "rate", percent: 80, sessions: 8 } as const;

    const attendance = attendanceOf(new Map([[MEMBER_ID, counted]]), MEMBER_ID);

    expect(attendance).toEqual(counted);
  });

  it("dice sin datos de quien se dio de baja entre las dos consultas", () => {
    const attendance = attendanceOf(new Map(), MEMBER_ID);

    expect(attendance).toEqual({ kind: "no_data" });
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
