/**
 * Los estados de asistencia y sus totales (FR-038, FR-040). Viven aparte de
 * la hoja porque los cuenta también la pantalla (#395) mientras se marca, y
 * la hoja arrastra dependencias de servidor que no tienen por qué llegar al
 * navegador.
 */

/** Los mismos que acepta el `check` de `attendance_records.status` en
 * `0043_attendance_records.sql` (FR-038). */
export const ATTENDANCE_STATUSES = ["present", "late", "absent"] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export type AttendanceTotals = Readonly<Record<AttendanceStatus, number>>;

export function countAttendance(
  statuses: readonly AttendanceStatus[],
): AttendanceTotals {
  return {
    present: statuses.filter((status) => status === "present").length,
    late: statuses.filter((status) => status === "late").length,
    absent: statuses.filter((status) => status === "absent").length,
  };
}
