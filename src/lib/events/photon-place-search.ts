import { z } from "zod";
import { PLACE_ADDRESS_MAX_LENGTH, PLACE_NAME_MAX_LENGTH } from "./event-place";
import type { PlaceSearchProvider, SearchedPlace } from "./place-search";

/**
 * Photon (OpenStreetMap) desde nuestro servidor (#646, D1 del PRD de E24).
 * El navegador nunca lo llama: así no ve la IP ni nada de quien busca, y la
 * aplicación se identifica con su `User-Agent` como piden sus reglas de uso
 * justo. Nominatim queda fuera porque sus reglas prohíben el autocompletado.
 */

export const PHOTON_API_URL = "https://photon.komoot.io/api/";

/** El centro de Melbourne: Photon ordena primero lo que queda cerca. */
export const MELBOURNE_BIAS = { lat: -37.8136, lon: 144.9631 } as const;

export const PLACE_SEARCH_USER_AGENT =
  "VictoriaSeadragons/1.0 (+https://victoria-seadragons.vercel.app)";

/** Photon no filtra por país: se piden de más para que, tras quitar los de
 * fuera de Australia, queden 3. */
const PHOTON_RESULTS_REQUESTED = 15;
const PHOTON_LANGUAGE = "en";
const AUSTRALIA_COUNTRY_CODE = "AU";

const photonFeatureSchema = z.object({
  geometry: z.object({
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: z.object({
    name: z.string().optional(),
    housenumber: z.string().optional(),
    street: z.string().optional(),
    city: z.string().optional(),
    district: z.string().optional(),
    state: z.string().optional(),
    postcode: z.string().optional(),
    countrycode: z.string().optional(),
  }),
});

const photonResponseSchema = z.object({
  features: z.array(z.unknown()),
});

type PhotonProperties = z.infer<typeof photonFeatureSchema>["properties"];

function joinPresent(
  parts: readonly (string | undefined)[],
  separator: string,
): string {
  return parts
    .filter((part): part is string => part !== undefined && part !== "")
    .join(separator);
}

/** "30 Aughtie Drive, Melbourne, Victoria 3206", al estilo australiano. */
function addressOf(properties: PhotonProperties, streetLine: string): string {
  return joinPresent(
    [
      streetLine,
      properties.city ?? properties.district,
      joinPresent([properties.state, properties.postcode], " "),
    ],
    ", ",
  );
}

/** Un resultado de Photon como lugar, o `null` si no tiene con qué
 * nombrarse o no tiene la forma de GeoJSON: uno raro no tumba a los demás. Una dirección sin nombre se nombra por su calle. El nombre y la
 * dirección se recortan a lo que admite un evento, para que elegirlo no
 * acabe en un 422. */
export function toSearchedPlace(feature: unknown): SearchedPlace | null {
  const parsed = photonFeatureSchema.safeParse(feature);
  if (!parsed.success) {
    return null;
  }
  const { geometry, properties } = parsed.data;
  const streetLine = joinPresent(
    [properties.housenumber, properties.street],
    " ",
  );
  const name = properties.name ?? streetLine;
  if (name === "") {
    return null;
  }
  const address = addressOf(properties, name === streetLine ? "" : streetLine);
  const [lng, lat] = geometry.coordinates;
  return {
    name: name.slice(0, PLACE_NAME_MAX_LENGTH),
    address: address === "" ? null : address.slice(0, PLACE_ADDRESS_MAX_LENGTH),
    lat,
    lng,
  };
}

function isInAustralia(feature: unknown): boolean {
  const parsed = photonFeatureSchema.safeParse(feature);
  return (
    parsed.success &&
    parsed.data.properties.countrycode === AUSTRALIA_COUNTRY_CODE
  );
}

function buildSearchUrl(query: string): URL {
  const url = new URL(PHOTON_API_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("lat", String(MELBOURNE_BIAS.lat));
  url.searchParams.set("lon", String(MELBOURNE_BIAS.lon));
  url.searchParams.set("limit", String(PHOTON_RESULTS_REQUESTED));
  url.searchParams.set("lang", PHOTON_LANGUAGE);
  return url;
}

/** Sólo el texto buscado sale hacia Photon: ni cookies, ni `Referer`, ni
 * nada de quien busca. */
export function createPhotonPlaceSearch(
  fetchImpl: typeof fetch,
): PlaceSearchProvider {
  return {
    search: async (query, signal) => {
      const response = await fetchImpl(buildSearchUrl(query), {
        headers: { "User-Agent": PLACE_SEARCH_USER_AGENT },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal,
      });
      if (!response.ok) {
        throw new Error(`Photon respondió ${response.status}.`);
      }
      const { features } = photonResponseSchema.parse(await response.json());
      return features
        .filter(isInAustralia)
        .map(toSearchedPlace)
        .filter((place): place is SearchedPlace => place !== null);
    },
  };
}
