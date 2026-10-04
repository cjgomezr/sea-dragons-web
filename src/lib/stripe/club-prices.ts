import {
  type ClubPriceReader,
  PRICE_CACHE_TTL_MS,
  createClubPriceReader,
  createPriceCache,
} from "@/lib/membership/stripe-prices";
import { readStripePriceSetup } from "./stripe-client";

/**
 * Los precios del club para los endpoints (#486): una sola caché por proceso
 * del servidor, compartida por todas las peticiones, y las variables de
 * Stripe leídas en cada una.
 */

const clubPriceCache = createPriceCache({
  ttlMs: PRICE_CACHE_TTL_MS,
  now: () => Date.now(),
});

export function createRouteClubPriceReader(): ClubPriceReader {
  return createClubPriceReader(
    readStripePriceSetup(process.env),
    clubPriceCache,
  );
}

/** Para los tests: cada uno empieza sin precios guardados. */
export function clearClubPriceCache(): void {
  clubPriceCache.clear();
}
