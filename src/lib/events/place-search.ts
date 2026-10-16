import { type EventGateways, findEventOrganizer } from "./event-creation";
import type { EventPlace } from "./event-place";

/**
 * El buscador de lugares de un evento (#646, RF-5 y D1 del PRD de E24),
 * contado sin Supabase ni Photon delante.
 *
 * Primero van los lugares que el club ya usó, por número de eventos, y
 * después hasta 3 de Photon. Photon es un servicio gratis de terceros: si
 * falla o tarda, se responde igual con los del club y `searchAvailable`
 * dice que la búsqueda no estuvo, para que el formulario siga aceptando
 * texto libre.
 */

/** Con menos, Photon no se llama: se enseñan los del club más usados. */
export const PLACE_QUERY_MIN_LENGTH = 3;
export const PLACE_QUERY_MAX_LENGTH = 100;
export const TOP_CLUB_PLACES_LIMIT = 5;
export const SEARCH_RESULTS_LIMIT = 3;
export const PLACE_SEARCH_TIMEOUT_MS = 3_000;
export const PLACE_SEARCH_CACHE_TTL_MS = 10 * 60 * 1_000;
/** Para que la caché de un proceso de larga vida no crezca sin fin. */
const PLACE_SEARCH_CACHE_MAX_ENTRIES = 500;
/** Unos 11 m: dos puntos que coinciden a esta precisión son el mismo
 * lugar. */
const COORDINATE_DECIMALS = 4;

/** Un lugar que el club ya usó, con cuántos de sus eventos lo tienen. */
export type ClubPlace = EventPlace & { readonly eventCount: number };

/** Un resultado de Photon: siempre con coordenadas. */
export type SearchedPlace = {
  readonly name: string;
  readonly address: string | null;
  readonly lat: number;
  readonly lng: number;
};

export type PlaceSuggestion =
  | (EventPlace & { readonly source: "club" })
  | (SearchedPlace & { readonly source: "search" });

export type PlaceSuggestions = {
  readonly places: readonly PlaceSuggestion[];
  /** `false` cuando Photon falló o tardó: sólo hay lugares del club. */
  readonly searchAvailable: boolean;
};

/** Lanza si no pudo buscar. Tiene que dejar de esperar cuando `signal` se
 * aborta. */
export type PlaceSearchProvider = {
  readonly search: (
    query: string,
    signal: AbortSignal,
  ) => Promise<readonly SearchedPlace[]>;
};

export type ClubPlacesGateway = {
  /** Ordenados por número de eventos, de más a menos. */
  readonly listClubPlaces: (clubId: string) => Promise<readonly ClubPlace[]>;
};

export type PlaceSearchGateways = Pick<EventGateways, "members"> & {
  readonly clubPlaces: ClubPlacesGateway;
  readonly placeSearch: PlaceSearchProvider;
};

const LOG_PREFIX = "[events/places]";

function foldForMatching(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function matchesQuery(place: EventPlace, foldedQuery: string): boolean {
  return [place.name, place.address ?? ""].some((text) =>
    foldForMatching(text).includes(foldedQuery),
  );
}

function coordinatesKey(place: {
  readonly lat: number | null;
  readonly lng: number | null;
}): string | null {
  if (place.lat === null || place.lng === null) {
    return null;
  }
  return `${place.lat.toFixed(COORDINATE_DECIMALS)},${place.lng.toFixed(COORDINATE_DECIMALS)}`;
}

function asClubSuggestion(place: ClubPlace): PlaceSuggestion {
  const { name, address } = place;
  return place.lat === null
    ? { source: "club", name, address, lat: null, lng: null }
    : { source: "club", name, address, lat: place.lat, lng: place.lng };
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

/** Lo que diga Photon dentro del plazo, o `null` si falló o tardó. El fallo
 * se registra y no sube: un buscador caído no impide crear un evento. */
async function searchWithinTimeout(
  provider: PlaceSearchProvider,
  query: string,
): Promise<readonly SearchedPlace[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(`Photon no respondió en ${PLACE_SEARCH_TIMEOUT_MS} ms.`),
      ),
    PLACE_SEARCH_TIMEOUT_MS,
  );
  try {
    return await Promise.race([
      provider.search(query, controller.signal),
      rejectWhenAborted(controller.signal),
    ]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`${LOG_PREFIX} Búsqueda de lugares no disponible: ${reason}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Los del club que coinciden, más los que Photon encontró y ya son del
 * club, en el orden de uso; detrás, hasta 3 de Photon que no lo son. */
function mergeSuggestions(
  clubPlaces: readonly ClubPlace[],
  foldedQuery: string,
  searched: readonly SearchedPlace[],
): readonly PlaceSuggestion[] {
  const searchedKeys = new Set(searched.map(coordinatesKey));
  const clubKeys = new Set(clubPlaces.map(coordinatesKey));
  const clubSection = clubPlaces.filter((place) => {
    const key = coordinatesKey(place);
    return (
      matchesQuery(place, foldedQuery) ||
      (key !== null && searchedKeys.has(key))
    );
  });
  const searchSection = searched
    .filter((place) => !clubKeys.has(coordinatesKey(place)))
    .slice(0, SEARCH_RESULTS_LIMIT)
    .map((place): PlaceSuggestion => ({ source: "search", ...place }));
  return [...clubSection.map(asClubSuggestion), ...searchSection];
}

export async function suggestPlaces(
  gateways: PlaceSearchGateways,
  request: { readonly callerId: string; readonly query: string },
): Promise<PlaceSuggestions> {
  const organizer = await findEventOrganizer(gateways, request.callerId);
  const query = request.query.trim();
  const clubPlaces = await gateways.clubPlaces.listClubPlaces(organizer.clubId);
  if (query.length < PLACE_QUERY_MIN_LENGTH) {
    return {
      places: clubPlaces.slice(0, TOP_CLUB_PLACES_LIMIT).map(asClubSuggestion),
      searchAvailable: true,
    };
  }
  const searched = await searchWithinTimeout(gateways.placeSearch, query);
  return {
    places: mergeSuggestions(
      clubPlaces,
      foldForMatching(query),
      searched ?? [],
    ),
    searchAvailable: searched !== null,
  };
}

type CachedSearch = {
  readonly expiresAt: number;
  readonly places: readonly SearchedPlace[];
};

/** Recuerda 10 minutos lo que Photon respondió a cada búsqueda, sin
 * distinguir mayúsculas ni espacios de los bordes. Un fallo no se recuerda.
 * Vive en la memoria del proceso: Fluid Compute reutiliza instancias, y
 * perderla sólo cuesta una llamada más. */
export function createCachedPlaceSearch(
  provider: PlaceSearchProvider,
  now: () => number,
): PlaceSearchProvider {
  const cache = new Map<string, CachedSearch>();
  return {
    search: async (query, signal) => {
      const key = query.trim().toLowerCase();
      const cached = cache.get(key);
      if (cached !== undefined && cached.expiresAt > now()) {
        return cached.places;
      }
      const places = await provider.search(query, signal);
      cache.delete(key);
      if (cache.size >= PLACE_SEARCH_CACHE_MAX_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) {
          cache.delete(oldestKey);
        }
      }
      cache.set(key, { expiresAt: now() + PLACE_SEARCH_CACHE_TTL_MS, places });
      return places;
    },
  };
}
