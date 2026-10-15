import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import { createPhotonPlaceSearch } from "./photon-place-search";
import {
  type PlaceSearchGateways,
  createCachedPlaceSearch,
} from "./place-search";
import { createSupabaseClubPlacesGateway } from "./supabase-club-places";

/**
 * Raíz de composición del buscador de lugares (#646). La caché de Photon se
 * crea una vez por proceso, fuera de cada petición: es lo que la hace servir
 * entre una tecla y la siguiente.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const cachedPhotonSearch = createCachedPlaceSearch(
  createPhotonPlaceSearch((input, init) => fetch(input, init)),
  Date.now,
);

export type PlaceSearchGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: PlaceSearchGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

export function createSupabasePlaceSearchGateways(
  env: Environment,
): PlaceSearchGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  const serviceClient = createServiceRoleClient(env);
  return {
    kind: "ready",
    gateways: {
      members: createRoleRequestGateways(serviceClient).members,
      clubPlaces: createSupabaseClubPlacesGateway(serviceClient),
      placeSearch: cachedPhotonSearch,
    },
  };
}
