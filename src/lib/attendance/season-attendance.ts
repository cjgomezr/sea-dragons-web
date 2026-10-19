import { seasonStartFor } from "@/lib/club/season";
import type { AttendanceStatus } from "./attendance-status";

/**
 * "Mi asistencia" del inicio (#746, RF-2 y D13 del PRD de E27): la regla de
 * `attendance_stats` (presente o tarde sobre sesiones elegibles) recortada a
 * la temporada (D1), y las últimas 10 sesiones elegibles, sean o no de esta
 * temporada.
 *
 * La base decide qué sesiones son elegibles (`0076_dashboard_attendance.sql`)
 * y las devuelve en una sola llamada; aquí se cuentan.
 */

/** Las que pinta "Últimas 10" (D13). */
export const RECENT_SESSIONS = 10;

/** Una sesión elegible, con lo que el socio hizo en ella. Sin fila en la
 * hoja guardada es `absent`, como en `attendance_stats`. */
export type AttendedSession = {
  readonly eventId: string;
  readonly startsOn: string;
  readonly status: AttendanceStatus;
};

export type SeasonAttendance = {
  readonly percent: number;
  /** Presente o tarde. */
  readonly attended: number;
  /** Las elegibles de la temporada. */
  readonly sessions: number;
  /** De la más vieja a la más nueva. */
  readonly last10: readonly AttendedSession[];
};

export type MemberSessionsQuery = {
  readonly clubId: string;
  readonly userId: string;
  /** Días del club (YYYY-MM-DD), los dos incluidos. */
  readonly since: string;
  readonly until: string;
  readonly recent: number;
};

export type SeasonAttendanceGateway = {
  /** `clubs.season_starts_on`, o null si el Admin no la fijó. */
  findSeasonStartsOn(clubId: string): Promise<string | null>;
  /** Las sesiones elegibles del socio hasta `until`, de la más vieja a la
   * más nueva: las de `since` en adelante y, además, las `recent` más
   * recientes. */
  findMemberSessions(
    query: MemberSessionsQuery,
  ): Promise<readonly AttendedSession[]>;
};

export type SeasonAttendanceRequest = {
  readonly clubId: string;
  readonly userId: string;
  /** El día del club (NFR-003). Lo pone quien llama, que tiene el reloj. */
  readonly today: string;
};

function isAttended(session: AttendedSession): boolean {
  return session.status === "present" || session.status === "late";
}

/** Null sin sesiones elegibles en la temporada: no es un 0 (AC-017b). */
export async function readSeasonAttendance(
  gateway: SeasonAttendanceGateway,
  request: SeasonAttendanceRequest,
): Promise<SeasonAttendance | null> {
  const since = seasonStartFor(
    await gateway.findSeasonStartsOn(request.clubId),
    request.today,
  );
  const sessions = await gateway.findMemberSessions({
    clubId: request.clubId,
    userId: request.userId,
    since,
    until: request.today,
    recent: RECENT_SESSIONS,
  });
  const season = sessions.filter((session) => session.startsOn >= since);
  if (season.length === 0) {
    return null;
  }
  const attended = season.filter(isAttended).length;
  return {
    // Con la mitad hacia arriba, como el `round` de `attendance_stats`.
    percent: Math.round((attended * 100) / season.length),
    attended,
    sessions: season.length,
    last10: sessions.slice(-RECENT_SESSIONS),
  };
}
