import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { PublishedSeat, TeamSeatsGateway } from "./team-player-notices";

/**
 * El sitio de un jugador en el reparto publicado y los avisos que ya salieron
 * por él (#838), contra Supabase con la llave de servicio: quien responde no
 * puede leer el reparto en borrador ni los avisos de otro.
 */

const SPLITS_TABLE = "team_splits";
const NOTIFICATIONS_TABLE = "notifications";

/** El `!inner` deja fuera el reparto si el jugador no tiene fila en él. */
const SEAT_COLUMNS =
  "published_at, published_by, team_a_name, team_b_name, team_split_members!inner(team)";

const seatRowSchema = z.object({
  published_at: z.string(),
  published_by: z.string().nullable(),
  team_a_name: z.string(),
  team_b_name: z.string(),
  // Una fila por jugador y reparto: la clave primaria de `team_split_members`.
  team_split_members: z.tuple([z.object({ team: z.enum(["a", "b"]) })]),
});

function toPublishedSeat(row: z.infer<typeof seatRowSchema>): PublishedSeat {
  const [{ team }] = row.team_split_members;
  return {
    publishedAt: new Date(row.published_at),
    publishedBy: row.published_by,
    teamName: team === "a" ? row.team_a_name : row.team_b_name,
  };
}

async function findPublishedSeat(
  serviceClient: SupabaseClient,
  query: Parameters<TeamSeatsGateway["findPublishedSeat"]>[0],
): Promise<PublishedSeat | null> {
  const { data, error } = await serviceClient
    .from(SPLITS_TABLE)
    .select(SEAT_COLUMNS)
    .eq("club_id", query.clubId)
    .eq("event_id", query.eventId)
    .not("published_at", "is", null)
    .eq("team_split_members.user_id", query.userId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo leer el sitio de ${query.userId} en el reparto del evento ${query.eventId}: ${error.message}`,
    );
  }
  return data === null ? null : toPublishedSeat(seatRowSchema.parse(data));
}

async function hasPlayerNoticeSince(
  serviceClient: SupabaseClient,
  query: Parameters<TeamSeatsGateway["hasPlayerNoticeSince"]>[0],
): Promise<boolean> {
  const { data, error } = await serviceClient
    .from(NOTIFICATIONS_TABLE)
    .select("id")
    .eq("type", query.type)
    .eq("data->>eventId", query.eventId)
    .eq("data->>playerId", query.playerId)
    .gte("created_at", query.since.toISOString())
    .limit(1);
  if (error) {
    throw new Error(
      `No se pudieron leer los avisos ${query.type} del evento ${query.eventId}: ${error.message}`,
    );
  }
  return data.length > 0;
}

export function createSupabaseTeamSeatsGateway(
  serviceClient: SupabaseClient,
): TeamSeatsGateway {
  return {
    findPublishedSeat: (query) => findPublishedSeat(serviceClient, query),
    hasPlayerNoticeSince: (query) => hasPlayerNoticeSince(serviceClient, query),
  };
}
