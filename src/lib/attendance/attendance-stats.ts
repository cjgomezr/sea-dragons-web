/**
 * El porcentaje de asistencia de un miembro y la tasa del club (#394, RF-5 y
 * RF-7 del PRD de E8, FR-042), tal como los sirve la API.
 *
 * Los cuenta y los redondea la base (`0045_attendance_stats.sql`), en una
 * sola consulta para toda una página (NFR-008). Lo que se decide aquí es la
 * forma: sin sesiones elegibles no hay porcentaje, y eso es una variante
 * propia y no un 0 ni un `null` a secas (AC-017b), para que ninguna pantalla
 * pueda pintarlo como si el miembro no hubiera venido nunca.
 */

/** `sessions` es el total de FR-022: a cuántas vino, `present` o `late`. */
export type MemberAttendance =
  | {
      readonly kind: "rate";
      readonly percent: number;
      readonly sessions: number;
    }
  | { readonly kind: "no_data" };

/** `records` son las filas de las hojas del periodo que forman la tasa. */
export type ClubAttendanceRate =
  | {
      readonly kind: "rate";
      readonly percent: number;
      readonly records: number;
    }
  | { readonly kind: "no_data" };

/** Lo que la base devuelve por miembro. `percent` es null sin sesiones. */
export type MemberAttendanceCounts = {
  readonly eligibleSessions: number;
  readonly attendedSessions: number;
  readonly percent: number | null;
};

/** Lo que la base devuelve para el club. `percent` es null sin filas. */
export type ClubAttendanceCounts = {
  readonly totalRecords: number;
  readonly percent: number | null;
};

/** Los días hacia atrás que cubre la tasa del club (RF-7). */
export const CLUB_RATE_WINDOW_DAYS = 30;

export type MemberAttendanceGateway = {
  /** La asistencia de cada `userId` del club, en una sola consulta. Falta en
   * el mapa quien no es miembro de ese club. */
  findMemberAttendance(
    clubId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, MemberAttendance>>;
};

/** Un porcentaje que falta con datos es un esquema que cambió sin que este
 * archivo se enterara: se falla, no se sirve como "sin datos". */
function requirePercent(percent: number | null, context: string): number {
  if (percent === null) {
    throw new Error(`La base devolvió ${context} sin porcentaje.`);
  }
  return percent;
}

export function toMemberAttendance(
  counts: MemberAttendanceCounts,
): MemberAttendance {
  if (counts.eligibleSessions === 0) {
    return { kind: "no_data" };
  }
  return {
    kind: "rate",
    percent: requirePercent(
      counts.percent,
      `${counts.eligibleSessions} sesiones elegibles`,
    ),
    sessions: counts.attendedSessions,
  };
}

export function toClubAttendanceRate(
  counts: ClubAttendanceCounts,
): ClubAttendanceRate {
  if (counts.totalRecords === 0) {
    return { kind: "no_data" };
  }
  return {
    kind: "rate",
    percent: requirePercent(counts.percent, `${counts.totalRecords} filas`),
    records: counts.totalRecords,
  };
}

/** La asistencia de un miembro de la lista. La consulta trae una fila por
 * miembro del club, así que faltar sólo puede ser que se dio de baja entre
 * la lectura de la lista y la de la asistencia: sale sin datos, que es lo
 * que la base diría de él, en vez de tumbar la lista entera. */
export function attendanceOf(
  attendance: ReadonlyMap<string, MemberAttendance>,
  userId: string,
): MemberAttendance {
  return attendance.get(userId) ?? { kind: "no_data" };
}
