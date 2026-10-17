import { z } from "zod";
import {
  type ApiRequestFailure,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { EVENT_PLACES_API_PATH } from "@/lib/auth/routes";
import { eventPlaceSchema } from "@/lib/events/event-place";
import type { PlaceSuggestions } from "@/lib/events/place-search";

/**
 * Lo que el buscador de lugares del diálogo (#652) le pide a la API v1
 * (#646). La espera entre teclas la pone quien llama: aquí sólo se pide y
 * se estrecha la respuesta.
 */

const clubSuggestionSchema = z.intersection(
  eventPlaceSchema,
  z.object({ source: z.literal("club") }),
);

const searchedSuggestionSchema = z.object({
  source: z.literal("search"),
  name: z.string(),
  address: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
});

const placesResponseSchema = z.object({
  data: z.object({
    places: z.array(z.union([clubSuggestionSchema, searchedSuggestionSchema])),
    searchAvailable: z.boolean(),
  }),
});

export type PlaceSearchOutcome =
  | { readonly kind: "found"; readonly suggestions: PlaceSuggestions }
  | ApiRequestFailure;

/** Los lugares para lo escrito; con `query` vacío, los del club más
 * usados. */
export async function searchEventPlaces(
  query: string,
  signal: AbortSignal,
): Promise<PlaceSearchOutcome> {
  const path =
    query === ""
      ? EVENT_PLACES_API_PATH
      : `${EVENT_PLACES_API_PATH}?${new URLSearchParams({ q: query })}`;
  const read = readApiPayload(
    await requestApi(path, { signal }),
    placesResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "found", suggestions: read.value.data };
}
