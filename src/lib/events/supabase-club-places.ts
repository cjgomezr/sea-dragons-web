import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ClubPlace, ClubPlacesGateway } from "./place-search";
import { toEventPlace } from "./supabase-event-place";

/**
 * Los lugares que el club ya usó, contados por la base (#646,
 * `0071_club_places.sql`). Va por la llave de servicio: la función sólo la
 * ejecuta el servidor, y el club sale de la fila de quien busca.
 */

const CLUB_PLACES_FUNCTION = "club_places";

const clubPlaceRowSchema = z.object({
  place_name: z.string(),
  place_address: z.string().nullable(),
  place_lat: z.number().nullable(),
  place_lng: z.number().nullable(),
  event_count: z.number().int(),
});

function toClubPlace(row: z.infer<typeof clubPlaceRowSchema>): ClubPlace {
  const place = toEventPlace(row);
  if (place === null) {
    throw new Error("club_places devolvió un lugar sin nombre.");
  }
  return { ...place, eventCount: row.event_count };
}

export function createSupabaseClubPlacesGateway(
  serviceClient: SupabaseClient,
): ClubPlacesGateway {
  return {
    listClubPlaces: async (clubId) => {
      const { data, error } = await serviceClient.rpc(CLUB_PLACES_FUNCTION, {
        p_club_id: clubId,
      });
      if (error) {
        throw new Error(
          `No se pudieron leer los lugares del club ${clubId}: ${error.message}`,
        );
      }
      return z.array(clubPlaceRowSchema).parse(data).map(toClubPlace);
    },
  };
}
