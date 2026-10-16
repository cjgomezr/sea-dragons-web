import { z } from "zod";

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

export type PlaceCoordinates =
  | { readonly lat: number; readonly lng: number }
  | { readonly lat: null; readonly lng: null };

/** Plano, como lo devuelve la API: `{ name, address, lat, lng }`. */
export type EventPlace = {
  readonly name: string;
  readonly address: string | null;
} & PlaceCoordinates;

const MAPS_SEARCH_URL = "https://www.google.com/maps/search/?api=1&query=";

/** El nombre y la dirección del lugar elegido, o el texto libre: lo que busca
 * el mapa y lo que copia "Copiar dirección" (#648). */
export function placeTextOf(where: {
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
      : encodeURIComponent(placeTextOf(where));
  return `${MAPS_SEARCH_URL}${query}`;
}

/** Un punto con coordenadas, el único que tiene mapa (#658). */
export type MapPoint = { readonly lat: number; readonly lng: number };

/** La caja que enseña el mapa embebido, en grados. */
export type MapBounds = {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
};

/** Media caja alrededor del punto: unas calles a cada lado, más ancha que
 * alta porque la franja del mapa mide 110 px de alto y el ancho de la
 * tarjeta. */
const MAP_HALF_HEIGHT_DEGREES = 0.0018;
const MAP_HALF_WIDTH_DEGREES = 0.0065;

/** Seis decimales son unos 10 cm: de sobra, y quitan el ruido de la suma en
 * coma flotante de la URL. */
const MAP_DEGREE_DECIMALS = 6;

const MAP_EMBED_URL = "https://www.openstreetmap.org/export/embed.html";

function roundDegrees(degrees: number): number {
  return Number(degrees.toFixed(MAP_DEGREE_DECIMALS));
}

function clampDegrees(degrees: number, limit: number): number {
  return roundDegrees(Math.min(limit, Math.max(-limit, degrees)));
}

/** La caja del mapa alrededor del punto, sin salirse del mundo. */
export function mapBoundsAround(point: MapPoint): MapBounds {
  return {
    west: clampDegrees(point.lng - MAP_HALF_WIDTH_DEGREES, LONGITUDE_LIMIT),
    south: clampDegrees(point.lat - MAP_HALF_HEIGHT_DEGREES, LATITUDE_LIMIT),
    east: clampDegrees(point.lng + MAP_HALF_WIDTH_DEGREES, LONGITUDE_LIMIT),
    north: clampDegrees(point.lat + MAP_HALF_HEIGHT_DEGREES, LATITUDE_LIMIT),
  };
}

/** El mapa embebido de OpenStreetMap con el marcador en el punto: sin API
 * key ni teselas propias (D3 del PRD de E24). */
export function buildMapEmbedUrl(point: MapPoint): string {
  const { west, south, east, north } = mapBoundsAround(point);
  const query = new URLSearchParams({
    bbox: [west, south, east, north].join(","),
    layer: "mapnik",
    marker: `${point.lat},${point.lng}`,
  });
  return `${MAP_EMBED_URL}?${query.toString()}`;
}

/** Un lugar tal como llega a la API. Que las coordenadas vayan las dos o
 * ninguna, y dentro de su rango, lo decide el dominio con un 422. */
export type PlaceDraft = {
  readonly name: string;
  readonly address?: string | null;
  readonly lat?: number | null;
  readonly lng?: number | null;
};

const placeNamesShape = {
  name: z.string(),
  address: z.string().nullable(),
};

/** Un lugar como lo devuelve la API, para quien la lee. */
export const eventPlaceSchema = z.union([
  z.object({ ...placeNamesShape, lat: z.number(), lng: z.number() }),
  z.object({ ...placeNamesShape, lat: z.null(), lng: z.null() }),
]);

/** La dirección del lugar elegido, que llevan los avisos (D10). */
export function addressOf(place: EventPlace | null): string | null {
  return place === null ? null : place.address;
}

/** Si dos lugares son el mismo: nombre, dirección y coordenadas. */
export function isSamePlace(
  first: EventPlace | null,
  second: EventPlace | null,
): boolean {
  if (first === null || second === null) {
    return first === second;
  }
  return (
    first.name === second.name &&
    first.address === second.address &&
    first.lat === second.lat &&
    first.lng === second.lng
  );
}
