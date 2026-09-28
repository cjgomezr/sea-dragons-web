import {
  type AttendanceStatus,
  type AttendanceTotals,
  countAttendance,
} from "@/lib/attendance/attendance-status";

/**
 * Lo marcado en una hoja abierta (#395): el estado de cada miembro, en el
 * orden de la hoja, y lo último que quedó guardado para saber si hay cambios.
 */

export type AttendanceMark = {
  readonly userId: string;
  readonly status: AttendanceStatus;
};

export type SheetMarks = {
  readonly current: readonly AttendanceMark[];
  /** Lo que el servidor tiene: lo que llegó al abrir o lo último guardado. */
  readonly saved: readonly AttendanceMark[];
};

export function startMarks(marks: readonly AttendanceMark[]): SheetMarks {
  return { current: marks, saved: marks };
}

export function markMember(
  marks: SheetMarks,
  change: AttendanceMark,
): SheetMarks {
  return {
    ...marks,
    current: marks.current.map((mark) =>
      mark.userId === change.userId ? change : mark,
    ),
  };
}

/** Lo que se mandó quedó guardado: pasa a ser la referencia. */
export function settleMarks(
  marks: SheetMarks,
  sent: readonly AttendanceMark[],
): SheetMarks {
  return { ...marks, saved: sent };
}

export function hasUnsavedChanges(marks: SheetMarks): boolean {
  return marks.current.some(
    (mark, index) => mark.status !== marks.saved[index]?.status,
  );
}

export function statusOf(marks: SheetMarks, userId: string): AttendanceStatus {
  const mark = marks.current.find((candidate) => candidate.userId === userId);
  if (mark === undefined) {
    throw new Error(`${userId} no está en la hoja que se está marcando.`);
  }
  return mark.status;
}

export function totalsOf(marks: SheetMarks): AttendanceTotals {
  return countAttendance(marks.current.map((mark) => mark.status));
}
