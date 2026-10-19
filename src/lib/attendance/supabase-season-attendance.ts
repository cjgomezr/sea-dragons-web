import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ATTENDANCE_STATUSES } from "./attendance-status";
import type {
  AttendedSession,
  MemberSessionsQuery,
  SeasonAttendanceGateway,
} from "./season-attendance";

/**
 * Adaptador entre "Mi asistencia" del inicio (#746) y Supabase. Con la llave
 * de servicio: `member_attendance_sessions` (`0076`) sólo la ejecuta
 * `service_role`, y el club lo pone el servidor desde la fila de quien mira.
 */

const CLUBS_TABLE = "clubs";
const MEMBER_SESSIONS_FUNCTION = "member_attendance_sessions";

const seasonRowSchema = z.object({ season_starts_on: z.iso.date().nullable() });

const sessionRowsSchema = z.array(
  z.object({
    event_id: z.uuid(),
    starts_on: z.iso.date(),
    status: z.enum(ATTENDANCE_STATUSES),
  }),
);

async function findSeasonStartsOn(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<string | null> {
  const { data, error } = await serviceClient
    .from(CLUBS_TABLE)
    .select("season_starts_on")
    .eq("id", clubId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el inicio de temporada del club ${clubId}: ${error.message}`,
    );
  }
  if (data === null) {
    throw new Error(`No hay ningún club con el id ${clubId}.`);
  }
  return seasonRowSchema.parse(data).season_starts_on;
}

async function findMemberSessions(
  serviceClient: SupabaseClient,
  query: MemberSessionsQuery,
): Promise<readonly AttendedSession[]> {
  const { data, error } = await serviceClient.rpc(MEMBER_SESSIONS_FUNCTION, {
    p_club_id: query.clubId,
    p_user_id: query.userId,
    p_since: query.since,
    p_until: query.until,
    p_recent: query.recent,
  });
  if (error) {
    throw new Error(
      `No se pudieron leer las sesiones de ${query.userId} en el club ${query.clubId}: ${error.message}`,
    );
  }
  return sessionRowsSchema.parse(data).map((row) => ({
    eventId: row.event_id,
    startsOn: row.starts_on,
    status: row.status,
  }));
}

export function createSeasonAttendanceGateway(
  serviceClient: SupabaseClient,
): SeasonAttendanceGateway {
  return {
    findSeasonStartsOn: (clubId) => findSeasonStartsOn(serviceClient, clubId),
    findMemberSessions: (query) => findMemberSessions(serviceClient, query),
  };
}
