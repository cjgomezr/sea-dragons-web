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

/** Un socio sin marca guardada cuenta como cambiado (#764, D2 de E29). */
export function isMarkUnsaved(
  saved: AttendanceStatus | undefined,
  current: AttendanceStatus,
): boolean {
  return saved !== current;
}

export function hasUnsavedChanges(marks: SheetMarks): boolean {
  return marks.current.some((mark, index) =>
    isMarkUnsaved(marks.saved[index]?.status, mark.status),
  );
}

/** Lleva el punto de "sin guardar" en su fila. */
export function isMemberUnsaved(marks: SheetMarks, userId: string): boolean {
  const saved = marks.saved.find((candidate) => candidate.userId === userId);
  return isMarkUnsaved(saved?.status, statusOf(marks, userId));
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
