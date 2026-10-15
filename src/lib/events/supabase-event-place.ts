import { z } from "zod";
import type { EventPlace } from "./event-place";

/**
 * El lugar estructurado de un evento o una serie en sus columnas (#645,
 * `0069_event_places.sql`). Lo comparten crear, editar, la agenda y el
 * detalle, para que ninguno lea o escriba las cinco columnas a su manera.
 */

export const PLACE_COLUMNS =
  "place_name, place_address, place_lat, place_lng, place_detail";

/** Las columnas tal como las devuelve PostgREST, para extender el esquema de
 * cada fila. */
export const placeRowShape = {
  place_name: z.string().nullable(),
  place_address: z.string().nullable(),
  place_lat: z.number().nullable(),
  place_lng: z.number().nullable(),
  place_detail: z.string().nullable(),
};

/** Las columnas del lugar, sin el detalle: lo que leen `create_events`,
 * `update_event` y `update_series`, y lo que devuelve PostgREST. */
export type PlaceColumns = {
  readonly place_name: string | null;
  readonly place_address: string | null;
  readonly place_lat: number | null;
  readonly place_lng: number | null;
};

/** Sin nombre no hay lugar elegido: el evento sólo tiene texto libre. */
export function toEventPlace(row: PlaceColumns): EventPlace | null {
  const { place_name: name, place_lat: lat, place_lng: lng } = row;
  if (name === null) {
    return null;
  }
  const address = row.place_address;
  if (lat !== null && lng !== null) {
    return { name, address, lat, lng };
  }
  if (lat === null && lng === null) {
    return { name, address, lat, lng };
  }
  throw new Error(
    `El lugar "${name}" tiene una sola coordenada, cosa que la base no admite.`,
  );
}

export function toPlaceColumns(place: EventPlace | null): PlaceColumns {
  return {
    place_name: place === null ? null : place.name,
    place_address: place === null ? null : place.address,
    place_lat: place === null ? null : place.lat,
    place_lng: place === null ? null : place.lng,
  };
}
