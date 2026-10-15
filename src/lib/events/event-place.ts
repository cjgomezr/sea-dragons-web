/**
 * El lugar estructurado de un evento y su enlace al mapa (#645, RF-4 del PRD
 * de E24).
 *
 * Un lugar elegido del buscador (#646) guarda su nombre, su dirección y sus
 * coordenadas; el texto libre de antes de E24 sigue en `location`, que es
 * siempre lo que se enseña. Las coordenadas van las dos o ninguna.
 */

/** Los mismos topes que los `check` de `0069_event_places.sql`. */
export const PLACE_NAME_MAX_LENGTH = 120;
export const PLACE_ADDRESS_MAX_LENGTH = 200;
export const PLACE_DETAIL_MAX_LENGTH = 120;

export const LATITUDE_LIMIT = 90;
export const LONGITUDE_LIMIT = 180;

type PlaceCoordinates =
  | { readonly lat: number; readonly lng: number }
  | { readonly lat: null; readonly lng: null };

/** Plano, como lo devuelve la API: `{ name, address, lat, lng }`. */
export type EventPlace = {
  readonly name: string;
  readonly address: string | null;
} & PlaceCoordinates;

const MAPS_SEARCH_URL = "https://www.google.com/maps/search/?api=1&query=";

function searchTextOf(where: {
  readonly location: string;
  readonly place: EventPlace | null;
}): string {
  const { place } = where;
  if (place === null) {
    return where.location;
  }
  return place.address === null
    ? place.name
    : `${place.name}, ${place.address}`;
}

/** El enlace de Google Maps: al punto si hay coordenadas, y si no, a la
 * búsqueda del nombre y la dirección o del texto libre. */
export function buildMapsUrl(where: {
  readonly location: string;
  readonly place: EventPlace | null;
}): string {
  const { place } = where;
  const query =
    place !== null && place.lat !== null
      ? `${place.lat},${place.lng}`
      : encodeURIComponent(searchTextOf(where));
  return `${MAPS_SEARCH_URL}${query}`;
}
